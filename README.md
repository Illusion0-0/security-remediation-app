# Agentic Dependency Remediation Prototype v2 (Pure ADK)

This folder contains a runnable hackathon prototype wired to an external ADK Agent Server. No local scan, remediation, validation, or evidence processing is executed inside this app.

- Scanner agent (ADK)
- Remediation agent (ADK)
- Validation agent (ADK)
- Report generation agent (ADK)
- Orchestrator: queue-based workflow and UI-facing state management

## What Is Implemented

- FastAPI backend with queue-driven orchestration for concurrent runs
- In-memory run store with events and run lifecycle state
- User approval gate to start remediation after vulnerabilities are shown
- UI prototype with 10 screens represented and interconnected
- Live run polling and approval actions from the UI
- ADK server integration via HTTP endpoints

## Project Structure

- [backend/main.py](backend/main.py) - API and application setup
- [backend/orchestrator.py](backend/orchestrator.py) - worker queue and orchestration lifecycle
- [backend/models.py](backend/models.py) - typed models for runs, findings, proposals, and evidence
- [backend/adk_agents/runner.py](backend/adk_agents/runner.py) - ADK server HTTP client for scan, remediate, validate, and report
- [backend/adk_agents/agent.py](backend/adk_agents/agent.py) - ADK graph definitions and prompts
- [frontend/index.html](frontend/index.html) - prototype UI shell
- [frontend/app.js](frontend/app.js) - UI behavior and API integration
- [frontend/styles.css](frontend/styles.css) - visual styling and responsive layout

## Run Locally

1. Create and activate a Python environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
cd /Users/kotwatu/Development/GitRepos/Services/TestJava/java-vulnerabilities-remover
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api_server:app --host 127.0.0.1 --port 8081
```

Set the ADK server integration variables:

```bash
export ADK_SERVER_URL="http://127.0.0.1:8081"
export ADK_SERVER_TIMEOUT_SECONDS="90"
# Optional auth:
# export ADK_SERVER_BEARER_TOKEN="<token>"
```

Start the server from this folder:

```bash
uvicorn backend.main:app --reload --port 8000
```

Open:

- http://127.0.0.1:8000

### API Highlights

- POST /api/runs - Create a new remediation run
- GET /api/runs - List all runs
- GET /api/runs/{run_id} - Get run detail
- POST /api/runs/{run_id}/start-remediation - User-approved remediation start
- POST /api/runs/{run_id}/approvals/{proposal_id} - Approve or reject a low-confidence fix
- GET /api/ui-map - Return the 10-screen interaction map

### ADK Server Endpoints Required

The ADK server configured by ADK_SERVER_URL must expose these POST endpoints:

- /scan -> { findings: [...] }
- /remediate/plan -> { proposals: [...] }
- /remediate/apply -> { workspace_path, changed_files, changes, diff_excerpt, pull_request }
- /validate -> { validations: [...] }
- /report -> { evidence: {...}, summary: "..." }

### Notes

This service only orchestrates workflow state; the ADK server performs all scanning, fixing, validation, and report logic.

If the ADK server is unreachable or returns invalid payloads, runs fail with explicit ADK endpoint errors.
