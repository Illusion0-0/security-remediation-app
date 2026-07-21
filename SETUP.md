# AI-Assisted Secure Software Development — Setup Guide

Hackathon 2026 prototype for **Example 2.4: AI Assisted Secure Software Development**.

This guide sets up the complete two-service system plus the target vulnerable
repository so you can run the full scan → remediate → validate → PR flow.

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌───────────────────────┐
│  Service A (UI)     │     │  Service B (Agent)   │     │  Target Repo          │
│  security-remediation│────▶│  security-remediation │────▶│  vulnerable-banking-   │
│  -application       │ HTTP│  -agent               │     │  service               │
│  FastAPI + 10-screen│     │  Google ADK + Claude/ │     │  Java/Maven + 9 CVEs   │
│  UI, orchestrator   │     │  GLM/Gemini agents    │     │  (Log4Shell, etc.)     │
│  Port 8000          │     │  Port 8081            │     │  Local path            │
└─────────────────────┘     └──────────────────────┘     └───────────────────────┘
```

---

## Prerequisites

| Requirement | Min Version | Check |
|---|---|---|
| Python | 3.10+ | `python --version` |
| Java JDK | 17 | `java -version` |
| Maven | 3.8+ | `mvn -version` |
| Git | 2.40+ | `git --version` |
| JFrog CLI (`jf`) | *optional* | `jf --version` (falls back to static scanner if absent) |

### Install Maven (if missing)
```powershell
$toolsDir = "C:\Users\test\tools"
Invoke-WebRequest "https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip" -OutFile "$toolsDir\maven.zip"
Expand-Archive "$toolsDir\maven.zip" -DestinationPath $toolsDir -Force
[Environment]::SetEnvironmentVariable("Path", "$env:Path;$toolsDir\apache-maven-3.9.9\bin", "User")
```

---

## Setup Steps

### 1. Clone both repos (already done)
```
security-remediation-application/   <- UI + orchestrator (Service A)
security-remediation-agent/         <- ADK agents (Service B)
vulnerable-banking-service/         <- target repo with known CVEs
```

### 2. Create virtual environments + install dependencies

**Service B (Agent):**
```powershell
cd C:\Users\test\Desktop\Projects\security-remediation-agent
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --only-binary :all: -r requirements.txt
```

**Service A (Application):**
```powershell
cd C:\Users\test\Desktop\Projects\security-remediation-application
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --only-binary :all: -r requirements.txt
```

### 3. Configure the AI model (pluggable)

Set **one** of these environment variables depending on your chosen model:

```powershell
# Option A: Claude (Anthropic) — RECOMMENDED, auto-detected if key present
$env:ADK_MODEL = "claude-sonnet"
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# Option B: Gemini (Google) — keeps Google vendor award eligibility
$env:ADK_MODEL = "gemini-2.5-flash"
$env:GOOGLE_API_KEY = "..."

# Option C: GLM (Zhipu)
$env:ADK_MODEL = "glm-4"
$env:ZHIPUAI_API_KEY = "..."
```

If `ADK_MODEL` is unset, the system auto-selects based on which API key is present.

### 4. Configure the scanner backend (optional)

```powershell
# auto (default): uses JFrog CLI if installed, else static CVE database
$env:SCANNER_BACKEND = "auto"

# force offline static scanner (recommended for reliable demos)
$env:SCANNER_BACKEND = "static"

# force JFrog CLI (requires jf configured)
$env:SCANNER_BACKEND = "jf"
```

---

## Running the System

You need **two terminals** (one per service):

### Terminal 1 — Start the Agent (Service B)
```powershell
cd C:\Users\test\Desktop\Projects\security-remediation-agent
.\start_agent.bat
# OR manually:
.\.venv\Scripts\python.exe -m uvicorn api_server:app --host 127.0.0.1 --port 8081 --reload
```
Verify: open http://127.0.0.1:8081/health — should show `scanner_backend` and `status: ok`.

### Terminal 2 — Start the Application (Service A)
```powershell
cd C:\Users\test\Desktop\Projects\security-remediation-application
$env:ADK_SERVER_URL = "http://127.0.0.1:8081"
.\start_app.bat
# OR manually:
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```
Open: http://127.0.0.1:8000

---

## Running the Demo (End-to-End)

### Via the UI
1. Open http://127.0.0.1:8000
2. Start a new scan with the local target repo path:
   ```
   C:\Users\test\Desktop\Projects\vulnerable-banking-service
   ```
3. Review the 9 detected vulnerabilities (Log4Shell, Text4Shell, etc.)
4. Approve remediation
5. Watch the agent fix pom.xml and validate the build
6. View the generated PR link + evidence bundle

### Via the API (for testing)
```powershell
# 1. Create a run targeting the vulnerable repo
$body = @{ repo_url = "C:\Users\test\Desktop\Projects\vulnerable-banking-service"; requested_by = "demo" } | ConvertTo-Json
$resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/runs" -Method Post -Body $body -ContentType "application/json"
$runId = $resp.id
Write-Output "Run ID: $runId"

# 2. Poll for scan completion
Start-Sleep -Seconds 30
$run = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/runs/$runId"
Write-Output "Status: $($run.status), Findings: $($run.findings.Count)"

# 3. Approve remediation
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/runs/$runId/start-remediation" -Method Post

# 4. Poll until complete, then view evidence
Start-Sleep -Seconds 60
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/runs/$runId" | ConvertTo-Json -Depth 5
```

---

## "10" Anniversary Theme

This solution embodies the "10" theme as:
- **Top 10 critical CVEs** auto-remediated across the estate
- **10x faster** than manual triage (minutes vs hours/days)
- **10-screen UI** mapping the full remediation workflow

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `mvn` not found | Run Maven install step, restart terminal |
| ADK auth error | Set the correct `*_API_KEY` env var for your `ADK_MODEL` |
| Scan finds 0 vulns | Ensure target repo path is correct; check `SCANNER_BACKEND` |
| `jf` not configured | Set `$env:SCANNER_BACKEND = "static"` to use offline scanner |
| LiteLLM install fails | Use `--only-binary :all:` flag (avoids Rust build dependency) |
| Port already in use | Change `--port` in the startup command |