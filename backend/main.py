from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .models import (
    ApprovalDecisionRequest,
    ApprovalStatus,
    CreateRunRequest,
    RunRecord,
    RunStatus,
    UIScreenMap,
)
from .orchestrator import RemediationOrchestrator
from .store import RunStore

app = FastAPI(title="Agentic Vulnerability Remediation Prototype", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = RunStore()
orchestrator = RemediationOrchestrator(store=store)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def _wrap_text(text: str, width: int = 92) -> list[str]:
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if len(candidate) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines

def _build_executive_summary_lines(run: RunRecord) -> list[str]:
    lines = [
        "Agentic Dependency Remediation Executive Summary",
        f"Run ID: {run.id}",
        f"Repository: {run.repo_url}",
        f"Requested By: {run.requested_by}",
        f"Status: {run.status.value}",
        f"Phase: {run.phase}",
        f"Findings: {len(run.findings)}",
        f"Remediation Proposals: {len(run.proposals)}",
        f"Validation Results: {len(run.validations)}",
        f"PR Status: {run.pull_request.status}",
    ]
    if run.pull_request.url:
        lines.append(f"PR URL: {run.pull_request.url}")
    if run.pull_request.reason:
        lines.append(f"PR Reason: {run.pull_request.reason}")
    if run.evidence and run.evidence.summary:
        lines.append(f"Evidence: {run.evidence.summary}")
    lines.append("")
    lines.append("Top Findings:")
    if run.findings:
        for finding in run.findings[:12]:
            recs = ", ".join(finding.recommended_versions[:3]) if finding.recommended_versions else "none"
            lines.append(
                f"- {finding.severity.value} {finding.cve} {finding.dependency} {finding.current_version} fixed={recs}"
            )
    else:
        lines.append("- No vulnerabilities detected")

    lines.append("")
    lines.append("Remediation Changes:")
    if run.remediation_summary.changes:
        for change in run.remediation_summary.changes[:12]:
            lines.append(
                f"- {change.dependency}: {change.old_version or '(none)'} -> {change.new_version} in {change.file_path}"
            )
    else:
        lines.append("- No code or pom.xml changes recorded")

    lines.append("")
    lines.append("Recent Events:")
    for event in run.events[-10:]:
        lines.append(f"- [{event.level}] {event.message}")
    return lines

def _build_pdf_bytes(lines: list[str]) -> bytes:
    wrapped: list[str] = []
    for line in lines:
        wrapped.extend(_wrap_text(line))

    page_width = 612
    page_height = 792
    left_margin = 50
    top_margin = 64
    bottom_margin = 50
    line_height = 14
    lines_per_page = max(1, int((page_height - top_margin - bottom_margin) / line_height))
    pages = [wrapped[index : index + lines_per_page] for index in range(0, len(wrapped), lines_per_page)] or [[]]

    objects: list[bytes] = []
    objects.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")

    font_object_number = 3
    first_page_object_number = 4
    page_object_numbers = [first_page_object_number + index * 2 for index in range(len(pages))]
    content_object_numbers = [page_number + 1 for page_number in page_object_numbers]
    kids = " ".join(f"{page_number} 0 R" for page_number in page_object_numbers)
    objects.append(
        f"2 0 obj << /Type /Pages /Kids [{kids}] /Count {len(page_object_numbers)} >> endobj\n".encode("utf-8")
    )
    objects.append(b"3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")

    start_y = page_height - top_margin
    for page_number, content_number, page_lines in zip(page_object_numbers, content_object_numbers, pages):
        content_rows = ["BT", f"/F1 10 Tf", f"{left_margin} {start_y} Td", f"{line_height} TL"]
        first = True
        for line in page_lines:
            if first:
                content_rows.append(f"({_pdf_escape(line)}) Tj")
                first = False
            else:
                content_rows.append(f"T* ({_pdf_escape(line)}) Tj")
        content_rows.append("ET")
        stream = "\n".join(content_rows).encode("utf-8")

        objects.append(
            (
                f"{page_number} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] "
                f"/Resources << /Font << /F1 {font_object_number} 0 R >> >> /Contents {content_number} 0 R >> endobj\n"
            ).encode("utf-8")
        )
        objects.append(
            f"{content_number} 0 obj << /Length {len(stream)} >> stream\n".encode("utf-8")
            + stream
            + b"\nendstream endobj\n"
        )

    buffer = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(buffer))
        buffer.extend(obj)
    xref_offset = len(buffer)
    buffer.extend(f"xref\n0 {len(offsets)}\n".encode("utf-8"))
    buffer.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        buffer.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    buffer.extend(
        f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("utf-8")
    )
    return bytes(buffer)

@app.on_event("startup")
async def startup() -> None:
    await orchestrator.start()

@app.on_event("shutdown")
async def shutdown() -> None:
    await orchestrator.stop()

@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "workers": orchestrator.config.worker_count,
        "queued_runs": len(store.ids_by_status([RunStatus.QUEUED, RunStatus.RUNNING])),
    }

@app.get("/api/ui-map", response_model=UIScreenMap)
async def ui_map() -> UIScreenMap:
    return UIScreenMap(
        screens=[
            {"id": "s1", "title": "Login & Access"},
            {"id": "s2", "title": "Dashboard"},
            {"id": "s3", "title": "New Scan"},
            {"id": "s4", "title": "Run Detail"},
            {"id": "s5", "title": "Vulnerability Findings"},
            {"id": "s6", "title": "Fix Review"},
            {"id": "s7", "title": "Approval Queue"},
            {"id": "s8", "title": "PR & Validation Results"},
            {"id": "s9", "title": "Evidence Bundle"},
            {"id": "s10", "title": "Settings & Integrations"},
        ],
        interactions=[
            {"source": "s1", "target": "s2", "reason": "Authenticated entry"},
            {"source": "s2", "target": "s3", "reason": "Start scan"},
            {"source": "s2", "target": "s4", "reason": "Inspect run"},
            {"source": "s4", "target": "s5", "reason": "Inspect findings"},
            {"source": "s5", "target": "s6", "reason": "Review proposal"},
            {"source": "s6", "target": "s8", "reason": "High confidence auto path"},
            {"source": "s6", "target": "s7", "reason": "Low confidence approval path"},
            {"source": "s7", "target": "s8", "reason": "Approved and validated"},
            {"source": "s8", "target": "s9", "reason": "Generate evidence"},
            {"source": "s2", "target": "s10", "reason": "Manage integrations"},
        ],
    )

@app.post("/api/runs", response_model=RunRecord)
async def create_run(payload: CreateRunRequest) -> RunRecord:
    run = RunRecord(repo_url=payload.repo_url, requested_by=payload.requested_by)
    store.create(run)
    store.add_event(run.id, f"Run created for repo {payload.repo_url}")
    await orchestrator.submit(run.id)
    return run

@app.get("/api/runs", response_model=list[RunRecord])
async def list_runs() -> list[RunRecord]:
    return store.list()

@app.get("/api/runs/{run_id}", response_model=RunRecord)
async def get_run(run_id: str) -> RunRecord:
    run = store.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run

@app.post("/api/runs/{run_id}/approvals/{proposal_id}", response_model=RunRecord)
async def decide_approval(run_id: str, proposal_id: str, payload: ApprovalDecisionRequest) -> RunRecord:
    run = store.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    proposal = next((item for item in run.proposals if item.id == proposal_id), None)
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")

    if proposal.approval_status != ApprovalStatus.PENDING:
        raise HTTPException(status_code=409, detail="Proposal already decided")

    proposal.approval_status = (
        ApprovalStatus.APPROVED if payload.decision == "approve" else ApprovalStatus.REJECTED
    )
    store.add_event(
        run.id,
        f"{payload.reviewer} marked {proposal.dependency} as {proposal.approval_status.value}",
        level="warn" if proposal.approval_status == ApprovalStatus.REJECTED else "info",
    )

    if proposal.approval_status == ApprovalStatus.REJECTED:
        run.status = RunStatus.FAILED
        run.phase = "rejected"
        store.add_event(run.id, "Run stopped due to rejected remediation", level="error")
        return store.replace(run)

    await orchestrator.resume_if_ready(run.id)
    return store.replace(run)

@app.post("/api/runs/{run_id}/start-remediation", response_model=RunRecord)
async def start_remediation(run_id: str) -> RunRecord:
    run = store.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    if run.status == RunStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="Run already completed")
    if run.status == RunStatus.FAILED:
        raise HTTPException(status_code=409, detail="Run already failed")

    run.remediation_requested = True
    run.status = RunStatus.QUEUED
    run.phase = "remediation_requested"
    store.add_event(run.id, "User approved remediation. Orchestrator resumed for remediation workflow.")
    store.replace(run)
    await orchestrator.resume_if_ready(run.id)
    return run

@app.get("/api/runs/{run_id}/executive-summary.pdf")
async def executive_summary_pdf(run_id: str) -> Response:
    run = store.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    pdf_bytes = _build_pdf_bytes(_build_executive_summary_lines(run))
    headers = {
        "Content-Disposition": f'attachment; filename="executive-summary-{run.id}.pdf"',
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)

@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
