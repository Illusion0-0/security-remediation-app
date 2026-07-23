from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    FAILED = "failed"
    COMPLETED = "completed"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Severity(str, Enum):
    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class VulnerabilityFinding(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    dependency: str
    current_version: str
    recommended_versions: list[str]
    severity: Severity
    cve: str


class RemediationProposal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    finding_id: str
    dependency: str
    from_version: str
    to_version: str
    reasoning: str
    confidence_score: float
    approval_status: ApprovalStatus = ApprovalStatus.PENDING


class ValidationResult(BaseModel):
    proposal_id: str
    passed: bool
    build_ok: bool
    tests_ok: bool
    startup_ok: bool
    details: str


class EvidenceBundle(BaseModel):
    run_id: str
    summary: str
    export_links: list[str]
    audit_events: int


class PullRequestInfo(BaseModel):
    status: Literal["not_attempted", "created", "skipped", "failed"] = "not_attempted"
    url: str | None = None
    reason: str | None = None


class RemediationChange(BaseModel):
    dependency: str
    old_version: str | None = None
    new_version: str
    file_path: str


class RemediationSummary(BaseModel):
    status: Literal["not_started", "in_progress", "completed", "failed"] = "not_started"
    workspace_path: str | None = None
    changed_files: list[str] = Field(default_factory=list)
    changes: list[RemediationChange] = Field(default_factory=list)
    diff_excerpt: str | None = None
    error: str | None = None


class RunEvent(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    level: Literal["info", "warn", "error"] = "info"
    message: str


class RunRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    repo_url: str
    requested_by: str
    languages: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: RunStatus = RunStatus.QUEUED
    phase: str = "queued"
    remediation_requested: bool = False
    findings: list[VulnerabilityFinding] = Field(default_factory=list)
    proposals: list[RemediationProposal] = Field(default_factory=list)
    validations: list[ValidationResult] = Field(default_factory=list)
    remediation_summary: RemediationSummary = Field(default_factory=RemediationSummary)
    evidence: EvidenceBundle | None = None
    pull_request: PullRequestInfo = Field(default_factory=PullRequestInfo)
    events: list[RunEvent] = Field(default_factory=list)


class CreateRunRequest(BaseModel):
    repo_url: str
    requested_by: str = "hackathon-user"
    languages: list[str] = Field(default_factory=list)


class ApprovalDecisionRequest(BaseModel):
    decision: Literal["approve", "reject"]
    reviewer: str = "reviewer"


class ScreenNode(BaseModel):
    id: str
    title: str


class ScreenEdge(BaseModel):
    source: str
    target: str
    reason: str


class UIScreenMap(BaseModel):
    screens: list[ScreenNode]
    interactions: list[ScreenEdge]