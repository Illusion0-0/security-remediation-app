"""Email notification service — sends branded HTML report after PR creation."""
from __future__ import annotations

import logging
import os
import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from .models import RunRecord

logger = logging.getLogger(__name__)

_COLORS = {"Critical": "#dc2626", "High": "#ea580c", "Medium": "#ca8a04", "Low": "#16a34a"}


def _is_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))


def _build_html(run: RunRecord) -> str:
    sev_counts = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}
    for f in run.findings:
        sev = f.severity.value if hasattr(f.severity, "value") else str(f.severity)
        sev_counts[sev] = sev_counts.get(sev, 0) + 1

    total_vulns = len(run.findings)
    total_fixes = len(run.proposals)
    pr = run.pull_request

    sev_bars = ""
    for sev in ["Critical", "High", "Medium", "Low"]:
        count = sev_counts.get(sev, 0)
        color = _COLORS[sev]
        sev_bars += f'<div style="margin-bottom:8px;"><span style="display:inline-block;width:70px;color:#555;font-size:12px;">{sev}</span><span style="background:{color};color:#fff;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:bold;">{count}</span></div>'

    changed_files = run.remediation_summary.changed_files or []
    files_html = ""
    if changed_files:
        files_html = '<div style="margin:12px 0;"><strong style="font-size:13px;color:#333;">Changed Files:</strong><ul style="margin:6px 0;padding-left:20px;">'
        for f in changed_files[:15]:
            files_html += f'<li style="font-size:12px;color:#666;font-family:monospace;">{f}</li>'
        files_html += "</ul></div>"

    pr_html = ""
    if pr.url:
        pr_html = f'<div style="margin:16px 0;"><a href="{pr.url}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:600;font-size:14px;">View Pull Request</a></div>'

    pdf_link = f'<div style="margin:8px 0;"><a href="https://security-remediation-app.onrender.com/api/runs/{run.id}/executive-summary.pdf" style="color:#3b82f6;font-size:13px;text-decoration:none;">Download PDF Report</a></div>'

    status_val = run.status.value if hasattr(run.status, "value") else str(run.status)

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f0f2f5;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">dbSecureRemediate</h1>
      <p style="color:rgba(255,255,255,0.9);margin:4px 0 0;font-size:13px;">Security Remediation Complete</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <p style="color:#333;font-size:14px;margin:0 0 16px;">A security scan has completed and a pull request has been created.</p>
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:1;background:#fef2f2;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:28px;font-weight:bold;color:#dc2626;">{total_vulns}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;">Vulnerabilities</div>
        </div>
        <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:28px;font-weight:bold;color:#16a34a;">{total_fixes}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;">Fixes Applied</div>
        </div>
      </div>
      <div style="margin:12px 0;">
        <strong style="font-size:13px;color:#333;">Severity Distribution:</strong>
        <div style="margin-top:6px;">{sev_bars}</div>
      </div>
      {files_html}
      {pr_html}
      {pdf_link}
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;font-size:12px;color:#888;">
        <p style="margin:2px 0;"><strong>Run ID:</strong> <code>{run.id}</code></p>
        <p style="margin:2px 0;"><strong>Repository:</strong> {run.repo_url}</p>
        <p style="margin:2px 0;"><strong>Status:</strong> {status_val}</p>
      </div>
    </div>
    <p style="text-align:center;color:#999;font-size:11px;margin-top:12px;">Sent by dbSecureRemediate</p>
  </div>
</body></html>"""


def _send_smtp(run: RunRecord) -> None:
    try:
        host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER", "")
        password = os.getenv("SMTP_PASS", "")
        to_email = os.getenv("EMAIL_TO", user)
        from_email = os.getenv("EMAIL_FROM", f"dbSecureRemediate <{user}>")

        subject = f"[dbSecureRemediate] PR Created - {len(run.findings)} vulnerabilities fixed ({run.id[:8]})"
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = to_email

        text_body = f"""dbSecureRemediate - Security Remediation Complete

Run ID: {run.id}
Repository: {run.repo_url}
Vulnerabilities: {len(run.findings)}
Fixes Applied: {len(run.proposals)}
PR Status: {run.pull_request.status}

{f"PR URL: {run.pull_request.url}" if run.pull_request.url else ""}

View full report: https://security-remediation-app.onrender.com
"""
        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(_build_html(run), "html"))

        with smtplib.SMTP(host, port, timeout=30) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(user, [to_email], msg.as_string())

        logger.info("Email notification sent for run %s", run.id)
    except Exception as exc:
        logger.warning("Email notification failed for run %s: %s", run.id, exc)


def send_pr_notification(run: RunRecord) -> None:
    if not _is_configured():
        logger.debug("SMTP not configured, skipping email for run %s", run.id)
        return
    threading.Thread(target=_send_smtp, args=(run,), daemon=True).start()