from __future__ import annotations

import asyncio
from dataclasses import dataclass
from urllib.parse import urlparse

from .adk_agents.runner import AdkPipelineRunner
from .models import ApprovalStatus, RunRecord, RunStatus
from .store import RunStore


DEFAULT_PR_BASE_BRANCH = "develop"


@dataclass
class OrchestratorConfig:
    worker_count: int = 3
    confidence_threshold: float = 0.78
    max_retry_attempts: int = 2


class RemediationOrchestrator:
    def __init__(self, store: RunStore, config: OrchestratorConfig | None = None) -> None:
        self.store = store
        self.config = config or OrchestratorConfig()
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []

        self.adk = AdkPipelineRunner()

    async def start(self) -> None:
        if self._workers:
            return
        for idx in range(self.config.worker_count):
            task = asyncio.create_task(self._worker_loop(idx + 1))
            self._workers.append(task)

    async def stop(self) -> None:
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def submit(self, run_id: str) -> None:
        await self._queue.put(run_id)

    async def _worker_loop(self, worker_number: int) -> None:
        while True:
            run_id = await self._queue.get()
            try:
                await self._execute(run_id, worker_number)
            except Exception as exc:
                run = self.store.get(run_id)
                if run is not None:
                    run.status = RunStatus.FAILED
                    run.phase = "failed"
                    run.remediation_summary.status = "failed"
                    run.remediation_summary.error = str(exc)
                    self.store.add_event(run_id, f"Execution failed: {exc}", level="error")
                    self.store.replace(run)
            finally:
                try:
                    await self.adk.cleanup_run(run_id)
                except Exception as cleanup_exc:
                    run = self.store.get(run_id)
                    if run is not None:
                        self.store.add_event(run_id, f"ADK workspace cleanup warning: {cleanup_exc}", level="warn")
                self._queue.task_done()

    async def _execute(self, run_id: str, worker_number: int) -> None:
        run = self.store.get(run_id)
        if run is None:
            return

        if run.status in {RunStatus.COMPLETED, RunStatus.FAILED}:
            return

        run.status = RunStatus.RUNNING
        self.store.add_event(run_id, f"Worker-{worker_number} picked run {run_id}")

        if not run.findings:
            run.phase = "scanning"
            self.store.add_event(run_id, "ADK scanner agent scanning repository for vulnerabilities")
            run.findings = await self.adk.run_scan(run.repo_url, run.id)
            self.store.add_event(run_id, f"Scanner found {len(run.findings)} findings")
            if len(run.findings) == 0:
                self.store.add_event(run_id, "No vulnerabilities detected by scanner")
                run.remediation_summary.status = "completed"
                run.pull_request.status = "skipped"
                run.pull_request.reason = "No vulnerabilities found; remediation and PR not required"
                await self._validate_and_finalize(run)
                return

        if run.findings and not run.remediation_requested:
            run.status = RunStatus.AWAITING_APPROVAL
            run.phase = "awaiting_remediation_start"
            self.store.add_event(run_id, "Vulnerabilities ready for review. Awaiting user approval to start remediation.")
            self.store.replace(run)
            return

        if not run.proposals:
            run.phase = "remediation"
            planned = await self.adk.plan_remediation(
                findings=run.findings,
                repo_url=run.repo_url,
                run_id=run.id,
            )
            for proposal in planned:
                proposal.approval_status = ApprovalStatus.APPROVED
                self.store.add_event(
                    run_id,
                    (
                        f"Approved remediation plan for {proposal.dependency} "
                        f"{proposal.from_version}->{proposal.to_version} score={proposal.confidence_score}"
                    ),
                )
                run.proposals.append(proposal)

        if run.findings and run.remediation_summary.status == "not_started":
            run.phase = "remediation_apply"
            run.remediation_summary.status = "in_progress"
            self.store.add_event(run_id, "ADK fixer agent applying dependency updates to pom.xml")
            apply_result = await self.adk.apply_remediation(
                repo_url=run.repo_url,
                run_id=run.id,
                proposals=run.proposals,
            )
            run.remediation_summary.status = "completed"
            run.remediation_summary.workspace_path = apply_result.get("workspace_path")
            run.remediation_summary.changed_files = apply_result.get("changed_files", [])
            run.remediation_summary.changes = apply_result.get("changes", [])
            run.remediation_summary.diff_excerpt = apply_result.get("diff_excerpt")
            run.pull_request = apply_result.get("pull_request", run.pull_request)

            self.store.add_event(
                run_id,
                f"Remediation completed. changed_files={len(run.remediation_summary.changed_files)} pr_status={run.pull_request.status}",
            )

        await self._validate_and_finalize(run)

    async def resume_if_ready(self, run_id: str) -> None:
        run = self.store.get(run_id)
        if run is None:
            return
        
        await self.submit(run_id)

    async def _validate_and_finalize(self, run: RunRecord) -> None:
        run.phase = "validation"

        for attempt in range(self.config.max_retry_attempts + 1):
            run.validations = await self.adk.validate_remediation(
                repo_url=run.repo_url,
                run_id=run.id,
                proposals=run.proposals,
                apply_result={
                    "workspace_path": run.remediation_summary.workspace_path,
                    "changed_files": run.remediation_summary.changed_files,
                    "changes": run.remediation_summary.changes,
                    "diff_excerpt": run.remediation_summary.diff_excerpt,
                    "pull_request": run.pull_request,
                },
            )
            
            proposal_by_id = {item.id: item for item in run.proposals}
            for result in run.validations:
                proposal = proposal_by_id.get(result.proposal_id)
                dependency = proposal.dependency if proposal is not None else result.proposal_id
                self.store.add_event(
                    run.id,
                    f"Validation {'passed' if result.passed else 'failed'} for {dependency}",
                    level="info" if result.passed else "error",
                )

            failed = [item for item in run.validations if not item.passed]
            if not failed:
                break
            
            if attempt >= self.config.max_retry_attempts:
                run.status = RunStatus.FAILED
                run.phase = "failed"
                self.store.add_event(
                    run.id,
                    "One or more approved proposals failed validation after retry attempts",
                    level="error",
                )
                self.store.replace(run)
                return

            run.phase = "remediation_retry"
            self.store.add_event(
                run.id,
                (
                    f"Validation failed. Triggering fixer retry {attempt + 1}/"
                    f"{self.config.max_retry_attempts}"
                ),
                level="warn",
            )

            retry_apply_result = await self.adk.apply_remediation(
                repo_url=run.repo_url,
                run_id=run.id,
                proposals=run.proposals,
            )
            run.remediation_summary.workspace_path = retry_apply_result.get("workspace_path")
            run.remediation_summary.changed_files = retry_apply_result.get("changed_files", [])
            run.remediation_summary.changes = retry_apply_result.get("changes", [])
            run.remediation_summary.diff_excerpt = retry_apply_result.get("diff_excerpt")
            run.pull_request = retry_apply_result.get("pull_request", run.pull_request)
            run.phase = "validation"

        run.pull_request.status = "created"
        if not run.pull_request.url:
            run.pull_request.url = self._build_pr_url(run.repo_url, run.id)
        run.pull_request.reason = None
        self.store.add_event(run.id, f"Pull request generated: {run.pull_request.url}")

        run.phase = "evidence"
        run.evidence, summary = await self.adk.generate_report(run)
        if summary:
            self.store.add_event(run.id, summary)
        run.status = RunStatus.COMPLETED
        run.phase = "completed"
        self.store.add_event(run.id, "Run completed with evidence bundle ready")
        self.store.replace(run)

    def _build_pr_url(self, repo_url: str, run_id: str) -> str:
        repo = repo_url.strip()
        if repo.endswith(".git"):
            repo = repo[:-4]
        branch = f"auto-remediation-{run_id[:8]}"
        base_branch = DEFAULT_PR_BASE_BRANCH
        if repo.startswith("https://github.com/"):
            return f"{repo}/compare/{base_branch}...{branch}?expand=1"
        
        parsed = urlparse(repo)
        if parsed.scheme and parsed.netloc and parsed.path:
            clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")
            return f"{clean}/compare/{base_branch}...{branch}?expand=1"
        
        return f"generated://pull-request/{run_id}"