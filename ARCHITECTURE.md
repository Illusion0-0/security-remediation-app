# dbSecureRemediate — Architecture Document (HLD + LLD)

## 1. EXECUTIVE SUMMARY

**dbSecureRemediate** is an AI-powered security remediation platform that automatically scans source code repositories for vulnerabilities, generates fix proposals, applies code changes, validates via tests, creates GitHub Pull Requests, and sends email notifications — all through a glassmorphism web dashboard.

- **Problem**: Manual vulnerability scanning and remediation is slow, error-prone, and doesn't scale across multiple repositories and languages.
- **Solution**: An automated pipeline that scans → plans → fixes → validates → creates PR → notifies, with zero developer intervention.
- **Scale**: Supports Java (Maven), Python (pip), Node.js (npm) — multi-language, multi-repo.

---

## 2. HIGH-LEVEL DESIGN (HLD)

### 2.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER LAYER                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  Web Browser  │  │  Email Inbox  │  │  GitHub (PRs + Code)     │  │
│  │  (Dashboard)  │  │  (Gmail)      │  │  (Pull Requests)         │  │
│  └──────┬───────┘  └───────▲───────┘  └───────────▲───────────────┘  │
└─────────┼──────────────────┼──────────────────────┼──────────────────┘
          │ HTTP/HTTPS       │ SMTP/API             │ GitHub API
          ▼                  │                      │
┌─────────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                                 │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              FastAPI Backend (Python 3.11)                   │    │
│  │                                                              │    │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐     │    │
│  │  │ REST API  │  │ Orchestrator  │  │  ADK Agent Runner   │     │    │
│  │  │ (FastAPI) │  │ (Async Queue) │  │  (Google ADK)       │     │    │
│  │  └────┬─────┘  └──────┬───────┘  └─────────┬──────────┘     │    │
│  │       │               │                     │                │    │
│  │  ┌────▼─────┐  ┌──────▼───────┐  ┌─────────▼──────────┐     │    │
│  │  │ SQLite/  │  │  Remediation  │  │   Scanner Agents    │     │    │
│  │  │ Postgres │  │  Pipeline     │  │   (Java/Py/Node)    │     │    │
│  │  │ Store    │  │               │  └────────────────────┘     │    │
│  │  └──────────┘  └───────────────┘                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Scanner  │  │  Fixer   │  │  Judge   │  │   GitHub PR      │   │
│  │(OSV.dev) │  │(GLM-4.5) │  │(AI)      │  │   Creator        │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
│                                                                      │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ Email    │  │ Analytics Engine  │  │ PDF Report Generator    │  │
│  │(Resend)  │  │(NVD + Aggregation)│  │(Custom PDF Builder)     │  │
│  └──────────┘  └──────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ OSV.dev  │  │ GLM-4.5  │  │  NVD     │  │ Resend   │          │
│  │ (Vuln DB)│  │ (z.ai)   │  │  (CVE)   │  │ (Email)  │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│  ┌──────────┐  ┌──────────────────┐                                │
│  │ GitHub   │  │ Render.com       │                                │
│  │ (Git/PR) │  │ (Hosting)        │                                │
│  └──────────┘  └──────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Core Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | HTML5, CSS3, Vanilla JS, Chart.js | Glassmorphism dashboard with 5 themes |
| **Backend API** | FastAPI (Python 3.11) | REST endpoints for scan/plan/apply/validate/report |
| **Orchestrator** | AsyncIO Queue + Workers | Manages scan lifecycle (queued → scanning → remediation → completed) |
| **Persistent Store** | SQLite / PostgreSQL | Survives redeployments, stores all run data |
| **Scanner** | OSV.dev API + Static Analysis | Multi-language vulnerability detection |
| **AI Fixer** | GLM-4.5 (z.ai) | Breaking change detection + code fixes |
| **PR Creator** | GitHub REST API | Creates branches, commits files, opens PRs |
| **Email Notifier** | Resend HTTP API | Branded HTML email post-PR creation |
| **PDF Generator** | Custom PDF builder | Executive summary reports with severity charts |
| **Analytics Engine** | NVD API + Aggregation | Cross-scan analytics, exploitation risks, recommendations |

### 2.3 High-Level Data Flow

```
User Clicks "New Scan"
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  1. CREATE   │────▶│  2. SCAN     │────▶│  3. PLAN     │
│  Run Record  │     │  Repository  │     │  Proposals   │
│  (SQLite)    │     │  (OSV.dev)   │     │  (Version    │
└─────────────┘     └──────────────┘     │   bumps)     │
                                         └──────┬───────┘
                                                │
                    ┌───────────────────────────┘
                    ▼
             ┌──────────────┐
             │ AWAITING     │ ◀── User reviews findings
             │ APPROVAL     │     Clicks "Start Remediation"
             └──────┬───────┘
                    │
                    ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 4. APPLY     │─▶│ 5. VALIDATE  │─▶│ 6. PR CREATE │─▶│ 7. NOTIFY    │
│ pom.xml      │  │ Breaking     │  │ GitHub API   │  │ Email + PDF  │
│ + Code Fix   │  │ Change Check │  │ Branch+Commit│  │ Resend API   │
│ (GLM-4.5)    │  │ + Tests      │  │ + Pull Req   │  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
                                                              │
                                                              ▼
                                                    ┌──────────────┐
                                                    │  COMPLETED   │
                                                    │  Run stored  │
                                                    │  in SQLite   │
                                                    └──────────────┘
```

### 2.4 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | HTML5 + CSS3 + Vanilla JS | ES2022 |
| Charts | Chart.js | 4.4.0 |
| Backend | FastAPI (Python) | 0.104+ |
| Runtime | Python | 3.11 |
| AI Framework | Google ADK | Latest |
| LLM | GLM-4.5 (z.ai) | Latest |
| Database | SQLite / PostgreSQL | SQLite 3 / PG 15 |
| Hosting | Render.com | Free Tier |
| Container | Docker | Dockerfile |
| CI/CD | GitHub + Render Auto-Deploy | — |
| Email | Resend API | v1 |
| Vulnerability DB | OSV.dev + NVD | REST API |

---

## 3. LOW-LEVEL DESIGN (LLD)

### 3.1 Backend Module Architecture

```
backend/
├── main.py                  # FastAPI app, REST endpoints, PDF generator, analytics
├── orchestrator.py           # Async worker pool, scan lifecycle state machine
├── persistent_store.py       # SQLite/PostgreSQL persistent storage
├── store.py                  # In-memory store (legacy/fallback)
├── email_notifier.py         # Resend HTTP API + SMTP fallback
├── models.py                 # Pydantic data models (RunRecord, Findings, etc.)
└── adk_agents/
    └── runner.py             # ADK pipeline runner (scan, plan, apply, report)
```

### 3.2 API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/runs` | Create a new scan run |
| GET | `/api/runs` | List all runs |
| GET | `/api/runs/{id}` | Get run details |
| POST | `/api/runs/{id}/approvals/{proposal_id}` | Approve/reject proposal |
| POST | `/api/runs/{id}/start-remediation` | Start remediation pipeline |
| GET | `/api/runs/{id}/executive-summary.pdf` | Download PDF report |
| GET | `/api/analytics` | Cross-scan analytics dashboard |
| GET | `/api/health` | Health check |
| GET | `/api/ui-map` | UI screen map (for design) |

### 3.3 Data Models

```python
RunRecord:
  id: UUID
  repo_url: str
  requested_by: str
  languages: [java, python, nodejs]
  status: queued | running | awaiting_approval | completed | failed
  phase: queued | scanning | awaiting_remediation_start | remediation | completed
  findings: [VulnerabilityFinding]
  proposals: [RemediationProposal]
  remediation_summary: RemediationSummary
  pull_request: PullRequestInfo
  evidence: EvidenceBundle
  events: [RunEvent]

VulnerabilityFinding:
  id, dependency, current_version, recommended_versions[], severity, cve

RemediationProposal:
  id, finding_id, dependency, from_version, to_version, reasoning, confidence_score

RemediationSummary:
  status, changed_files[], changes[], diff_excerpt, error
```

### 3.4 Scan Lifecycle State Machine

```
                    ┌─────────┐
                    │ QUEUED  │
                    └────┬────┘
                         │ Worker picks up
                         ▼
                    ┌─────────┐
                    │ SCANNING│
                    └────┬────┘
                         │ Findings found
                         ▼
              ┌─────────────────────┐
              │ AWAITING_APPROVAL   │
              │ (User clicks        │
              │  Start Remediation) │
              └──────────┬──────────┘
                         │
                         ▼
                    ┌──────────┐
                    │ REMEDI-  │
                    │ ATION    │
                    └────┬─────┘
                         │ Apply fixes + tests
                         ▼
                    ┌──────────┐
                    │ EVIDENCE │
                    │ (Report) │
                    └────┬─────┘
                         │
                         ▼
                    ┌──────────┐     ┌──────────┐
                    │COMPLETED │ OR  │  FAILED  │
                    └──────────┘     └──────────┘
```

### 3.5 Scanner Architecture (Multi-Language)

```
┌─────────────────────────────────────┐
│         multi_scanner.py             │
│                                      │
│  ┌─────────────┐ ┌────────────────┐ │
│  │ Java Scanner│ │ Python Scanner │ │
│  │ (pom.xml →  │ │ (requirements  │ │
│  │  OSV.dev)   │ │  → OSV.dev)    │ │
│  └─────────────┘ └────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Node.js Scanner                 │ │
│  │ (package.json → OSV.dev)        │ │
│  └─────────────────────────────────┘ │
│                                      │
│  Aggregates findings → deduplicates  │
│  → assigns severity (CVSS-based)     │
└─────────────────────────────────────┘
```

### 3.6 Remediation Pipeline (Detailed)

```
Step 1: file_editor.py
  ├── Parse pom.xml / requirements.txt / package.json
  ├── Apply version bumps (old → new)
  └── Return changed_files list

Step 2: breaking_change_checker.py
  ├── Scan .java files for known breaking patterns
  ├── Example: int bytesCopied = IOUtils.copy() → long (Commons IO 2.7)
  ├── Auto-fix code on disk
  └── Return fixes_applied list

Step 3: ai_fixer.py (if tests fail)
  ├── Call GLM-4.5 with failing test output
  ├── AI generates code fix
  ├── Apply fix to source file
  └── Re-run tests

Step 4: github_pr.py
  ├── Create branch (auto-remediation-{runId})
  ├── Commit each changed file via Contents API
  ├── Open Pull Request
  └── Return PR URL
```

### 3.7 Frontend Architecture

```
frontend/
├── index.html          # SPA shell (landing, analytics, run-detail pages)
├── app.js              # All frontend logic (state, API calls, rendering)
└── styles.css          # Glassmorphism + 5 themes + responsive

Pages:
  1. Dashboard (Landing) — Hero, flow diagram, features, recent runs
  2. Run Detail — 6-tab report system (Executive, Vulns, Changes, CodeFix, Tests, Score)
  3. Analytics — Cross-scan KPIs, charts, exploitation risks, recommendations

Components:
  - Theme Dropdown (5 themes: light, dark, contrast, CTF, hacker)
  - Scan Modal (with minimize-to-background)
  - Remediation Modal (with minimize-to-background)
  - Floating Background Process Pill
  - Side-by-side Diff Viewer (GitHub-style)
  - Chart.js Integration (doughnut, bar charts)
  - PDF Export (window.print per tab)
  - Footer with social links
```

### 3.8 Persistent Storage Schema

```sql
CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,           -- Full RunRecord as JSON
    updated_at TEXT NOT NULL      -- ISO timestamp
);

-- Each run is stored as a single JSON blob (Pydantic model)
-- Loaded into memory on startup, persisted async on every write
-- Supports PostgreSQL via DATABASE_URL env var
```

### 3.9 Email Notification Flow

```
PR Created (status="created")
    │
    ▼
orchestrator._finalize()
    │
    ├── send_pr_notification(run)
    │       │
    │       ▼ (background thread)
    │   _send_via_resend(run)
    │       ├── POST https://api.resend.com/emails
    │       ├── Headers: Authorization, Content-Type, User-Agent
    │       ├── Body: {from, to, subject, html}
    │       └── HTML template with severity bars, PR button, PDF link
    │
    └── store.add_event("Email notification sent")
```

### 3.10 Analytics Engine

```
/api/analytics endpoint:
    │
    ├── Aggregate all runs from PersistentStore
    ├── Count vulnerabilities by severity (Critical/High/Medium/Low)
    ├── Count by language (Java/Python/Node.js)
    ├── Top 10 CVEs (by frequency)
    ├── Top 10 vulnerable dependencies
    │
    ├── EXPLOITATION RISKS (Dynamic):
    │   ├── For each top CVE → query NVD API
    │   ├── Extract: CVSS score, description, affected products
    │   └── Fallback: static curated knowledge base (5 critical CVEs)
    │
    └── RECOMMENDATIONS (Dynamic):
        ├── Analyze top dependencies
        ├── Match against known patterns (log4j, jackson, snakeyaml, etc.)
        ├── Generate contextual advice with severity
        └── Always include best practices (scanning policy, version pinning, SAST)
```

---

## 4. DEPLOYMENT ARCHITECTURE

### 4.1 Render.com Deployment

```
┌─────────────────────────────────────────┐
│           Render.com (Free Tier)         │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │   Docker Container              │    │
│  │   (Python 3.11 + Maven + Git)   │    │
│  │                                 │    │
│  │   ┌───────────────────────┐     │    │
│  │   │  Uvicorn (ASGI)       │     │    │
│  │   │  Port 8081            │     │    │
│  │   │  FastAPI + Static     │     │    │
│  │   └───────────────────────┘     │    │
│  │                                 │    │
│  │   ┌───────────────────────┐     │    │
│  │   │  SQLite (data/runs.db)│     │    │
│  │   │  Ephemeral disk       │     │    │
│  │   └───────────────────────┘     │    │
│  └─────────────────────────────────┘    │
│                                          │
│  Auto-deploy from GitHub main branch     │
└─────────────────────────────────────────┘
         │
         ▼
   https://security-remediation-app.onrender.com
```

### 4.2 Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `GH_TOKEN` | GitHub PR creation | `ghp_xxxx` |
| `RESEND_API_KEY` | Email notifications | `re_xxxx` |
| `EMAIL_TO` | Email recipient | `user@gmail.com` |
| `EMAIL_FROM` | Email sender | `onboarding@resend.dev` |
| `DATABASE_URL` | PostgreSQL (optional) | `postgresql://...` |
| `DATA_DIR` | SQLite path | `/data` |
| `ZAI_API_KEY` | GLM-4.5 LLM | `xxxx` |
| `SCANNER_BACKEND` | Scanner mode | `auto` / `static` / `jf` |

---

## 5. SECURITY ARCHITECTURE

### 5.1 Authentication & Authorization
- GitHub token scoped to `repo` (PR creation only)
- No user authentication on dashboard (hackathon demo mode)
- Email API key stored as env var (never in code)

### 5.2 Data Security
- All API communication over HTTPS
- SQLite database stored server-side (never exposed to client)
- GitHub tokens never logged or returned in API responses
- Email credentials in env vars only

### 5.3 Input Validation
- Pydantic models validate all API inputs
- Repository URLs validated before cloning
- File paths sanitized before git operations

---

## 6. PERFORMANCE & SCALABILITY

### 6.1 Current Performance
- **Scan time**: 30-60 seconds per repository
- **Remediation**: 60-120 seconds (includes test + AI fix)
- **PR creation**: 5-10 seconds
- **Concurrent workers**: 3 (configurable)

### 6.2 Scaling Considerations
- **Horizontal**: Add more worker containers
- **Database**: Migrate SQLite → PostgreSQL (already supported)
- **Caching**: OSV.dev results could be cached (TTL-based)
- **Rate limits**: NVD API (5 req/30s), GitHub (5000/hr), Resend (100/day free)

---

## 7. MONITORING & OBSERVABILITY

### 7.1 Logging
- Python `logging` module throughout
- All orchestrator events stored in `RunRecord.events[]`
- Email send/fail logged with error details
- Resend API errors logged with response body

### 7.2 Health Checks
- `GET /api/health` returns worker count + queued runs
- Render performs HEAD / checks every 5 minutes

---

## 8. FUTURE ENHANCEMENTS

1. **GitHub App Integration** — Replace PAT with GitHub App for better security
2. **Slack/Teams Notifications** — Beyond email
3. **Scheduled Scans** — Cron-based weekly scans
4. **SAST Integration** — SonarQube, Semgrep, CodeQL
5. **Multi-Repo Batch** — Scan org-wide
6. **RBAC** — Role-based access control
7. **Webhook Integration** — Auto-scan on PR creation
8. **Custom Rules Engine** — Organization-specific policies

---

## 9. DIAGRAM DESCRIPTIONS FOR IMAGE GENERATION

### Diagram 1: System Architecture (3-Layer)
- **Top layer**: User (Browser, Email, GitHub)
- **Middle layer**: FastAPI Backend with sub-components (Orchestrator, Scanner, Fixer, PR Creator, Email, Analytics)
- **Bottom layer**: External APIs (OSV.dev, GLM-4.5, NVD, Resend, GitHub)
- **Style**: Glassmorphism cards with arrows showing data flow
- **Colors**: Blue (#3b82f6) primary, purple (#8b5cf6) secondary

### Diagram 2: Scan Lifecycle State Machine
- 7 states: Queued → Scanning → Awaiting Approval → Remediation → Evidence → Completed/Failed
- Show transitions with arrows and labels
- Color: Green for success path, Red for failure

### Diagram 3: Remediation Pipeline (Horizontal Flow)
- 7 steps with icons: Scan → Plan → Apply → Validate → PR → Email → Store
- Each step as a glassmorphism card
- Connecting arrows with labels

### Diagram 4: Data Flow (Sequence Diagram)
- Actors: User, Frontend, Backend, Scanner, AI, GitHub, Email
- Show request/response flow for a complete scan cycle
- Timeline format (top to bottom)

### Diagram 5: Tech Stack (Layered)
- Frontend: HTML, CSS, JS, Chart.js
- Backend: FastAPI, Python, ADK
- AI: GLM-4.5
- Data: SQLite, PostgreSQL
- External: OSV.dev, GitHub, NVD, Resend
- Render as hosting platform

---

*Document generated for dbSecureRemediate — AI-Powered Security Remediation Platform*
*Built by Tarun Mishra · 2026*