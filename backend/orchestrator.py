from __future__ import annotations

import asyncio
from dataclasses import dataclass
from urllib.parse import urlparse

from .adk_agents.runner import AdkPipelineRunner
from .models import ApprovalStatus, RunRecord, RunStatus
from .store import RunStore


DEFAULT_PR_BASE_BRANCH = "develop"

JAVA_PACKAGES = {"log4j-core", "commons-text", "jackson-databind", "snakeyaml", "commons-io", "dom4j", "guava", "xstream", "commons-compress"}
PYTHON_PACKAGES = {"requests", "urllib3", "cryptography", "pillow", "pyyaml", "jinja2", "werkzeug", "aiohttp", "setuptools", "django"}
NODE_PACKAGES = {"lodash", "axios", "express", "minimatch", "handlebars", "qs", "moment", "ws", "jsonwebtoken", "node-forge"}


@dataclass
class OrchestratorConfig:
    worker_count: int = 3
    confidence_threshold: float = 0.78
    max_retry_attempts: int = 3


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

    @staticmethod
    def _finding_matches_language(finding, languages: list[str]) -> bool:
        if not languages:
            return True
        dep = finding.dependency.lower()
        pkg = dep.split(":")[-1] if ":" in dep else dep
        for lang in languages:
            if lang == "java" and (":" in finding.dependency and not dep.startswith(("pypi", "npm"))):
                return True
            if lang == "java" and pkg in JAVA_PACKAGES:
                return True
            if lang == "python" and (pkg in PYTHON_PACKAGES or "pypi" in dep):
                return True
            if lang == "nodejs" and (pkg in NODE_PACKAGES or "npm" in dep):
                return True
        return False

    async def _execute(self, run_id: str, worker_number: int) -> None:
        run = self.store.get(run_id)
        if run is None:
            return
        if run.status in {RunStatus.COMPLETED, RunStatus.FAILED}:
            return

        run.status = RunStatus.RUNNING
        self.store.add_event(run_id, f"Worker-{worker_number} picked run {run_id}")

        # Step 1: Scan (if not already done)
        if not run.findings:
            run.phase = "scanning"
            lang_str = ", ".join(run.languages) if run.languages else "all languages"
            self.store.add_event(run_id, f"Scanning for vulnerabilities ({lang_str})")
            all_findings = await self.adk.run_scan(run.repo_url, run.id, languages=run.languages or None)
            run.findings = all_findings
            self.store.add_event(run_id, f"Scanner found {len(run.findings)} findings for selected languages")
            if len(run.findings) == 0:
                self.store.add_event(run_id, "No vulnerabilities detected")
                run.remediation_summary.status = "completed"
                run.pull_request.status = "skipped"
                run.pull_request.reason = "No vulnerabilities found"
                await self._finalize(run)
                return

        # Step 2: Wait for user approval
        if run.findings and not run.remediation_requested:
            run.status = RunStatus.AWAITING_APPROVAL
            run.phase = "awaiting_remediation_start"
            self.store.add_event(run_id, "Vulnerabilities ready for review. Awaiting approval.")
            self.store.replace(run)
            return

        # Step 3: Plan proposals (if not done)
        if not run.proposals:
            run.phase = "remediation"
            planned = await self.adk.plan_remediation(findings=run.findings, repo_url=run.repo_url, run_id=run.id)
            for proposal in planned:
                proposal.approval_status = ApprovalStatus.APPROVED
                self.store.add_event(run_id, f"Approved {proposal.dependency} {proposal.from_version}->{proposal.to_version}")
                run.proposals.append(proposal)

        # Step 4: Apply remediation (includes file edit + tests + AI fixer + PR creation)
        if run.findings and run.remediation_summary.status == "not_started":
            run.phase = "remediation_apply"
            run.remediation_summary.status = "in_progress"
            self.store.add_event(run_id, "Applying version bumps and running tests")

            apply_result = await self.adk.apply_remediation(
                repo_url=run.repo_url, run_id=run.id, proposals=run.proposals,
            )
            run.remediation_summary.status = "completed"
            run.remediation_summary.workspace_path = apply_result.get("workspace_path")
            run.remediation_summary.changed_files = apply_result.get("changed_files", [])
            run.remediation_summary.changes = apply_result.get("changes", [])
            run.remediation_summary.diff_excerpt = apply_result.get("diff_excerpt")
            run.pull_request = apply_result.get("pull_request", run.pull_request)

            # Check if tests passed from the apply result
            # The /remediate/apply endpoint already runs tests + AI fixer
            self.store.add_event(run_id, f"Remediation applied. files={len(run.remediation_summary.changed_files)} pr={run.pull_request.status}")

        # Step 5: Finalize (generate report, mark complete)
        await self._finalize(run)

    async def resume_if_ready(self, run_id: str) -> None:
        run = self.store.get(run_id)
        if run is None:
            return
        await self.submit(run_id)

    async def _finalize(self, run: RunRecord) -> None:
        """Generate evidence report and mark run complete."""
        run.phase = "evidence"
        try:
            run.evidence, summary = await self.adk.generate_report(run)
            if summary:
                self.store.add_event(run.id, summary)
        except Exception as exc:
            self.store.add_event(run.id, f"Report generation warning: {exc}", level="warn")

        run.status = RunStatus.COMPLETED
        run.phase = "completed"
        self.store.add_event(run.id, "Run completed")
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