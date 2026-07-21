# Security Remediation Application

AI-Assisted Secure Software Development (Hackathon 2026 — Example 2.4).

The orchestration layer and 10-screen UI for the agentic vulnerability remediation
prototype. Connects to the [security-remediation-agent](https://github.com/Illusion0-0/security-remediation-agent)
via HTTP to scan, remediate, validate, and raise PRs.

## Features

- **10-screen prototype UI** — Dashboard → Scan → Findings → Review → Approval → PR → Evidence
- **Async orchestrator** — queue-driven workflow with concurrent workers
- **Human approval gate** — vulnerabilities shown before remediation starts
- **PDF executive summary** — downloadable evidence bundle
- **Retry logic** — automatic re-remediation on validation failure

## Quick Start

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --only-binary :all: -r requirements.txt

# Point at the agent server (Service B)
$env:ADK_SERVER_URL = "http://127.0.0.1:8081"

# Start the app (port 8000)
.\start_app.bat
```

Open: http://127.0.0.1:8000

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Service health + queue status |
| `POST /api/runs` | Create a new remediation run |
| `GET /api/runs` | List all runs |
| `GET /api/runs/{id}` | Get run detail |
| `POST /api/runs/{id}/start-remediation` | User-approved remediation start |
| `POST /api/runs/{id}/approvals/{proposal_id}` | Approve/reject a fix |
| `GET /api/runs/{id}/executive-summary.pdf` | Download PDF evidence |
| `GET /api/ui-map` | 10-screen interaction map |

## Architecture

```
backend/main.py           <- FastAPI app + endpoints + PDF generation
backend/orchestrator.py   <- Async worker queue + workflow state machine
backend/models.py         <- Pydantic models (Run, Finding, Proposal, etc.)
backend/store.py          <- In-memory run store
backend/adk_agents/       <- HTTP client to the agent server
frontend/                 <- HTML/JS/CSS 10-screen UI
```

## Workflow

```
Create Run → Scan → Show Findings → [User Approval]
  → Plan Remediation → Apply Fixes → Validate (retry ×2)
  → Generate Evidence → Complete
```

## Related Repositories

- [security-remediation-agent](https://github.com/Illusion0-0/security-remediation-agent) — The ADK agent (Service B)
- [vulnerable-mono-repo](https://github.com/Illusion0-0/vulnerable-mono-repo) — Target repo with 29 CVEs