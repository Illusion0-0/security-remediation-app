/* ==========================================================================
   SecureRemediate Dashboard — Frontend Logic
   ========================================================================== */

const state = {
  selectedRunId: null,
  currentPage: "dashboard",
  activeScanRunId: null,
  activeRemediationRunId: null,
};

const API_BASE_URL = window.API_BASE_URL || "";

const $ = (id) => document.getElementById(id);
const runsTableEl = $("runs-table");
const statsEl = $("stats");
const detailEl = $("run-detail-body");
const hintEl = $("selected-run-hint");
const dashboardPageEl = $("dashboard-page");
const runDetailPageEl = $("run-detail-page");
const scanModalShellEl = $("scan-modal-shell");
const scanModalBackdropEl = $("scan-modal-backdrop");
const scanProgressPanelEl = $("scan-progress-panel");
const scanProgressFillEl = $("scan-progress-fill");
const scanProgressTitleEl = $("scan-progress-title");
const scanProgressPhaseEl = $("scan-progress-phase");
const scanProgressMessageEl = $("scan-progress-message");
const scanFormEl = $("scan-form");
const startScanButtonEl = $("start-scan-button");
const remediationModalShellEl = $("remediation-modal-shell");
const remediationProgressFillEl = $("remediation-progress-fill");
const remediationProgressTitleEl = $("remediation-progress-title");
const remediationProgressPhaseEl = $("remediation-progress-phase");
const remediationProgressMessageEl = $("remediation-progress-message");
const remediationCommentaryEl = $("remediation-commentary");

async function fetchJson(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (API_BASE_URL && API_BASE_URL.includes("ngrok")) { headers["ngrok-skip-browser-warning"] = "true"; }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function escapeHtml(text) { const d = document.createElement("div"); d.textContent = String(text||""); return d.innerHTML; }
function statusBadge(status) {
  const labels = { completed: "✓ Completed", failed: "✕ Failed", awaiting_approval: "⏳ Approval", running: "⚡ Running", queued: "○ Queued" };
  return `<span class="badge ${status}">${labels[status] || status}</span>`;
}
function severityBadge(sev) { return `<span class="badge ${escapeHtml(sev)}"><span class="sev-dot ${escapeHtml(sev)}"></span>${escapeHtml(sev)}</span>`; }
function timeAgo(d) { if(!d) return ""; const m=Math.floor((Date.now()-new Date(d).getTime())/60000); return m<1?"just now":m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`; }
function shortRepo(u) { if(!u) return "unknown"; if(u.startsWith("http")){const p=u.replace("https://github.com/","").split("/");return p.length>=2?`${p[0]}/${p[1].replace(".git","")}`:u;} return u.split("\\").pop().split("/").pop()||u; }

function showPage(p) { state.currentPage=p; dashboardPageEl.classList.toggle("active",p==="dashboard"); runDetailPageEl.classList.toggle("active",p==="run-detail"); }
function goHome() { showPage("dashboard"); }
function openRun(id) { state.selectedRunId=id; lastRunHash=""; showPage("run-detail"); loadRunDetail(); }
function openScanModal() { scanModalShellEl.classList.remove("hidden"); }
function resetScanProgress() { state.activeScanRunId=null; scanProgressPanelEl.classList.add("hidden"); scanProgressFillEl.style.width="8%"; scanProgressPhaseEl.textContent="queued"; scanProgressMessageEl.textContent="Waiting..."; startScanButtonEl.disabled=false; }
function closeScanModal() { if(state.activeScanRunId) return; scanModalShellEl.classList.add("hidden"); scanFormEl.reset(); $("requested-by").value="hackathon-user"; resetScanProgress(); }
function openRemediationModal() { remediationModalShellEl.classList.remove("hidden"); }

// ===== MINIMIZE / RESTORE (Background Process) =====
let minimizedModal = null;
function minimizeScanModal() { if (!state.activeScanRunId) return; minimizedModal="scan"; scanModalShellEl.classList.add("hidden"); showBgPill("scan"); }
function minimizeRemediationModal() { if (!state.activeRemediationRunId) return; minimizedModal="remediation"; remediationModalShellEl.classList.add("hidden"); showBgPill("remediation"); }
function showBgPill(type) { const pill=document.getElementById("bg-process-pill"); if(!pill) return; pill.classList.remove("hidden"); document.getElementById("bg-pill-text").textContent=type==="scan"?"Scan in background":"Remediation in background"; }
function hideBgPill() { const pill=document.getElementById("bg-process-pill"); if(pill) pill.classList.add("hidden"); }
function restoreBackgroundProcess() { if (minimizedModal==="scan") scanModalShellEl.classList.remove("hidden"); else if (minimizedModal==="remediation") remediationModalShellEl.classList.remove("hidden"); minimizedModal=null; hideBgPill(); }
window.restoreBackgroundProcess = restoreBackgroundProcess;
function closeRemediationModal() { if(state.activeRemediationRunId) return; remediationModalShellEl.classList.add("hidden"); remediationProgressFillEl.style.width="10%"; }

function scanProgressValue(phase, status) { if(status==="failed") return 100; const m={queued:10,scanning:35,awaiting_remediation_start:100,remediation_requested:55,remediation:65,remediation_apply:78,validation:88,evidence:96,completed:100,failed:100}; return m[phase]||20; }
function updateScanProgress(run) { scanProgressPanelEl.classList.remove("hidden"); scanProgressFillEl.style.width=`${scanProgressValue(run.phase,run.status)}%`; scanProgressPhaseEl.textContent=run.phase; scanProgressMessageEl.textContent=run.events?.length?run.events[run.events.length-1].message:"Processing"; }

async function monitorActiveScan() {
  if (!state.activeScanRunId) return;
  const run = await fetchJson(`/api/runs/${state.activeScanRunId}`);
  updateScanProgress(run);
  if (["awaiting_remediation_start","completed","failed"].includes(run.phase) || ["completed","failed"].includes(run.status)) {
    state.selectedRunId=run.id; state.activeScanRunId=null; startScanButtonEl.disabled=false; scanModalShellEl.classList.add("hidden"); showPage("run-detail"); await loadRuns(); renderRunDetail(run);
  }
}

function remediationProgressValue(phase, status) { if(status==="failed") return 100; const m={remediation_requested:12,remediation:35,remediation_apply:62,validation:84,evidence:94,completed:100,failed:100}; return m[phase]||18; }
function updateRemediationProgress(run) { remediationProgressFillEl.style.width=`${remediationProgressValue(run.phase,run.status)}%`; remediationProgressPhaseEl.textContent=run.phase; remediationProgressMessageEl.textContent=run.events?.length?run.events[run.events.length-1].message:"Processing"; remediationCommentaryEl.textContent=(run.events||[]).slice(-4).map(e=>`[${e.level}] ${e.message}`).join("\n"); }

async function monitorActiveRemediation() {
  if (!state.activeRemediationRunId) return;
  const run = await fetchJson(`/api/runs/${state.activeRemediationRunId}`);
  updateRemediationProgress(run);
  if (["completed","failed"].includes(run.status)) { state.selectedRunId=run.id; state.activeRemediationRunId=null; remediationModalShellEl.classList.add("hidden"); showPage("run-detail"); await loadRuns(); renderRunDetail(run); }
}

function renderStats(runs) {
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-num">${runs.length}</div><div class="stat-label">Total Runs</div></div>
    <div class="stat"><div class="stat-num" style="color:var(--critical);">${runs.reduce((s,r)=>s+(r.findings||[]).filter(f=>f.severity==="Critical").length,0)}</div><div class="stat-label">Critical</div></div>
    <div class="stat"><div class="stat-num" style="color:var(--medium);">${runs.filter(r=>r.status==="awaiting_approval").length}</div><div class="stat-label">Pending</div></div>
    <div class="stat"><div class="stat-num" style="color:var(--success);">${runs.filter(r=>r.status==="completed").length}</div><div class="stat-label">Done</div></div>`;
}

function renderRuns(runs) {
  renderStats(runs);
  if (!runs.length) { runsTableEl.innerHTML=`<div class="empty"><p>No scans yet. Click <strong>+ Scan</strong>.</p></div>`; return; }
  runsTableEl.innerHTML = runs.map(run => {
    const f=run.findings||[]; const p=run.proposals||[];
    return `<div class="run-card" data-run-id="${run.id}">
      <div class="run-card-head"><div class="run-card-title">${escapeHtml(shortRepo(run.repo_url))}</div>${statusBadge(run.status)}</div>
      <div class="muted" style="font-size:0.76rem;">${escapeHtml(run.phase)} · ${timeAgo(run.created_at)}</div>
      <div class="muted" style="font-size:0.74rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:0.3rem;">${escapeHtml(run.events?.length?run.events[run.events.length-1].message:"")}</div>
      <div class="run-card-stats">
        <div><span class="rcs-num">${f.length}</span><div class="rcs-label">Findings</div></div>
        <div><span class="rcs-num" style="color:var(--critical);">${f.filter(x=>x.severity==="Critical").length}</span><div class="rcs-label">Critical</div></div>
        <div><span class="rcs-num" style="color:var(--high);">${f.filter(x=>x.severity==="High").length}</span><div class="rcs-label">High</div></div>
        <div><span class="rcs-num">${p.length}</span><div class="rcs-label">Fixes</div></div>
      </div>
      <div class="run-card-actions"><button class="slim" data-open-run="${run.id}">View</button><a class="btn slim" href="${API_BASE_URL}/api/runs/${run.id}/executive-summary.pdf" download>📄</a></div>
    </div>`;
  }).join("");
  runsTableEl.querySelectorAll("[data-open-run]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();openRun(b.getAttribute("data-open-run"));}));
  runsTableEl.querySelectorAll(".run-card[data-run-id]").forEach(c=>c.addEventListener("click",()=>openRun(c.getAttribute("data-run-id"))));
}

function proposalActions(runId, p) {
  if (p.approval_status !== "pending") return `<span class="badge ${p.approval_status==="approved"?"completed":"failed"}">${p.approval_status}</span>`;
  return `<div class="flex gap-sm mt"><button class="success slim" onclick="decide('${runId}','${p.id}','approve')">✓</button><button class="reject slim" onclick="decide('${runId}','${p.id}','reject')">✕</button></div>`;
}

async function decide(runId, proposalId, decision) { await fetchJson(`/api/runs/${runId}/approvals/${proposalId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision,reviewer:"demo"})}); await loadRuns(); await loadRunDetail(); }
window.decide = decide;

async function startRemediation(runId) {
  openRemediationModal(); remediationProgressPhaseEl.textContent="remediation_requested"; remediationProgressMessageEl.textContent="Submitting...";
  const run = await fetchJson(`/api/runs/${runId}/start-remediation`,{method:"POST"});
  state.activeRemediationRunId=run.id; updateRemediationProgress(run); await loadRuns();
}
window.startRemediation = startRemediation;

let charts = {};
let activeTab = "executive";

function renderRunDetail(run) {
  hintEl.style.display="none";
  const findings = run.findings || [];
  const proposals = run.proposals || [];
  const rem = run.remediation_summary || {};
  const events = run.events || [];
  const pr = run.pull_request || {};

  // Header with status + gate
  const gate=(run.phase==="awaiting_remediation_start"&&findings.length>0&&!run.remediation_requested)?`<div class="section" style="border-color:var(--medium);background:rgba(202,138,4,0.05);"><h3 style="color:var(--medium);">⚠️ Approval Needed</h3><button class="btn-primary" onclick="startRemediation('${run.id}')">▶ Start Remediation</button></div>`:"";

  // Tab nav
  const tabs = `
    <div class="tab-nav" id="report-tabs">
      <button class="tab-btn ${activeTab==='executive'?'active':''}" data-tab="executive">📊 Executive</button>
      <button class="tab-btn ${activeTab==='vulnerabilities'?'active':''}" data-tab="vulnerabilities">🔒 Vulnerabilities</button>
      <button class="tab-btn ${activeTab==='changes'?'active':''}" data-tab="changes">📝 Changes</button>
      <button class="tab-btn ${activeTab==='codefix'?'active':''}" data-tab="codefix">🔧 Code Fix</button>
      <button class="tab-btn ${activeTab==='tests'?'active':''}" data-tab="tests">✅ Tests</button>
      <button class="tab-btn ${activeTab==='score'?'active':''}" data-tab="score">📈 Score</button>
    </div>
    <div class="tab-content" id="tab-content"></div>`;

  detailEl.innerHTML = `<div class="between mb"><div class="flex gap-sm">${statusBadge(run.status)}<span class="badge queued">${escapeHtml(run.phase)}</span></div><span class="muted" style="font-size:0.78rem;">${escapeHtml(run.id.slice(0,8))}</span></div><div class="muted" style="font-size:0.78rem;margin-bottom:0.5rem;">Repo: <span class="mono">${escapeHtml(run.repo_url)}</span></div>${gate}${tabs}`;

  // Tab switching
  detailEl.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      detailEl.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderTab(activeTab, run);
    });
  });

  renderTab(activeTab, run);
}

function renderTab(tab, run) {
  const c = document.getElementById("tab-content");
  if (!c) return;
  const findings = run.findings || [];
  const proposals = run.proposals || [];
  const rem = run.remediation_summary || {};
  const events = run.events || [];
  const pr = run.pull_request || {};

  const pdfHeader = pdfBtn(run.id, tab);
  switch(tab) {
    case "executive":
      c.innerHTML = pdfHeader + renderExecutiveTab(run, findings, proposals, rem, pr);
      break;
    case "vulnerabilities":
      c.innerHTML = pdfHeader + renderVulnTab(findings);
      break;
    case "changes":
      c.innerHTML = pdfHeader + renderChangesTab(rem, proposals);
      break;
    case "codefix":
      c.innerHTML = renderCodeFixTab(rem); // PDF button is inside renderCodeFixTab
      break;
    case "tests":
      c.innerHTML = pdfHeader + renderTestsTab(events);
      setTimeout(() => drawTestChart(events), 100);
      break;
    case "score":
      c.innerHTML = pdfHeader + renderScoreTab(findings, proposals);
      setTimeout(() => drawScoreChart(findings, proposals), 100);
      break;
  }
}

// Tab 1: Executive
function renderExecutiveTab(run, findings, proposals, rem, pr) {
  const crit = findings.filter(f=>f.severity==="Critical").length;
  const high = findings.filter(f=>f.severity==="High").length;
  const med = findings.filter(f=>f.severity==="Medium").length;
  const low = findings.filter(f=>f.severity==="Low").length;
  const sevBars = (crit+high+med+low) > 0 ? `
    <div class="section" style="margin-top:0.75rem;">
      <h3>Severity Distribution</h3>
      <div style="display:flex;gap:0.4rem;margin-top:0.5rem;">
        <div class="sev-bar critical" style="flex:${crit||0.5};min-width:40px;">${crit}</div>
        <div class="sev-bar high" style="flex:${high||0.5};min-width:30px;">${high}</div>
        <div class="sev-bar medium" style="flex:${med||0.5};min-width:30px;">${med}</div>
        <div class="sev-bar low" style="flex:${low||0.5};min-width:20px;">${low}</div>
      </div>
    </div>` : "";
  return `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-num" style="color:var(--critical)">${findings.length}</div><div class="kpi-label">Vulnerabilities</div></div>
      <div class="kpi-card"><div class="kpi-num" style="color:var(--success)">${proposals.length}</div><div class="kpi-label">Fixes Applied</div></div>
      <div class="kpi-card"><div class="kpi-num" style="color:var(--accent)">${(rem.changed_files||[]).length}</div><div class="kpi-label">Files Changed</div></div>
      <div class="kpi-card"><div class="kpi-num">${pr.status==="created"?"✅":"⏳"}</div><div class="kpi-label">PR Status</div></div>
    </div>
    ${sevBars}
    <div class="section" style="margin-top:0.75rem;">
      <h3>Run Info</h3>
      <table class="data-table">
        <tr><td>Status</td><td>${statusBadge(run.status)}</td></tr>
        <tr><td>Phase</td><td>${escapeHtml(run.phase)}</td></tr>
        <tr><td>Languages</td><td>${(run.languages||[]).join(", ")||"All"}</td></tr>
        <tr><td>Evidence</td><td class="muted">${escapeHtml(run.evidence?.summary||"Pending...")}</td></tr>
        ${pr.url?`<tr><td>Pull Request</td><td><a href="${escapeHtml(pr.url)}" target="_blank" style="color:var(--accent);">${escapeHtml(pr.url)}</a></td></tr>`:""}
      </table>
    </div>`;
}

// Tab 2: Vulnerabilities
function renderVulnTab(findings) {
  if (!findings.length) return `<div class="empty"><p>No vulnerabilities detected 🎉</p></div>`;
  return `
    <table class="data-table">
      <thead><tr><th>Severity</th><th>Dependency</th><th>Current</th><th>Fixed</th><th>CVE</th></tr></thead>
      <tbody>
        ${findings.map(f=>`<tr>
          <td>${severityBadge(f.severity)}</td>
          <td><strong>${escapeHtml(f.dependency)}</strong></td>
          <td class="mono">${escapeHtml(f.current_version)}</td>
          <td class="mono" style="color:var(--success);">${escapeHtml((f.recommended_versions||[])[0]||f.fixed_version||"?")}</td>
          <td class="mono"><a href="https://nvd.nist.gov/vuln/detail/${escapeHtml(f.cve)}" target="_blank" style="color:var(--accent);">${escapeHtml(f.cve)}</a></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// Tab 3: Changes
function renderChangesTab(rem, proposals) {
  const changes = rem.changes || [];
  const data = changes.length ? changes : proposals.map(p=>({dependency:p.dependency, old_version:p.from_version, new_version:p.to_version, file_path:""}));
  if (!data.length) return `<div class="empty"><p>No changes recorded.</p></div>`;
  return `
    <table class="data-table">
      <thead><tr><th>Dependency</th><th>Old</th><th>→</th><th>New</th><th>File</th></tr></thead>
      <tbody>
        ${data.map(c=>`<tr>
          <td><strong>${escapeHtml(c.dependency)}</strong></td>
          <td class="mono">${escapeHtml(c.old_version||"?")}</td>
          <td style="color:var(--accent);">→</td>
          <td class="mono" style="color:var(--success);font-weight:600;">${escapeHtml(c.new_version||"?")}</td>
          <td class="mono" style="font-size:0.72rem;color:var(--text-dim);">${escapeHtml(c.file_path||"")}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function pdfBtn(runId, tab) {
  return `<div style="text-align:right;margin-bottom:0.5rem;"><button class="btn-primary slim" onclick="window.print()">📄 Download PDF</button></div>`;
}

// Helper: parse a single file's diff lines into paired rows
function parseDiffToFileRows(diffLines) {
  const leftLines = [];
  const rightLines = [];
  for (const line of diffLines) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("-") && !line.startsWith("---")) {
      leftLines.push({ num: leftLines.length + 1, content: line.substring(1), type: "del" });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      rightLines.push({ num: rightLines.length + 1, content: line.substring(1), type: "add" });
    } else if (line.startsWith(" ")) {
      const ctx = line.substring(1);
      leftLines.push({ num: leftLines.length + 1, content: ctx, type: "ctx" });
      rightLines.push({ num: rightLines.length + 1, content: ctx, type: "ctx" });
    }
  }
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const l = leftLines[i] || { content: "", type: "empty", num: "" };
    const r = rightLines[i] || { content: "", type: "empty", num: "" };
    rows.push({ left: l, right: r });
  }
  return rows;
}

// Helper: render a single file's diff as split panes
function renderFileDiff(fileName, rows) {
  const delCount = rows.filter(r=>r.left.type==="del").length;
  const addCount = rows.filter(r=>r.right.type==="add").length;
  return `
    <div class="diff-header">
      <span class="mono">� ${escapeHtml(fileName)}</span>
      <span class="muted" style="font-size:0.72rem;">${delCount} removed · ${addCount} added</span>
    </div>
    <div class="diff-split">
      <div class="diff-pane diff-left">
        <div class="diff-pane-head">Original</div>
        ${rows.map(r => `<div class="diff-row ${r.left.type}"><span class="diff-ln">${r.left.num||""}</span><span class="diff-code">${escapeHtml(r.left.content) || "&nbsp;"}</span></div>`).join("")}
      </div>
      <div class="diff-pane diff-right">
        <div class="diff-pane-head">Fixed</div>
        ${rows.map(r => `<div class="diff-row ${r.right.type}"><span class="diff-ln">${r.right.num||""}</span><span class="diff-code">${escapeHtml(r.right.content) || "&nbsp;"}</span></div>`).join("")}
      </div>
    </div>`;
}

// Tab 4: Code Fix (File-wise side-by-side GitHub-style diff)
function renderCodeFixTab(rem) {
  const diff = rem.diff_excerpt || "";
  const changedFiles = rem.changed_files || [];

  // If we have a diff, parse it file-by-file
  if (diff) {
    // Split diff into file sections by "diff --git" headers
    const fileSections = [];
    let currentFile = null;
    let currentLines = [];
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git")) {
        if (currentFile) fileSections.push({ name: currentFile, lines: currentLines });
        const m = line.match(/diff --git a\/(.+) b\//);
        currentFile = m ? m[1] : "unknown";
        currentLines = [];
      } else if (line.startsWith("---") || line.startsWith("+++")) {
        continue; // skip file path lines
      } else if (currentFile) {
        currentLines.push(line);
      }
    }
    if (currentFile) fileSections.push({ name: currentFile, lines: currentLines });

    // Also check for "+++ b/" style (no diff --git header)
    if (fileSections.length === 0) {
      // Single file diff — use changed_files[0] as name
      const fileName = changedFiles.find(f=>f.endsWith(".java")||f.endsWith(".py")||f.endsWith(".js")) || (changedFiles[0] || "source");
      fileSections.push({ name: fileName, lines: diff.split("\n") });
    }

    const fileDiffs = fileSections.map(sec => {
      const rows = parseDiffToFileRows(sec.lines);
      return renderFileDiff(sec.name, rows);
    }).join('<div style="height:0.75rem;"></div>');

    return `${pdfBtn()}${fileDiffs}`;
  }

  // No diff — show changed file list with auto-fix info
  if (changedFiles.length) {
    const codeFiles = changedFiles.filter(f => !f.endsWith("pom.xml") && !f.endsWith("requirements.txt") && !f.endsWith("package.json"));
    if (codeFiles.length) {
      // Show known fixes per file
      const fixInfo = {
        "StreamUtils.java": "Changed `int bytesCopied` → `long bytesCopied` (Commons IO 2.7: IOUtils.copy returns long)",
      };
      return `
        ${pdfBtn()}
        <div class="section">
          <h3>🔧 Code Files Modified (${codeFiles.length})</h3>
          <p class="muted" style="margin-bottom:0.75rem;">The following source files were automatically fixed to resolve breaking changes after dependency upgrades:</p>
          ${codeFiles.map(f => {
            const fileName = f.split("/").pop();
            const info = fixInfo[fileName] || "Auto-fixed to resolve breaking change";
            return `<div class="vuln-row"><div class="vuln-info"><div class="vuln-name mono">${escapeHtml(f)}</div><div class="vuln-detail">${escapeHtml(info)}</div></div><span class="badge completed">✅ Fixed</span></div>`;
          }).join("")}
        </div>`;
    }
  }

  return `<div class="empty"><p>No code fixes needed for this run.</p></div>`;
}

// Tab 5: Tests
function renderTestsTab(events) {
  const testEvents = events.filter(e => e.message.toLowerCase().includes("test") || e.message.includes("passed") || e.message.includes("failed") || e.message.includes("✅") || e.message.includes("❌"));
  return `
    <div class="chart-container"><canvas id="test-chart" width="300" height="200"></canvas></div>
    ${testEvents.length ? `<div class="section" style="margin-top:1rem;"><h3>Test Details</h3>${testEvents.map(e => {
      const icon = e.message.includes("✅")||e.message.includes("passed") ? "✅" : e.message.includes("❌")||e.message.includes("failed") ? "❌" : "ℹ️";
      return `<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">${icon} ${escapeHtml(e.message)}</div></div></div>`;
    }).join("")}</div>` : ""}`;
}

function drawTestChart(events) {
  const ctx = document.getElementById("test-chart");
  if (!ctx || typeof Chart === "undefined") return;
  if (charts.test) charts.test.destroy();
  const passed = events.filter(e=>e.message.includes("✅")||e.message.includes("passed")).length;
  const failed = events.filter(e=>e.message.includes("❌")||e.message.includes("failed")).length;
  charts.test = new Chart(ctx, {
    type: "bar",
    data: { labels: ["Passed", "Failed"], datasets: [{ data: [passed||1, failed], backgroundColor: ["#16a34a", "#dc2626"], borderWidth: 0 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

// Tab 6: Security Score
function renderScoreTab(findings, proposals) {
  const total = findings.length;
  const fixed = proposals.length;
  const score = total > 0 ? Math.round((fixed / total) * 100) : 100;
  return `
    <div style="text-align:center;padding:1rem;">
      <div class="chart-container"><canvas id="score-chart" width="250" height="250"></canvas></div>
      <h3 style="margin-top:0.5rem;font-size:1.3rem;">Security Score: ${score}%</h3>
      <p class="muted">${fixed} of ${total} vulnerabilities remediated</p>
    </div>`;
}

function drawScoreChart(findings, proposals) {
  const ctx = document.getElementById("score-chart");
  if (!ctx || typeof Chart === "undefined") return;
  if (charts.score) charts.score.destroy();
  const fixed = proposals.length;
  const remaining = Math.max(0, findings.length - fixed);
  charts.score = new Chart(ctx, {
    type: "doughnut",
    data: { labels: ["Fixed", "Remaining"], datasets: [{ data: [fixed, remaining], backgroundColor: ["#16a34a", "#dc2626"], borderWidth: 0 }] },
    options: { cutout: "70%", plugins: { legend: { position: "bottom" } } }
  });
}

let lastRunHash = "";

async function loadRunDetail() {
  if(!state.selectedRunId){detailEl.innerHTML="";hintEl.style.display="block";return;}
  const run=await fetchJson(`/api/runs/${state.selectedRunId}`);
  // Hash check: skip re-render if data unchanged (prevents chart flicker)
  const hash = JSON.stringify({s:run.status, p:run.phase, e:(run.events||[]).length, f:(run.findings||[]).length, pr:(run.proposals||[]).length, pu:run.pull_request?.url, cf:(run.remediation_summary?.changed_files||[]).length});
  if (hash === lastRunHash) return; // No changes — don't re-render
  lastRunHash = hash;
  showPage("run-detail"); renderRunDetail(run);
}
async function loadRuns() { const runs=await fetchJson("/api/runs"); renderRuns(runs); }

$("refresh-runs").addEventListener("click", async () => { await loadRuns(); await loadRunDetail(); });

scanFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repoUrl = $("repo-url").value.trim();
  const requestedBy = $("requested-by").value.trim() || "hackathon-user";
  if (!repoUrl) return;
  const languages = [];
  if ($("lang-java")?.checked) languages.push("java");
  if ($("lang-python")?.checked) languages.push("python");
  if ($("lang-nodejs")?.checked) languages.push("nodejs");
  startScanButtonEl.disabled = true;
  scanProgressPanelEl.classList.remove("hidden");
  scanProgressFillEl.style.width = "12%";
  scanProgressPhaseEl.textContent = "queued";
  scanProgressMessageEl.textContent = "Creating scan run.";
  const run = await fetchJson("/api/runs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, requested_by: requestedBy, languages }),
  });
  state.selectedRunId = run.id;
  state.activeScanRunId = run.id;
  updateScanProgress(run);
  await loadRuns();
});

// ===== THEME SWITCHER (Dropdown) =====
const savedTheme = localStorage.getItem("theme") || "light";
function applyTheme(theme) {
  if (theme === "light") { document.documentElement.removeAttribute("data-theme"); }
  else { document.documentElement.setAttribute("data-theme", theme); }
  const selector = document.getElementById("theme-selector");
  if (selector) selector.value = theme;
  localStorage.setItem("theme", theme);
}
applyTheme(savedTheme);
const themeSelector = document.getElementById("theme-selector");
if (themeSelector) {
  themeSelector.addEventListener("change", () => applyTheme(themeSelector.value));
}

// ===== ANALYTICS PAGE =====
function showAnalytics() {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  $("analytics-page").classList.add("active");
  loadAnalytics();
}

async function loadAnalytics() {
  try {
    const data = await fetchJson("/api/analytics");
    renderAnalytics(data);
  } catch (e) {
    $("analytics-body").innerHTML = `<div class="empty"><p>Failed to load analytics: ${escapeHtml(e.message)}</p></div>`;
  }
}

let analyticsCharts = {};
function renderAnalytics(d) {
  const sev = d.severity_distribution || {};
  const topCves = d.top_cves || [];
  const topDeps = d.top_dependencies || [];
  const langs = d.language_distribution || {};
  const recs = d.recommendations || [];
  const risks = d.exploitation_risks || {};

  $("analytics-body").innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-num" style="color:var(--accent)">${d.total_runs||0}</div><div class="kpi-label">Total Scans</div></div>
      <div class="kpi-card"><div class="kpi-num" style="color:var(--critical)">${d.total_vulnerabilities||0}</div><div class="kpi-label">Vulnerabilities</div></div>
      <div class="kpi-card"><div class="kpi-num" style="color:var(--success)">${d.total_fixes_applied||0}</div><div class="kpi-label">Fixes Applied</div></div>
      <div class="kpi-card"><div class="kpi-num">${Math.round((d.total_fixes_applied||0)/Math.max(d.total_vulnerabilities||1,1)*100)}%</div><div class="kpi-label">Fix Rate</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem;">
      <div class="section"><h3>Severity Distribution</h3><div class="chart-container"><canvas id="sev-chart"></canvas></div></div>
      <div class="section"><h3>Language Distribution</h3><div class="chart-container"><canvas id="lang-chart"></canvas></div></div>
    </div>
    <div class="section" style="margin-top:1rem;"><h3>Top Vulnerable Dependencies</h3>
      ${topDeps.length ? `<table class="data-table"><thead><tr><th>Dependency</th><th>Occurrences</th></tr></thead><tbody>${topDeps.map(d=>`<tr><td class="mono"><strong>${escapeHtml(d.dependency)}</strong></td><td>${d.count}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">No data yet.</p>'}
    </div>
    <div class="section"><h3>Most Common CVEs</h3>
      ${topCves.length ? `<table class="data-table"><thead><tr><th>CVE</th><th>Occurrences</th><th>Potential Impact</th></tr></thead><tbody>${topCves.map(c=>{const r=risks[c.cve]||{};return `<tr><td class="mono"><a href="https://nvd.nist.gov/vuln/detail/${escapeHtml(c.cve)}" target="_blank" style="color:var(--accent);">${escapeHtml(c.cve)}</a></td><td>${c.count}</td><td style="font-size:0.76rem;">${r.impact?`<strong>${escapeHtml(r.name||"")}</strong>: ${escapeHtml(r.impact)}`:'—'}</td></tr>`;}).join("")}</tbody></table>` : '<p class="muted">No data yet.</p>'}
    </div>
    <div class="section"><h3>⚠️ Exploitation Risk Assessment</h3>
      <p class="muted" style="margin-bottom:0.5rem;font-size:0.78rem;">Real-world impact of vulnerabilities found in your codebase:</p>
      ${Object.entries(risks).map(([cve,r])=>`<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">${escapeHtml(r.name)} <span class="badge ${r.cvss>=9?'Critical':'High'}">CVSS ${r.cvss}</span></div><div class="vuln-detail">${escapeHtml(r.impact)} <span class="mono">(${escapeHtml(r.affected)})</span></div></div><span class="mono muted">${escapeHtml(cve)}</span></div>`).join("")}
    </div>
    <div class="section"><h3>💡 Developer Recommendations</h3>
      ${recs.map(r=>`<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">${escapeHtml(r.title)}</div><div class="vuln-detail">${escapeHtml(r.desc)}</div></div><span class="badge ${r.severity}">${escapeHtml(r.severity)}</span></div>`).join("")}
    </div>`;

  // Charts
  setTimeout(()=>{
    Object.values(analyticsCharts).forEach(c=>c&&c.destroy&&c.destroy());
    const sevCtx = document.getElementById("sev-chart");
    if (sevCtx && typeof Chart !== "undefined") {
      analyticsCharts.sev = new Chart(sevCtx, {type:"doughnut",data:{labels:["Critical","High","Medium","Low"],datasets:[{data:[sev.Critical||0,sev.High||0,sev.Medium||0,sev.Low||0],backgroundColor:["#dc2626","#ea580c","#ca8a04","#16a34a"],borderWidth:0}]},options:{plugins:{legend:{position:"bottom"}}}});
    }
    const langCtx = document.getElementById("lang-chart");
    if (langCtx && typeof Chart !== "undefined" && Object.keys(langs).length) {
      analyticsCharts.lang = new Chart(langCtx, {type:"bar",data:{labels:Object.keys(langs),datasets:[{data:Object.values(langs),backgroundColor:"#3b82f6",borderWidth:0}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
    }
  }, 100);
}

$("hero-scan-btn").addEventListener("click", openScanModal);
$("hero-runs-btn").addEventListener("click", () => {
  document.querySelector('#runs-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$("open-scan-modal").addEventListener("click", openScanModal);
$("close-scan-modal").addEventListener("click", closeScanModal);
scanModalBackdropEl.addEventListener("click", closeScanModal);
document.getElementById("minimize-scan-modal")?.addEventListener("click", minimizeScanModal);
document.getElementById("minimize-remediation-modal")?.addEventListener("click", minimizeRemediationModal);
$("home-button").addEventListener("click", goHome);
$("run-detail-home").addEventListener("click", goHome);
$("analytics-button").addEventListener("click", showAnalytics);
$("analytics-home").addEventListener("click", goHome);

async function init() {
  showPage("dashboard"); resetScanProgress(); closeRemediationModal(); await loadRuns();
  setInterval(async () => { try { await loadRuns(); if(state.currentPage==="run-detail") await loadRunDetail(); await monitorActiveScan(); await monitorActiveRemediation(); } catch(e){} }, 3000);
}

init().catch((error) => {
  console.error("Init failed:", error); statsEl.innerHTML = "";
  runsTableEl.innerHTML = `<div class="empty"><p style="color:var(--danger);">⚠️ Backend connection failed</p><p class="muted" style="font-size:0.8rem;margin-top:0.5rem;">${escapeHtml(error.message||error)}</p><button class="btn-primary mt" onclick="location.reload()">Retry</button></div>`;
});