# dbSecureRemediate — Complete End-to-End Functional Walkthrough

## PHASE 1: USER INITIATES SCAN (Frontend → Backend)

### Step 1.1: User Opens Dashboard
```
User opens: https://security-remediation-app.onrender.com
    │
    ▼
Browser requests: GET /
    │
    ▼
main.py: index() → serves frontend/index.html
    │
    ▼
Browser loads:
    ├── styles.css (glassmorphism + 5 themes)
    ├── Chart.js (CDN)
    └── app.js (v=9)
    │
    ▼
app.js: init()
    ├── showPage("dashboard")
    ├── resetScanProgress()
    ├── closeRemediationModal()
    ├── loadRuns() → GET /api/runs → renderRuns()
    └── setInterval(poll, 3000)  // Polls every 3 seconds
```

### Step 1.2: User Clicks "+ New Scan"
```
User clicks "+ New Scan" button
    │
    ▼
app.js: openScanModal()
    └── scanModalShellEl.classList.remove("hidden")
    │
    ▼
Modal appears with:
    ├── Repository URL input
    ├── Language checkboxes (Java ✓, Python ✓, Node.js ✓)
    └── "Start Scan" button
```

### Step 1.3: User Fills Form and Clicks "Start Scan"
```
User enters: https://github.com/Illusion0-0/vulnerable-mono-repo
User checks: Java ✓ (unchecks Python, Node.js)
User clicks: "Start Scan"
    │
    ▼
app.js: scanFormEl.addEventListener("submit")
    │
    ├── Reads: repoUrl = "https://github.com/Illusion0-0/vulnerable-mono-repo"
    ├── Reads: languages = ["java"]
    ├── Disables startScanButtonEl
    ├── Shows scanProgressPanelEl (progress bar)
    │
    ▼
fetchJson("/api/runs", {
    method: "POST",
    body: { repo_url, requested_by: "hackathon-user", languages: ["java"] }
})
    │
    ▼
```

### Step 1.4: Backend Creates Run
```
main.py: create_run(payload: CreateRunRequest)
    │
    ├── run = RunRecord(
    │       repo_url = "https://github.com/Illusion0-0/vulnerable-mono-repo",
    │       requested_by = "hackathon-user",
    │       languages = ["java"],
    │       id = uuid4(),                          # e.g. "a79b1155-c414-..."
    │       status = RunStatus.QUEUED,
    │       phase = "queued"
    │   )
    │
    ├── store.create(run)
    │   └── PersistentRunStore:
    │       ├── self._runs[run.id] = run          # In-memory cache
    │       └── _persist_bg(run)                  # Background SQLite write
    │           └── Thread: INSERT INTO runs VALUES (id, JSON, timestamp)
    │
    ├── store.add_event(run.id, "Run created for repo ...")
    │
    ├── await orchestrator.submit(run.id)
    │   └── Puts run_id into asyncio.Queue
    │
    ▼
Returns RunRecord JSON to frontend
```

### Step 1.5: Frontend Tracks Progress
```
app.js receives run object
    │
    ├── state.selectedRunId = run.id
    ├── state.activeScanRunId = run.id
    ├── updateScanProgress(run)
    │   ├── Progress bar: 10%
    │   ├── Phase: "queued"
    │   └── Message: "Run created..."
    │
    └── await loadRuns() → re-renders dashboard with new run card
    │
    ▼
Background polling (every 3 seconds):
    setInterval → monitorActiveScan()
        └── GET /api/runs/{runId} → updateScanProgress()
```

---

## PHASE 2: SCAN EXECUTION (Orchestrator → Scanner)

### Step 2.1: Worker Picks Up Run
```
orchestrator.py: _worker_loop(worker_number=1)
    │
    ├── run_id = await self._queue.get()          # Blocks until run available
    │
    ├── await self._execute(run_id, worker_number)
    │
    ▼
_execute(run_id, "1"):
    │
    ├── run = store.get(run_id)
    │
    ├── run.status = RunStatus.RUNNING
    ├── store.add_event(run.id, "Worker-1 picked run {run_id}")
    │
    ▼
```

### Step 2.2: Repository Cloning
```
adk_agents/runner.py: run_scan(repo_url, run_id, languages=["java"])
    │
    ├── Clone repository:
    │   ├── git clone --depth 1 -b develop {repo_url}
    │   └── Workspace: /tmp/adk-workspace-{run_id}/
    │
    ├── Detect manifest files:
    │   ├── java-service/pom.xml          ← Found (Java)
    │   ├── python-service/requirements.txt  ← Skipped (not in languages)
    │   └── nodejs-service/package.json    ← Skipped (not in languages)
    │
    ▼
```

### Step 2.3: Vulnerability Scanning
```
multi_scanner.py: scan_workspace_multi(workspace_path, languages=["java"])
    │
    ├── Scan Java (java-service/pom.xml):
    │   │
    │   ├── Parse pom.xml → Extract dependencies:
    │   │   ├── org.apache.logging.log4j:log4j-core:2.14.1
    │   │   ├── org.apache.commons:commons-text:1.9
    │   │   ├── com.fasterxml.jackson.core:jackson-databind:2.13.0
    │   │   ├── org.yaml:snakeyaml:1.29
    │   │   ├── commons-io:commons-io:2.6
    │   │   ├── org.dom4j:dom4j:1.6.1
    │   │   ├── com.google.guava:guava:31.0-jre
    │   │   └── com.thoughtworks.xstream:xstream:1.4.18
    │   │
    │   ├── For each dependency → Query OSV.dev API:
    │   │   ├── POST https://api.osv.dev/v1/query
    │   │   ├── Body: {"package": {"name": "log4j-core", "ecosystem": "Maven"}, "version": "2.14.1"}
    │   │   └── Response: CVE-2021-44228 (Log4Shell), CVSS 10.0
    │   │
    │   ├── Aggregate all CVEs found:
    │   │   ├── log4j-core 2.14.1 → CVE-2021-44228 (Critical)
    │   │   ├── commons-text 1.9 → CVE-2022-42889 (Critical)
    │   │   ├── jackson-databind 2.13.0 → CVE-2020-36518 (High)
    │   │   ├── snakeyaml 1.29 → CVE-2022-1471 (Critical)
    │   │   ├── commons-io 2.6 → CVE-2021-29425 (High)
    │   │   ├── dom4j 1.6.1 → CVE-2020-10683 (Critical)
    │   │   ├── guava 31.0 → CVE-2023-2976 (Medium)
    │   │   └── xstream 1.4.18 → CVE-2021-39539 (Critical)
    │   │
    │   └── Return list of VulnerabilityFinding objects
    │
    ▼
Returns: [8 findings] to orchestrator
```

### Step 2.4: Store Findings + Await Approval
```
orchestrator.py: _execute()
    │
    ├── run.findings = all_findings              # 8 vulnerabilities
    ├── store.add_event(run.id, "Scanner found 8 findings for selected languages")
    │
    ├── run.status = RunStatus.AWAITING_APPROVAL
    ├── run.phase = "awaiting_remediation_start"
    ├── store.replace(run)                       # Persist to SQLite
    │
    ▼
Frontend detects status change (3-second poll):
    ├── monitorActiveScan() sees phase = "awaiting_remediation_start"
    ├── Closes scan modal
    ├── Opens run detail page
    └── Shows "⚠️ Approval Needed" + "▶ Start Remediation" button
    │
    ▼
USER REVIEWS FINDINGS:
    ├── 6-tab report system shows:
    │   ├── 📊 Executive: 8 vulns, severity distribution bars
    │   ├── 🔒 Vulnerabilities: Table with CVE links to NVD
    │   ├── 📝 Changes: (empty until remediation)
    │   ├── 🔧 Code Fix: (empty until remediation)
    │   ├── ✅ Tests: (empty until remediation)
    │   └── 📈 Score: 0% (nothing fixed yet)
    │
    ▼
USER CLICKS "Start Remediation"
```

---

## PHASE 3: REMEDIATION PIPELINE (AI + Code Fixes + Tests)

### Step 3.1: User Approves Remediation
```
app.js: startRemediation(runId)
    │
    ├── openRemediationModal()
    │   └── Shows progress bar (12%)
    │
    ├── fetchJson("/api/runs/{runId}/start-remediation", { method: "POST" })
    │
    ▼
main.py: start_remediation(run_id)
    │
    ├── run.remediation_requested = True
    ├── run.status = RunStatus.QUEUED
    ├── run.phase = "remediation_requested"
    ├── store.add_event(run.id, "User approved remediation. Orchestrator resumed.")
    ├── store.replace(run)
    │
    ├── await orchestrator.resume_if_ready(run_id)
    │   └── Puts run_id back into queue
    │
    ▼
Returns updated run to frontend
```

### Step 3.2: Orchestrator Resumes — Planning
```
orchestrator.py: _execute() resumes
    │
    ├── run.phase = "remediation"
    │
    ├── Plan proposals (if not already done):
    │   └── adk.plan_remediation(findings, repo_url, run_id)
    │       │
    │       ├── For each finding → determine fixed version:
    │       │   ├── log4j-core: 2.14.1 → 2.17.1 (fixes CVE-2021-44228)
    │       │   ├── commons-text: 1.9 → 1.10.0 (fixes CVE-2022-42889)
    │       │   ├── jackson-databind: 2.13.0 → 2.14.0 (fixes CVE-2020-36518)
    │       │   ├── snakeyaml: 1.29 → 2.0 (fixes CVE-2022-1471)
    │       │   ├── commons-io: 2.6 → 2.7 (fixes CVE-2021-29425)
    │       │   ├── dom4j: 1.6.1 → 2.1.3 (fixes CVE-2020-10683)
    │       │   ├── guava: 31.0 → 32.0.1-jre (fixes CVE-2023-2976)
    │       │   └── xstream: 1.4.18 → 1.4.20 (fixes CVE-2021-39539)
    │       │
    │       └── Create RemediationProposal for each (auto-approved)
    │
    ├── store.add_event(run.id, "Approved log4j-core 2.14.1→2.17.1")
    ├── store.add_event(run.id, "Approved commons-text 1.9→1.10.0")
    ├── ... (8 approval events)
    │
    ▼
```

### Step 3.3: Apply Remediation — File Editing
```
orchestrator.py: _execute()
    │
    ├── run.phase = "remediation_apply"
    ├── run.remediation_summary.status = "in_progress"
    │
    ├── adk.apply_remediation(repo_url, run_id, proposals)
    │   │
    │   ├── Calls api_server.py: POST /remediate/apply
    │   │
    │   ▼
    │   api_server.py: remediate_apply()
    │   │
    │   ├── Step 1: file_editor.apply_remediation(workspace, proposals)
    │   │   │
    │   │   ├── Read java-service/pom.xml
    │   │   ├── For each proposal:
    │   │   │   ├── Find <dependency> block in pom.xml
    │   │   │   ├── Replace <version>2.14.1</version> → <version>2.17.1</version>
    │   │   │   └── (repeat for all 8 dependencies)
    │   │   │
    │   │   ├── Write updated pom.xml to disk
    │   │   └── Return: { changed_files: ["java-service/pom.xml"], changes: [...] }
    │   │
    │   ├── Step 2: breaking_change_checker.check_breaking_changes()
    │   │   │
    │   │   ├── Scan .java files for known breaking patterns:
    │   │   │   ├── StreamUtils.java found:
    │   │   │   │   └── int bytesCopied = IOUtils.copy(input, output, 4096);
    │   │   │   │       ↑ Commons IO 2.7 changed return type int → long
    │   │   │   │
    │   │   │   ├── AUTO-FIX on disk:
    │   │   │   │   ├── int bytesCopied → long bytesCopied
    │   │   │   │   └── public int copyStream() → public long copyStream()
    │   │   │   │
    │   │   │   └── Write fixed StreamUtils.java to disk
    │   │   │
    │   │   └── Return: { status: "passed", fixes_applied: [{file: "StreamUtils.java", ...}] }
    │   │
    │   ├── Step 3: AI Fixer (only if tests fail — skipped if passing)
    │   │   └── ai_fixer.ai_fix_code() → GLM-4.5 generates code fix
    │   │
    │   ├── Step 4: Pick up ALL git changes (before PR creation)
    │   │   ├── git status --short
    │   │   ├── Filter: exclude target/, .class, node_modules, etc.
    │   │   └── changed_files = ["java-service/pom.xml", "java-service/.../StreamUtils.java"]
    │   │
    │   ├── Step 5: Create GitHub PR
    │   │   └── github_pr.create_pull_request()
    │   │       │
    │   │       ├── _parse_github_repo("https://github.com/Illusion0-0/vulnerable-mono-repo")
    │   │       │   └── Returns: ("Illusion0-0", "vulnerable-mono-repo")
    │   │       │
    │   │       ├── _github_token() → reads GH_TOKEN env var
    │   │       │
    │   │       ├── _get_default_branch() → "develop"
    │   │       │
    │   │       ├── Create branch: auto-remediation-a79b1155
    │   │       │   ├── DELETE existing branch (if any)
    │   │       │   ├── GET /repos/.../git/ref/heads/develop → base_sha
    │   │       │   └── POST /repos/.../git/refs → create branch from base_sha
    │   │       │
    │   │       ├── Commit each file via Contents API:
    │   │       │   ├── File 1: java-service/pom.xml
    │   │       │   │   ├── Read file from disk → base64 encode
    │   │       │   │   ├── GET /repos/.../contents/pom.xml?ref=develop → get SHA
    │   │       │   │   └── PUT /repos/.../contents/pom.xml
    │   │       │   │       ├── message: "fix(security): update pom.xml for vulnerability remediation"
    │   │       │   │       ├── content: base64_data
    │   │       │   │       ├── branch: "auto-remediation-a79b1155"
    │   │       │   │       └── sha: existing_file_sha
    │   │       │   │
    │   │       │   └── File 2: java-service/src/.../StreamUtils.java
    │   │       │       └── (same process)
    │   │       │
    │   │       ├── Open Pull Request:
    │   │       │   └── POST /repos/.../pulls
    │   │       │       ├── title: "[Auto-Remediation] Fix 8 vulnerabilities (a79b1155)"
    │   │       │       ├── body: "## Automated Security Remediation\n\n| Dependency | Old | New |\n|...|"
    │   │       │       ├── head: "auto-remediation-a79b1155"
    │   │       │       └── base: "develop"
    │   │       │
    │   │       └── Return: { status: "created", url: "https://github.com/.../pull/42" }
    │   │
    │   ├── Build response:
    │   │   ├── changed_files: ["java-service/pom.xml", "java-service/.../StreamUtils.java"]
    │   │   ├── changes: [{dependency, old_version, new_version, file_path}, ...]
    │   │   ├── diff_excerpt: "diff --git a/java-service/pom.xml ..."
    │   │   └── pull_request: { status: "created", url: "https://github.com/.../pull/42" }
    │   │
    │   └── Return to orchestrator
    │
    ▼
```

### Step 3.4: Store Remediation Results
```
orchestrator.py: _execute()
    │
    ├── run.remediation_summary.status = "completed"
    ├── run.remediation_summary.changed_files = ["pom.xml", "StreamUtils.java"]
    ├── run.remediation_summary.changes = [8 change objects]
    ├── run.remediation_summary.diff_excerpt = "diff --git ..."
    ├── run.pull_request = { status: "created", url: "https://github.com/.../pull/42" }
    │
    ├── store.add_event(run.id, "Remediation applied. files=2 pr=created")
    │
    ▼
```

---

## PHASE 4: FINALIZATION (Report + Email)

### Step 4.1: Generate Evidence Report
```
orchestrator.py: _finalize(run)
    │
    ├── run.phase = "evidence"
    │
    ├── adk.generate_report(run)
    │   └── Creates EvidenceBundle:
    │       ├── summary: "Run a79b1155: findings=8, proposals=8, validated=8/8, pr_status=created"
    │       ├── export_links: ["/api/runs/{id}/executive-summary.pdf"]
    │       └── audit_events: 15
    │
    ├── store.add_event(run.id, summary)
    │
    ▼
```

### Step 4.2: Mark Complete + Send Email
```
orchestrator.py: _finalize(run)
    │
    ├── run.status = RunStatus.COMPLETED
    ├── run.phase = "completed"
    ├── store.add_event(run.id, "Run completed")
    │
    ├── CHECK: run.pull_request.status == "created"? → YES
    │
    ├── send_pr_notification(run)
    │   │
    │   ├── email_notifier.py: send_pr_notification(run)
    │   │   ├── Check: RESEND_API_KEY set? → YES
    │   │   └── Start background thread:
    │   │       │
    │   │       ▼
    │   │       _send_via_resend(run)
    │   │           │
    │   │           ├── Build HTML email:
    │   │           │   ├── Header: "dbSecureRemediate" gradient
    │   │           │   ├── Summary cards: 8 vulns, 8 fixes
    │   │           │   ├── Severity bars: 5 Critical, 2 High, 1 Medium
    │   │           │   ├── Changed files: pom.xml, StreamUtils.java
    │   │           │   ├── PR button: → github.com/.../pull/42
    │   │           │   ├── PDF link: → /api/runs/{id}/executive-summary.pdf
    │   │           │   └── Footer: Run ID, repo URL
    │   │           │
    │   │           ├── POST https://api.resend.com/emails
    │   │           │   ├── Headers:
    │   │           │   │   ├── Authorization: Bearer re_4HyaHSJQ_...
    │   │           │   │   ├── Content-Type: application/json
    │   │           │   │   └── User-Agent: dbSecureRemediate/1.0
    │   │           │   ├── Body:
    │   │           │   │   ├── from: "onboarding@resend.dev"
    │   │           │   │   ├── to: ["work.with.tarunmishra@gmail.com"]
    │   │           │   │   ├── subject: "[dbSecureRemediate] PR Created - 8 vulns (a79b1155)"
    │   │           │   │   └── html: <full HTML template>
    │   │           │   │
    │   │           │   └── Response: 200 OK
    │   │           │       └── Email queued by Resend
    │   │           │
    │   │           └── logger.info("Email sent via Resend for run a79b1155")
    │   │
    │   └── store.add_event(run.id, "Email notification sent")
    │
    ├── store.replace(run)    # Final persist to SQLite
    │
    ▼
```

### Step 4.3: Frontend Detects Completion
```
app.js: monitorActiveRemediation() (3-second poll)
    │
    ├── GET /api/runs/{runId}
    ├── run.status == "completed" → YES
    │
    ├── state.activeRemediationRunId = null
    ├── Close remediation modal
    ├── showPage("run-detail")
    ├── await loadRuns() → dashboard updates with completed badge
    └── renderRunDetail(run) → 6-tab report fully populated
        │
        ├── 📊 Executive: KPIs (8 vulns, 8 fixes, 2 files, ✅ PR)
        ├── 🔒 Vulnerabilities: Full table with CVE links
        ├── 📝 Changes: pom.xml + StreamUtils.java version diffs
        ├── 🔧 Code Fix: Side-by-side diff viewer (int→long)
        ├── ✅ Tests: Bar chart (passed/failed)
        └── 📈 Score: Doughnut chart (100% - all fixed)
    │
    ▼
EMAIL ARRIVES IN GMAIL:
    ├── From: onboarding@resend.dev
    ├── Subject: [dbSecureRemediate] PR Created - 8 vulns (a79b1155)
    ├── HTML: Branded template with PR link + PDF link
    └── Delivered within seconds of PR creation
    │
    ▼
GITHUB PR IS LIVE:
    ├── URL: https://github.com/Illusion0-0/vulnerable-mono-repo/pull/42
    ├── Branch: auto-remediation-a79b1155 → develop
    ├── Files changed: pom.xml (8 version bumps) + StreamUtils.java (int→long)
    └── Status: Open, ready for review/merge
```

---

## PHASE 5: ANALYTICS (Cross-Scan Dashboard)

### Step 5.1: User Clicks "📊 Analytics"
```
app.js: showAnalytics()
    │
    ├── Switch to analytics page
    └── loadAnalytics()
        │
        ├── GET /api/analytics
        │
        ▼
main.py: analytics()
    │
    ├── runs = store.list()           # All runs from SQLite
    │
    ├── Aggregate:
    │   ├── total_runs = 15
    │   ├── total_vulnerabilities = 120
    │   ├── total_fixes_applied = 112
    │   ├── severity_distribution: {Critical: 45, High: 38, Medium: 25, Low: 12}
    │   ├── top_cves: [{cve: "CVE-2021-44228", count: 8}, ...]
    │   └── top_dependencies: [{dependency: "log4j-core", count: 8}, ...]
    │
    ├── Dynamic Exploitation Risks (NVD API):
    │   ├── For "CVE-2021-44228":
    │   │   ├── _query_nvd_cve("CVE-2021-44228")
    │   │   ├── GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2021-44228
    │   │   ├── Extract: CVSS 10.0, description, affected products
    │   │   └── Add to exploitation_risks
    │   └── (repeat for top 10 CVEs)
    │
    ├── Dynamic Recommendations:
    │   ├── log4j found in 8 scans → "Audit Log4j Usage" (Critical)
    │   ├── jackson found in 5 scans → "Jackson Deserialization Hardening" (High)
    │   ├── snakeyaml found in 4 scans → "SnakeYAML Safe Loading" (Critical)
    │   ├── + Always: "Dependency Scanning Policy", "Version Pinning", "SAST Integration"
    │   └── Return 6+ recommendations
    │
    ▼
Returns analytics JSON to frontend
    │
    ▼
app.js: renderAnalytics(data)
    ├── KPI cards: 15 scans, 120 vulns, 112 fixes, 93% fix rate
    ├── Doughnut chart: Severity distribution
    ├── Bar chart: Language distribution
    ├── Table: Top vulnerable dependencies
    ├── Table: Most common CVEs with impact descriptions
    ├── Cards: Exploitation risks (CVSS, real-world impact)
    └── Cards: Developer recommendations (with severity badges)
```

---

## COMPLETE TIMELINE (Wall Clock)

```
T+0s     │ User clicks "Start Scan"
T+0.5s   │ Run created in SQLite, orchestrator queued
T+1s     │ Worker picks up run, status → RUNNING
T+5s     │ Git clone complete
T+10s    │ OSV.dev queries complete (8 dependencies)
T+12s    │ Findings stored, status → AWAITING_APPROVAL
T+12s    │ Frontend shows findings (6-tab report)
         │
         │ ─── User reviews findings ───
         │
T+30s    │ User clicks "Start Remediation"
T+31s    │ Orchestrator resumes, plans proposals
T+33s    │ file_editor: pom.xml updated (8 version bumps)
T+35s    │ breaking_change_checker: StreamUtils.java fixed (int→long)
T+37s    │ git status scan → 2 files changed
T+40s    │ GitHub branch created
T+43s    │ GitHub commit 1: pom.xml pushed
T+45s    │ GitHub commit 2: StreamUtils.java pushed
T+47s    │ GitHub PR opened (pull/42)
T+48s    │ Email sent via Resend API
T+49s    │ Evidence report generated
T+50s    │ Status → COMPLETED, persisted to SQLite
T+50s    │ Frontend shows completed run with all tabs populated
T+52s    │ Email arrives in Gmail
         │
TOTAL: ~52 seconds end-to-end
```

---

## DATA TRANSFORMATION SUMMARY

```
Input: Repository URL + Language selection
    │
    ▼
Git Clone → pom.xml parsed → Dependencies extracted
    │
    ▼
OSV.dev API → CVEs matched → Severity assigned
    │
    ▼
8 VulnerabilityFindings (CVE, severity, fixed_version)
    │
    ▼
8 RemediationProposals (from→to, auto-approved)
    │
    ▼
file_editor → pom.xml rewritten (8 versions bumped)
breaking_change_checker → StreamUtils.java rewritten (int→long)
    │
    ▼
2 Changed Files on disk
    │
    ▼
GitHub API → Branch + 2 Commits + Pull Request
    │
    ▼
PR URL: https://github.com/.../pull/42
    │
    ▼
Resend API → HTML Email sent
    │
    ▼
SQLite → RunRecord persisted (survives redeploy)
    │
    ▼
Analytics → Aggregated across all runs
```

---

*End-to-End Functional Document for dbSecureRemediate*
*Built by Tarun Mishra · 2026*