from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from ..models import (
    EvidenceBundle,
    PullRequestInfo,
    RemediationChange,
    RemediationProposal,
    RunRecord,
    ValidationResult,
    VulnerabilityFinding,
)


@dataclass
class AdkPipelineRunner:
    def _base_url(self) -> str:
        return os.getenv("ADK_SERVER_URL", "http://127.0.0.1:8081").rstrip("/")

    def _timeout(self) -> int:
        raw = os.getenv("ADK_SERVER_TIMEOUT_SECONDS", "600").strip()
        try:
            timeout = int(raw)
            return timeout if timeout > 0 else 600
        except ValueError:
            return 600

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        token = os.getenv("ADK_SERVER_BEARER_TOKEN", "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _post_json_sync(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url()}{endpoint}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(url, data=body, headers=self._headers(), method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self._timeout()) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"ADK server HTTP {exc.code} at {endpoint}: {details}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"ADK server connection error at {endpoint}: {exc.reason}") from exc
        
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"ADK server returned invalid JSON at {endpoint}: {raw[:300]}") from exc
            
        if not isinstance(parsed, dict):
            raise RuntimeError(f"ADK server response must be a JSON object at {endpoint}")
        return parsed

    def _delete_json_sync(self, endpoint: str) -> dict[str, Any]:
        url = f"{self._base_url()}{endpoint}"
        request = urllib.request.Request(url, headers=self._headers(), method="DELETE")
        try:
            with urllib.request.urlopen(request, timeout=self._timeout()) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"ADK server HTTP {exc.code} at {endpoint}: {details}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"ADK server connection error at {endpoint}: {exc.reason}") from exc
            
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"ADK server returned invalid JSON at {endpoint}: {raw[:300]}") from exc
            
        if not isinstance(parsed, dict):
            raise RuntimeError(f"ADK server response must be a JSON object at {endpoint}")
        return parsed

    async def _post_json(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self._post_json_sync, endpoint, payload)

    async def _delete_json(self, endpoint: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._delete_json_sync, endpoint)

    async def run_scan(self, repo_url: str, run_id: str, languages: list[str] | None = None) -> list[VulnerabilityFinding]:
        payload: dict[str, Any] = {"repo_url": repo_url, "run_id": run_id}
        if languages:
            payload["languages"] = languages
        response = await self._post_json("/scan", payload)
        raw_findings = response.get("findings")
        if not isinstance(raw_findings, list):
            raise RuntimeError("ADK /scan response missing findings list")
        return [VulnerabilityFinding.model_validate(item) for item in raw_findings]

    async def plan_remediation(
        self,
        findings: list[VulnerabilityFinding],
        repo_url: str,
        run_id: str,
    ) -> list[RemediationProposal]:
        response = await self._post_json(
            "/remediate/plan",
            {
                "repo_url": repo_url,
                "run_id": run_id,
                "findings": [item.model_dump() for item in findings],
            },
        )
        raw_proposals = response.get("proposals")
        if not isinstance(raw_proposals, list):
            raise RuntimeError("ADK /remediate/plan response missing proposals list")
        return [RemediationProposal.model_validate(item) for item in raw_proposals]

    async def apply_remediation(
        self,
        repo_url: str,
        run_id: str,
        proposals: list[RemediationProposal],
    ) -> dict[str, Any]:
        response = await self._post_json(
            "/remediate/apply",
            {
                "repo_url": repo_url,
                "run_id": run_id,
                "proposals": [item.model_dump() for item in proposals],
            },
        )
        raw_pr = response.get("pull_request") or {}
        raw_changes = response.get("changes") or []
        return {
            "workspace_path": response.get("workspace_path"),
            "changed_files": response.get("changed_files") or [],
            "changes": [RemediationChange.model_validate(item) for item in raw_changes],
            "diff_excerpt": response.get("diff_excerpt"),
            "pull_request": PullRequestInfo.model_validate(raw_pr),
        }

    async def validate_remediation(
        self,
        repo_url: str,
        run_id: str,
        proposals: list[RemediationProposal],
        apply_result: dict[str, Any],
    ) -> list[ValidationResult]:
        response = await self._post_json(
            "/validate",
            {
                "repo_url": repo_url,
                "run_id": run_id,
                "proposals": [item.model_dump() for item in proposals],
                "apply_result": {
                    "workspace_path": apply_result.get("workspace_path"),
                    "changed_files": apply_result.get("changed_files") or [],
                    "changes": [item.model_dump() for item in apply_result.get("changes") or []],
                    "diff_excerpt": apply_result.get("diff_excerpt"),
                    "pull_request": (
                        apply_result.get("pull_request").model_dump()
                        if isinstance(apply_result.get("pull_request"), PullRequestInfo)
                        else apply_result.get("pull_request")
                    ),
                },
            },
        )
        raw_validations = response.get("validations")
        if not isinstance(raw_validations, list):
            raise RuntimeError("ADK /validate response missing validations list")
        return [ValidationResult.model_validate(item) for item in raw_validations]

    async def generate_report(self, run: RunRecord) -> tuple[EvidenceBundle, str]:
        response = await self._post_json(
            "/report",
            {
                "run": run.model_dump(mode="json"),
            },
        )
        raw_evidence = response.get("evidence")
        if not isinstance(raw_evidence, dict):
            raise RuntimeError("ADK /report response missing evidence object")
        summary = str(response.get("summary") or "").strip()
        return EvidenceBundle.model_validate(raw_evidence), summary

    async def cleanup_run(self, run_id: str) -> None:
        await self._delete_json(f"/runs/{run_id}")