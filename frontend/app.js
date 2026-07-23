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
function openRun(id) { state.selectedRunId=id; showPage("run-detail"); loadRunDetail(); }
function openScanModal() { scanModalShellEl.classList.remove("hidden"); }
function resetScanProgress() { state.activeScanRunId=null; scanProgressPanelEl.classList.add("hidden"); scanProgressFillEl.style.width="8%"; scanProgressPhaseEl.textContent="queued"; scanProgressMessageEl.textContent="Waiting..."; startScanButtonEl.disabled=false; }
function closeScanModal() { if(state.activeScanRunId) return; scanModalShellEl.classList.add("hidden"); scanFormEl.reset(); $("requested-by").value="hackathon-user"; resetScanProgress(); }
function openRemediationModal() { remediationModalShellEl.classList.remove("hidden"); }
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

function renderRunDetail(run) {
  hintEl.style.display="none";
  const findingsHtml=(run.findings||[]).map(f=>`<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">${escapeHtml(f.dependency)}</div><div class="vuln-detail"><span class="mono">${escapeHtml(f.current_version)}</span><span class="vuln-arrow">→</span><span class="mono" style="color:var(--success);">${escapeHtml((f.recommended_versions||[])[0]||f.fixed_version||"?")}</span><span>${escapeHtml(f.cve)}</span></div></div>${severityBadge(f.severity)}</div>`).join("");
  const proposalsHtml=(run.proposals||[]).map(p=>`<div class="vuln-row" style="flex-direction:column;align-items:stretch;"><div class="between"><div class="vuln-info"><div class="vuln-name">${escapeHtml(p.dependency)}</div><div class="vuln-detail"><span class="mono">${escapeHtml(p.from_version)}</span><span class="vuln-arrow">→</span><span class="mono" style="color:var(--success);">${escapeHtml(p.to_version)}</span></div></div><span class="badge ${p.approval_status==="approved"?"completed":"queued"}">${escapeHtml(p.approval_status)}</span></div>${p.reasoning?`<div class="muted" style="font-size:0.76rem;margin-top:0.3rem;">${escapeHtml(p.reasoning)}</div>`:""}</div>`).join("");
  const eventsHtml=(run.events||[]).slice(-10).map(e=>`<div style="font-size:0.76rem;padding:0.25rem 0;border-bottom:1px solid var(--border);">${e.level==="error"?"❌":e.level==="warn"?"⚠️":"ℹ️"} <span class="mono muted">${escapeHtml(e.message)}</span></div>`).join("");
  const pr=run.pull_request||{};
  const rem=run.remediation_summary||{};
  const changesHtml=(rem.changes||[]).map(c=>`<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">${escapeHtml(c.dependency)}</div><div class="vuln-detail"><span class="mono">${escapeHtml(c.old_version||"(none)")}</span><span class="vuln-arrow">→</span><span class="mono" style="color:var(--success);">${escapeHtml(c.new_version)}</span></div></div></div>`).join("");
  const evidenceHtml=run.evidence?`<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">Summary</div><div class="vuln-detail">${escapeHtml(run.evidence.summary)}</div></div></div>`:'<p class="muted">Pending...</p>';
  const prHtml=pr.url?`<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">PR</div><div class="vuln-detail"><a href="${escapeHtml(pr.url)}" target="_blank" style="color:var(--accent);">${escapeHtml(pr.url)}</a></div></div><span class="badge ${pr.status==="created"?"completed":"queued"}">${escapeHtml(pr.status)}</span></div>`:`<div class="vuln-row"><div class="vuln-info"><div class="vuln-detail">${escapeHtml(pr.reason||pr.status||"Not created")}</div></div></div>`;
  const gate=(run.phase==="awaiting_remediation_start"&&(run.findings||[]).length>0&&!run.remediation_requested)?`<div class="section" style="border-color:var(--medium);background:rgba(202,138,4,0.05);"><h3 style="color:var(--medium);">⚠️ Approval Needed</h3><button class="btn-primary" onclick="startRemediation('${run.id}')">▶ Start Remediation</button></div>`:"";

  detailEl.innerHTML=`<div class="between mb"><div class="flex gap-sm">${statusBadge(run.status)}<span class="badge queued">${escapeHtml(run.phase)}</span></div><span class="muted" style="font-size:0.78rem;">${escapeHtml(run.id.slice(0,8))}</span></div><div class="muted" style="font-size:0.78rem;margin-bottom:0.5rem;">Repo: <span class="mono">${escapeHtml(run.repo_url)}</span></div>${gate}<div class="mt"><div class="section"><h3>🔒 Vulnerabilities (${(run.findings||[]).length})</h3>${findingsHtml||'<div class="empty"><p>None 🎉</p></div>'}</div><div class="section"><h3>🔧 Proposals (${(run.proposals||[]).length})</h3>${proposalsHtml||'<div class="empty"><p>None</p></div>'}</div>${(rem.changes||[]).length?`<div class="section"><h3>📝 Changes (${(rem.changes||[]).length})</h3>${changesHtml}</div>`:""}<div class="section"><h3>🔀 PR</h3>${prHtml}</div><div class="section"><h3>📋 Evidence</h3>${evidenceHtml}</div>${eventsHtml?`<div class="section"><h3>📜 Log</h3>${eventsHtml}</div>`:""}</div>`;
}

async function loadRunDetail() { if(!state.selectedRunId){detailEl.innerHTML="";hintEl.style.display="block";return;} const run=await fetchJson(`/api/runs/${state.selectedRunId}`); showPage("run-detail"); renderRunDetail(run); }
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

$("open-scan-modal").addEventListener("click", openScanModal);
$("close-scan-modal").addEventListener("click", closeScanModal);
scanModalBackdropEl.addEventListener("click", closeScanModal);
$("home-button").addEventListener("click", goHome);
$("run-detail-home").addEventListener("click", goHome);

async function init() {
  showPage("dashboard"); resetScanProgress(); closeRemediationModal(); await loadRuns();
  setInterval(async () => { try { await loadRuns(); if(state.currentPage==="run-detail") await loadRunDetail(); await monitorActiveScan(); await monitorActiveRemediation(); } catch(e){} }, 3000);
}

init().catch((error) => {
  console.error("Init failed:", error); statsEl.innerHTML = "";
  runsTableEl.innerHTML = `<div class="empty"><p style="color:var(--danger);">⚠️ Backend connection failed</p><p class="muted" style="font-size:0.8rem;margin-top:0.5rem;">${escapeHtml(error.message||error)}</p><button class="btn-primary mt" onclick="location.reload()">Retry</button></div>`;
});