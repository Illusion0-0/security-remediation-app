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



# Severity -> RGB color tuple for PDF
SEVERITY_COLORS = {
    "Critical": (0.8, 0.1, 0.1),
    "High": (0.9, 0.4, 0.1),
    "Medium": (0.8, 0.7, 0.1),
    "Low": (0.2, 0.7, 0.3),
}


def _build_pdf_content(run: RunRecord) -> list[dict]:
    """Build structured PDF content with sections, colors, and formatting."""
    items: list[dict] = []
    sev_counts = {}
    for f in run.findings:
        sev_counts[f.severity.value] = sev_counts.get(f.severity.value, 0) + 1

    items.append({"text": "SECURITY REMEDIATION REPORT", "font": "bold", "size": 18, "color": (0.1, 0.2, 0.5), "gap_after": 6})
    items.append({"text": "AI-Assisted Secure Software Development - Hackathon 2026", "font": "reg", "size": 9, "color": (0.4, 0.4, 0.4), "gap_after": 14})
    items.append({"text": "RUN SUMMARY", "font": "bold", "size": 11, "color": (0.2, 0.2, 0.2), "gap_after": 4})
    items.append({"text": f"  Run ID:          {run.id}", "font": "mono", "size": 9, "color": (0.3, 0.3, 0.3), "gap_after": 1})
    items.append({"text": f"  Repository:      {run.repo_url}", "font": "mono", "size": 9, "color": (0.3, 0.3, 0.3), "gap_after": 1})
    items.append({"text": f"  Status:          {run.status.value}", "font": "reg", "size": 9, "color": (0.3, 0.3, 0.3), "gap_after": 1})
    items.append({"text": f"  Phase:           {run.phase}", "font": "reg", "size": 9, "color": (0.3, 0.3, 0.3), "gap_after": 1})
    items.append({"text": f"  Requested By:    {run.requested_by}", "font": "reg", "size": 9, "color": (0.3, 0.3, 0.3), "gap_after": 10})
    items.append({"text": "VULNERABILITY SUMMARY", "font": "bold", "size": 11, "color": (0.2, 0.2, 0.2), "gap_after": 4})
    for sev in ["Critical", "High", "Medium", "Low"]:
        count = sev_counts.get(sev, 0)
        color = SEVERITY_COLORS.get(sev, (0.3, 0.3, 0.3))
        bar = "|" * min(count, 40)
        items.append({"text": f"  [{sev:8s}]  {count:>3d}  {bar}", "font": "mono", "size": 9, "color": color, "gap_after": 2})
    items.append({"text": f"  {'TOTAL':8s}  {len(run.findings):>3d}", "font": "bold", "size": 9, "color": (0.1, 0.1, 0.1), "gap_after": 10})

    if run.findings:
        items.append({"text": "DETAILED FINDINGS (Top 15)", "font": "bold", "size": 11, "color": (0.2, 0.2, 0.2), "gap_after": 4})
        for finding in run.findings[:15]:
            sev = finding.severity.value
            color = SEVERITY_COLORS.get(sev, (0.3, 0.3, 0.3))
            rec = (finding.recommended_versions[:1] or ["?"])[0]
            dep = finding.dependency[:38]
            items.append({"text": f"  [{sev[:4]}] {finding.cve:<16s} {dep:<38s} {finding.current_version[:10]:>10s} -> {rec[:10]}", "font": "mono", "size": 8, "color": color, "gap_after": 1})
        items.append({"text": "", "font": "reg", "size": 9, "color": (0, 0, 0), "gap_after": 10})

    if run.remediation_summary.changes:
        items.append({"text": "REMEDIATION CHANGES", "font": "bold", "size": 11, "color": (0.2, 0.2, 0.2), "gap_after": 4})
        for change in run.remediation_summary.changes[:15]:
            dep = change.dependency[:35]
            items.append({"text": f"  {dep:<35s} {change.old_version or '?':<12s} -> {change.new_version:<12s}", "font": "mono", "size": 8, "color": (0.2, 0.6, 0.2), "gap_after": 1})
        items.append({"text": "", "font": "reg", "size": 9, "color": (0, 0, 0), "gap_after": 10})

    pr = run.pull_request
    items.append({"text": "PULL REQUEST", "font": "bold", "size": 11, "color": (0.2, 0.2, 0.2), "gap_after": 4})
    items.append({"text": f"  Status:  {pr.status}", "font": "reg", "size": 9, "color": (0.3, 0.3, 0.3), "gap_after": 1})
    if pr.url:
        items.append({"text": f"  URL:     {pr.url[:80]}", "font": "mono", "size": 8, "color": (0.1, 0.3, 0.7), "gap_after": 10})
    else:
        items.append({"text": "", "font": "reg", "size": 9, "color": (0, 0, 0), "gap_after": 10})

    if run.evidence and run.evidence.summary:
        items.append({"text": "EVIDENCE SUMMARY", "font": "bold", "size": 11, "color": (0.2, 0.2, 0.2), "gap_after": 4})
        items.append({"text": f"  {run.evidence.summary}", "font": "reg", "size": 9, "color": (0.3, 0.3, 0.3), "gap_after": 10})

    if run.events:
        items.append({"text": "ACTIVITY LOG (Last 12)", "font": "bold", "size": 11, "color": (0.2, 0.2, 0.2), "gap_after": 4})
        for event in run.events[-12:]:
            icon = {"error": "[ERR]", "warn": "[WRN]", "info": "[INF]"}.get(event.level, "[---]")
            color = (0.8, 0.1, 0.1) if event.level == "error" else (0.7, 0.5, 0.1) if event.level == "warn" else (0.3, 0.3, 0.3)
            items.append({"text": f"  {icon} {event.message[:100]}", "font": "mono", "size": 7.5, "color": color, "gap_after": 1})

    return items


def _build_pdf_bytes_from_content(items: list[dict]) -> bytes:
    """Build a multi-font, colored PDF from structured content items."""
    page_width = 612
    page_height = 792
    left_margin = 50
    right_margin = 50
    top_margin = 56
    bottom_margin = 50

    def _rgb_to_pdf(rgb):
        return f"{rgb[0]:.2f} {rgb[1]:.2f} {rgb[2]:.2f}"

    rendered: list[dict] = []
    y = page_height - top_margin
    for item in items:
        size = item.get("size", 10)
        lh = size * 1.35
        char_width = max(0.5, size * 0.55)
        max_chars = max(1, int((page_width - left_margin - right_margin) / char_width))
        for wrapped_line in _wrap_text(item["text"], max_chars):
            y -= lh
            if y < bottom_margin:
                rendered.append({"_page_break": True})
                y = page_height - top_margin - lh
            rendered.append({**item, "text": wrapped_line, "y": y})
        y -= item.get("gap_after", 0)

    pages: list[list[dict]] = [[]]
    for r in rendered:
        if r.get("_page_break"):
            pages.append([])
        else:
            pages[-1].append(r)
    if not pages[0]:
        pages = [[]]

    objects: list[bytes] = []
    objects.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")

    first_page_obj = 5
    page_objs = [first_page_obj + i * 2 for i in range(len(pages))]
    content_objs = [p + 1 for p in page_objs]
    kids = " ".join(f"{p} 0 R" for p in page_objs)
    objects.append(f"2 0 obj << /Type /Pages /Kids [{kids}] /Count {len(page_objs)} >> endobj\n".encode("utf-8"))
    objects.append(b"3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")
    objects.append(b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n")

    font_map = {"bold": "F2", "reg": "F1", "mono": "F3"}

    for page_lines, page_obj_num, content_obj_num in zip(pages, page_objs, content_objs):
        resources = "<< /Font << /F1 3 0 R /F2 4 0 R >> >>"
        objects.append(f"{page_obj_num} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] /Resources {resources} /Contents {content_obj_num} 0 R >> endobj\n".encode("utf-8"))
        content_rows = ["BT"]
        for item in page_lines:
            font = font_map.get(item.get("font", "reg"), "F1")
            size = item.get("size", 10)
            color = _rgb_to_pdf(item.get("color", (0, 0, 0)))
            content_rows.append(f"{color} rg")
            content_rows.append(f"/{font} {size} Tf")
            content_rows.append(f"{left_margin} {item['y']:.1f} Td")
            content_rows.append(f"({_pdf_escape(item['text'])}) Tj")
        content_rows.append("ET")
        stream = "\n".join(content_rows).encode("utf-8")
        objects.append(f"{content_obj_num} 0 obj << /Length {len(stream)} >> stream\n".encode("utf-8") + stream + b"\nendstream endobj\n")

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
    buffer.extend(f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("utf-8"))
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
    run = RunRecord(repo_url=payload.repo_url, requested_by=payload.requested_by, languages=payload.languages)
    store.create(run)
    lang_msg = f" (languages: {', '.join(payload.languages)})" if payload.languages else ""
    store.add_event(run.id, f"Run created for repo {payload.repo_url}{lang_msg}")
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

    pdf_bytes = _build_pdf_bytes_from_content(_build_pdf_content(run)) if "SEVERITY_COLORS" in dir() else _build_pdf_bytes(_build_executive_summary_lines(run))
    headers = {
        "Content-Disposition": f'attachment; filename="executive-summary-{run.id}.pdf"',
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)

@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
