"""Email notification via HTTP API (Resend) with SMTP fallback."""
from __future__ import annotations

import json
import logging
import os
import smtplib
import threading
import urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from .models import RunRecord

logger = logging.getLogger(__name__)

_COLORS = {"Critical": "#dc2626", "High": "#ea580c", "Medium": "#ca8a04", "Low": "#16a34a"}


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
        sev_bars += f'<div style="margin-bottom:8px;"><span style="display:inline-block;width:70px;color:#555;font-size:12px;">{sev}</span><span style="background:{_COLORS[sev]};color:#fff;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:bold;">{count}</span></div>'
    changed_files = run.remediation_summary.changed_files or []
    files_html = ""
    if changed_files:
        items = "".join(f'<li style="font-size:12px;color:#666;font-family:monospace;">{f}</li>' for f in changed_files[:15])
        files_html = f'<div style="margin:12px 0;"><strong style="font-size:13px;color:#333;">Changed Files:</strong><ul style="margin:6px 0;padding-left:20px;">{items}</ul></div>'
    pr_html = f'<div style="margin:16px 0;"><a href="{pr.url}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:600;font-size:14px;">View Pull Request</a></div>' if pr.url else ""
    pdf_link = f'<div style="margin:8px 0;"><a href="https://security-remediation-app.onrender.com/api/runs/{run.id}/executive-summary.pdf" style="color:#3b82f6;font-size:13px;text-decoration:none;">Download PDF Report</a></div>'
    status_val = run.status.value if hasattr(run.status, "value") else str(run.status)
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;margin:0;padding:0;background:#f0f2f5;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
<div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
<h1 style="color:#fff;margin:0;font-size:22px;">dbSecureRemediate</h1>
<p style="color:rgba(255,255,255,0.9);margin:4px 0 0;font-size:13px;">Security Remediation Complete</p>
</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
<p style="color:#333;font-size:14px;margin:0 0 16px;">Security scan completed, PR created.</p>
<div style="display:flex;gap:12px;margin-bottom:16px;">
<div style="flex:1;background:#fef2f2;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:28px;font-weight:bold;color:#dc2626;">{total_vulns}</div><div style="font-size:11px;color:#666;">Vulnerabilities</div></div>
<div style="flex:1;background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;"><div style="font-size:28px;font-weight:bold;color:#16a34a;">{total_fixes}</div><div style="font-size:11px;color:#666;">Fixes Applied</div></div>
</div>
<div style="margin:12px 0;"><strong style="font-size:13px;color:#333;">Severity:</strong><div style="margin-top:6px;">{sev_bars}</div></div>
{files_html}{pr_html}{pdf_link}
<div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;font-size:12px;color:#888;">
<p style="margin:2px 0;"><strong>Run ID:</strong> <code>{run.id}</code></p>
<p style="margin:2px 0;"><strong>Repository:</strong> {run.repo_url}</p>
</div></div></div></body></html>"""


def _send_via_resend(run: RunRecord) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        return False
    try:
        to_email = os.getenv("EMAIL_TO", "")
        from_email = os.getenv("EMAIL_FROM", "dbSecureRemediate <onboarding@resend.dev>")
        subject = f"[dbSecureRemediate] PR Created - {len(run.findings)} vulns ({run.id[:8]})"
        payload = json.dumps({"from": from_email, "to": [to_email], "subject": subject, "html": _build_html(run)}).encode("utf-8")
        req = urllib.request.Request("https://api.resend.com/emails", data=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                logger.info("Email sent via Resend for run %s", run.id)
                return True
    except Exception as exc:
        logger.warning("Resend failed for run %s: %s", run.id, exc)
    return False


def _send_via_smtp(run: RunRecord) -> bool:
    host = os.getenv("SMTP_HOST")
    if not host or not os.getenv("SMTP_USER") or not os.getenv("SMTP_PASS"):
        return False
    try:
        port = int(os.getenv("SMTP_PORT", "465"))
        user = os.getenv("SMTP_USER", "")
        password = os.getenv("SMTP_PASS", "")
        to_email = os.getenv("EMAIL_TO", user)
        from_email = os.getenv("EMAIL_FROM", f"dbSecureRemediate <{user}>")
        subject = f"[dbSecureRemediate] PR Created - {len(run.findings)} vulns ({run.id[:8]})"
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = to_email
        msg.attach(MIMEText(f"Run {run.id}: {len(run.findings)} vulns, PR: {run.pull_request.url or 'N/A'}", "plain"))
        msg.attach(MIMEText(_build_html(run), "html"))
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=30) as s:
                s.login(user, password)
                s.sendmail(user, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=30) as s:
                s.starttls()
                s.login(user, password)
                s.sendmail(user, [to_email], msg.as_string())
        logger.info("Email sent via SMTP for run %s", run.id)
        return True
    except Exception as exc:
        logger.warning("SMTP failed for run %s: %s", run.id, exc)
    return False


def _send(run: RunRecord) -> None:
    if _send_via_resend(run):
        return
    _send_via_smtp(run)


def send_pr_notification(run: RunRecord) -> None:
    if not (os.getenv("RESEND_API_KEY") or os.getenv("SMTP_HOST")):
        return
    threading.Thread(target=_send, args=(run,), daemon=True).start()
