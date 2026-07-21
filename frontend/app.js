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

// ---- DOM refs ----
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

// ---- API helper ----
async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

// ---- Helpers ----
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

function statusBadge(status) {
  const labels = { completed: "✓ Completed", failed: "✕ Failed", awaiting_approval: "⏳ Awaiting Approval", running: "⚡ Running", queued: "○ Queued" };
  const cls = status === "completed" ? "completed" : status === "failed" ? "failed" : status === "awaiting_approval" ? "awaiting_approval" : status === "running" ? "running" : "queued";
  return `<span class="badge ${cls}">${labels[status] || status}</span>`;
}

function severityBadge(severity) {
  return `<span class="badge ${escapeHtml(severity)}"><span class="sev-dot ${escapeHtml(severity)}"></span>${escapeHtml(severity)}</span>`;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortRepo(url) {
  if (!url) return "unknown";
  if (url.startsWith("http")) {
    const parts = url.replace("https://github.com/", "").split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1].replace(".git", "")}` : url;
  }
  return url.split("\\").pop().split("/").pop() || url;
}

// ---- Page navigation ----
function showPage(pageName) {
  state.currentPage = pageName;
  dashboardPageEl.classList.toggle("active", pageName === "dashboard");
  runDetailPageEl.classList.toggle("active", pageName === "run-detail");
}

function goHome() { showPage("dashboard"); }
function openRun(runId) { state.selectedRunId = runId; showPage("run-detail"); loadRunDetail(); }

// ---- Scan modal ----
function openScanModal() { scanModalShellEl.classList.remove("hidden"); }

function resetScanProgress() {
  state.activeScanRunId = null;
  scanProgressPanelEl.classList.add("hidden");
  scanProgressFillEl.style.width = "8%";
  scanProgressTitleEl.textContent = "Scan in progress";
  scanProgressPhaseEl.textContent = "queued";
  scanProgressMessageEl.textContent = "Waiting for run to start.";
  startScanButtonEl.disabled = false;
}

function closeScanModal() {
  if (state.activeScanRunId) return;
  scanModalShellEl.classList.add("hidden");
  scanFormEl.reset();
  $("requested-by").value = "hackathon-user";
  resetScanProgress();
}

// ---- Remediation modal ----
function openRemediationModal() { remediationModalShellEl.classList.remove("hidden"); }

function closeRemediationModal() {
  if (state.activeRemediationRunId) return;
  remediationModalShellEl.classList.add("hidden");
  remediationProgressFillEl.style.width = "10%";
}

// ---- Progress tracking ----
function scanProgressValue(phase, status) {
  if (status === "failed") return 100;
  const map = { queued: 10, scanning: 35, awaiting_remediation_start: 100, remediation_requested: 55, remediation: 65, remediation_apply: 78, validation: 88, evidence: 96, completed: 100, failed: 100 };
  return map[phase] || 20;
}

function updateScanProgress(run) {
  const lastEvent = run.events?.length ? run.events[run.events.length - 1].message : "Processing run";
  scanProgressPanelEl.classList.remove("hidden");
  scanProgressFillEl.style.width = `${scanProgressValue(run.phase, run.status)}%`;
  scanProgressPhaseEl.textContent = run.phase;
  scanProgressTitleEl.textContent = run.status === "failed" ? "✕ Scan failed" : "⚡ Scan in progress";
  scanProgressMessageEl.textContent = lastEvent;
}

async function monitorActiveScan() {
  if (!state.activeScanRunId) return;
  const run = await fetchJson(`/api/runs/${state.activeScanRunId}`);
  updateScanProgress(run);
  if (run.phase === "awaiting_remediation_start" || run.status === "completed" || run.status === "failed") {
    state.selectedRunId = run.id;
    state.activeScanRunId = null;
    startScanButtonEl.disabled = false;
    scanModalShellEl.classList.add("hidden");
    showPage("run-detail");
    await loadRuns();
    renderRunDetail(run);
  }
}

function remediationProgressValue(phase, status) {
  if (status === "failed") return 100;
  const map = { remediation_requested: 12, remediation: 35, remediation_apply: 62, validation: 84, evidence: 94, completed: 100, failed: 100 };
  return map[phase] || 18;
}

function updateRemediationProgress(run) {
  const lastEvent = run.events?.length ? run.events[run.events.length - 1].message : "Processing remediation";
  const commentary = (run.events || []).slice(-4).map((e) => `[${e.level}] ${e.message}`).join("\n");
  remediationProgressFillEl.style.width = `${remediationProgressValue(run.phase, run.status)}%`;
  remediationProgressTitleEl.textContent = run.status === "failed" ? "✕ Remediation failed" : "🔧 Applying fixes...";
  remediationProgressPhaseEl.textContent = run.phase;
  remediationProgressMessageEl.textContent = lastEvent;
  remediationCommentaryEl.textContent = commentary;
}

async function monitorActiveRemediation() {
  if (!state.activeRemediationRunId) return;
  const run = await fetchJson(`/api/runs/${state.activeRemediationRunId}`);
  updateRemediationProgress(run);
  if (run.status === "completed" || run.status === "failed") {
    state.selectedRunId = run.id;
    state.activeRemediationRunId = null;
    remediationModalShellEl.classList.add("hidden");
    showPage("run-detail");
    await loadRuns();
    renderRunDetail(run);
  }
}

// ---- Dashboard stats ----
function renderStats(runs) {
  const total = runs.length;
  const critical = runs.reduce((sum, r) => sum + (r.findings || []).filter((f) => f.severity === "Critical").length, 0);
  const waiting = runs.filter((r) => r.status === "awaiting_approval").length;
  const complete = runs.filter((r) => r.status === "completed").length;

  statsEl.innerHTML = `
    <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">Total Runs</div></div>
    <div class="stat stat-critical"><div class="stat-value" style="color: var(--critical);">${critical}</div><div class="stat-label">Critical CVEs</div></div>
    <div class="stat stat-warning"><div class="stat-value" style="color: var(--warning);">${waiting}</div><div class="stat-label">Need Approval</div></div>
    <div class="stat stat-success"><div class="stat-value" style="color: var(--success);">${complete}</div><div class="stat-label">Completed</div></div>
  `;
}

// ---- Run cards ----
function renderRuns(runs) {
  renderStats(runs);
  if (runs.length === 0) {
    runsTableEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛡️</div><p>No scans yet. Click <strong>+ New Scan</strong> to start.</p></div>`;
    return;
  }

  runsTableEl.innerHTML = runs.map((run) => {
    const findings = run.findings || [];
    const proposals = run.proposals || [];
    const validations = run.validations || [];
    const critCount = findings.filter((f) => f.severity === "Critical").length;
    const highCount = findings.filter((f) => f.severity === "High").length;
    const lastEvent = run.events?.length ? run.events[run.events.length - 1].message : "No events";

    return `
      <div class="run-card status-${run.status}" data-run-id="${run.id}">
        <div class="run-card-header">
          <div class="run-card-title">${escapeHtml(shortRepo(run.repo_url))}</div>
          ${statusBadge(run.status)}
        </div>
        <div class="run-card-meta">
          <span class="muted">${escapeHtml(run.phase)}</span>
          <span class="muted">· ${timeAgo(run.created_at)}</span>
        </div>
        <div class="muted text-sm" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(lastEvent)}</div>
        <div class="run-card-stats">
          <div class="run-stat"><span class="run-stat-num">${findings.length}</span><span class="run-stat-label">Findings</span></div>
          <div class="run-stat"><span class="run-stat-num" style="color: var(--critical);">${critCount}</span><span class="run-stat-label">Critical</span></div>
          <div class="run-stat"><span class="run-stat-num" style="color: var(--high);">${highCount}</span><span class="run-stat-label">High</span></div>
          <div class="run-stat"><span class="run-stat-num">${proposals.length}</span><span class="run-stat-label">Fixes</span></div>
        </div>
        <div class="run-card-actions">
          <button class="secondary" data-open-run="${run.id}">View Details</button>
          <a class="btn secondary" href="${API_BASE_URL}/api/runs/${run.id}/executive-summary.pdf" download>📄 Report</a>
        </div>
      </div>
    `;
  }).join("");

  runsTableEl.querySelectorAll("[data-open-run]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openRun(btn.getAttribute("data-open-run")); });
  });
  runsTableEl.querySelectorAll(".run-card[data-run-id]").forEach((card) => {
    card.addEventListener("click", () => openRun(card.getAttribute("data-run-id")));
  });
}

// ---- Proposal approval ----
function proposalActions(runId, proposal) {
  if (proposal.approval_status !== "pending") {
    return `<span class="badge ${proposal.approval_status === "approved" ? "completed" : "failed"}">${proposal.approval_status}</span>`;
  }
  return `<div class="flex gap-1 mt-1"><button class="success slim-button" onclick="decide('${runId}','${proposal.id}','approve')">✓ Approve</button><button class="reject slim-button" onclick="decide('${runId}','${proposal.id}','reject')">✕ Reject</button></div>`;
}

async function decide(runId, proposalId, decision) {
  await fetchJson(`/api/runs/${runId}/approvals/${proposalId}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reviewer: "demo-reviewer" }),
  });
  await loadRuns();
  await loadRunDetail();
}
window.decide = decide;

async function startRemediation(runId) {
  openRemediationModal();
  remediationProgressPhaseEl.textContent = "remediation_requested";
  remediationProgressMessageEl.textContent = "Submitting remediation request.";
  remediationCommentaryEl.textContent = "User approved remediation. Waiting for agent pipeline to begin.";
  const run = await fetchJson(`/api/runs/${runId}/start-remediation`, { method: "POST" });
  state.activeRemediationRunId = run.id;
  updateRemediationProgress(run);
  await loadRuns();
}
window.startRemediation = startRemediation;

// ---- Run detail view ----
function renderRunDetail(run) {
  hintEl.style.display = "none";
  const validationByProposal = new Map((run.validations || []).map((v) => [v.proposal_id, v]));

  // Findings
  const findingsHtml = (run.findings || []).map((f) => `
    <div class="vuln-row">
      <div class="vuln-info">
        <div class="vuln-name">${escapeHtml(f.dependency)}</div>
        <div class="vuln-detail">
          <span class="vuln-version">${escapeHtml(f.current_version)}</span>
          <span class="vuln-arrow">→</span>
          <span class="vuln-fixed">${escapeHtml((f.recommended_versions || [])[0] || f.fixed_version || "?")}</span>
          <span>${escapeHtml(f.cve)}</span>
        </div>
      </div>
      ${severityBadge(f.severity)}
    </div>
  `).join("");

  // Proposals
  const proposalsHtml = (run.proposals || []).map((p) => {
    const val = validationByProposal.get(p.id);
    const valStatus = val ? (val.passed ? '<span class="badge completed">✓ Validated</span>' : '<span class="badge failed">✕ Failed</span>') : '<span class="badge queued">Pending</span>';
    return `
      <div class="vuln-row" style="flex-direction: column; align-items: stretch;">
        <div class="flex-between">
          <div class="vuln-info">
            <div class="vuln-name">${escapeHtml(p.dependency)}</div>
            <div class="vuln-detail">
              <span class="vuln-version">${escapeHtml(p.from_version)}</span>
              <span class="vuln-arrow">→</span>
              <span class="vuln-fixed">${escapeHtml(p.to_version)}</span>
              <span class="badge" style="background: var(--bg-elev); color: var(--ink-secondary);">conf ${(p.confidence_score * 100).toFixed(0)}%</span>
            </div>
          </div>
          ${valStatus}
        </div>
        ${p.reasoning ? `<div class="muted text-sm mt-1">${escapeHtml(p.reasoning)}</div>` : ""}
        ${proposalActions(run.id, p)}
      </div>
    `;
  }).join("");

  // Events
  const eventsHtml = (run.events || []).slice(-10).map((e) => {
    const icon = e.level === "error" ? "❌" : e.level === "warn" ? "⚠️" : "ℹ️";
    return `<div class="text-sm" style="padding: 0.3rem 0; border-bottom: 1px solid var(--border-soft);">${icon} <span class="text-mono" style="color: var(--ink-muted);">${escapeHtml(e.message)}</span></div>`;
  }).join("");

  // Evidence
  const evidenceHtml = run.evidence ? `
    <div class="vuln-row"><div class="vuln-info"><div class="vuln-name">Evidence Summary</div><div class="vuln-detail">${escapeHtml(run.evidence.summary)}</div></div></div>
    <div class="muted text-sm mt-1">Export links: ${escapeHtml((run.evidence.export_links || []).join(" | "))}</div>
  ` : '<p class="muted">Evidence pending...</p>';

  // Validation
  const validationHtml = (run.validations || []).map((v) => `
    <div class="vuln-row">
      <div class="vuln-info">
        <div class="vuln-name">${escapeHtml(v.proposal_id.slice(0, 8))}...</div>
        <div class="vuln-detail">
          Build: ${v.build_ok ? "✅" : "❌"} · Tests: ${v.tests_ok ? "✅" : "❌"} · Startup: ${v.startup_ok ? "✅" : "❌"}
        </div>
      </div>
      ${v.passed ? '<span class="badge completed">✓ Passed</span>' : '<span class="badge failed">✕ Failed</span>'}
    </div>
  `).join("");

  // PR
  const pr = run.pull_request || {};
  const prHtml = pr.url
    ? `<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">Pull Request</div><div class="vuln-detail"><a href="${escapeHtml(pr.url)}" target="_blank" style="color: var(--accent);">${escapeHtml(pr.url)}</a></div></div><span class="badge ${pr.status === "created" ? "completed" : "queued"}">${escapeHtml(pr.status)}</span></div>`
    : `<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">Pull Request</div><div class="vuln-detail">${escapeHtml(pr.reason || pr.status || "Not created")}</div></div></div>`;

  // Remediation
  const rem = run.remediation_summary || {};
  const changesHtml = (rem.changes || []).map((c) => `
    <div class="vuln-row">
      <div class="vuln-info">
        <div class="vuln-name">${escapeHtml(c.dependency)}</div>
        <div class="vuln-detail">
          <span class="vuln-version">${escapeHtml(c.old_version || "(none)")}</span>
          <span class="vuln-arrow">→</span>
          <span class="vuln-fixed">${escapeHtml(c.new_version)}</span>
          <span>${escapeHtml(c.file_path || "")}</span>
        </div>
      </div>
    </div>
  `).join("");

  const diffHtml = rem.diff_excerpt ? `<pre>${escapeHtml(rem.diff_excerpt)}</pre>` : "";

  // Approval gate
  const gate = (run.phase === "awaiting_remediation_start" && (run.findings || []).length > 0 && !run.remediation_requested)
    ? `<div class="detail-section" style="border-color: var(--warning); background: var(--warning-bg);"><h3 style="color: var(--warning);">⚠️ User Action Required</h3><p class="muted mb-1">Review the vulnerabilities below and approve remediation to proceed.</p><button onclick="startRemediation('${run.id}')">▶ Start Remediation</button></div>`
    : "";

  // Render
  detailEl.innerHTML = `
    <div class="flex-between mb-1">
      <div class="flex gap-1">${statusBadge(run.status)}<span class="badge queued">${escapeHtml(run.phase)}</span></div>
      <span class="muted text-sm">${escapeHtml(run.id.slice(0, 8))}</span>
    </div>
    <div class="muted text-sm mb-1">Repository: <span class="text-mono">${escapeHtml(run.repo_url)}</span></div>
    ${gate}
    <div class="detail-grid mt-2">
      <div class="detail-section">
        <h3>🔒 Vulnerabilities Found (${(run.findings || []).length})</h3>
        ${findingsHtml || '<div class="empty-state"><p>No vulnerabilities detected. 🎉</p></div>'}
      </div>
      <div class="detail-section">
        <h3>🔧 Remediation Proposals (${(run.proposals || []).length})</h3>
        ${proposalsHtml || '<div class="empty-state"><p>No proposals yet.</p></div>'}
      </div>
      ${(rem.changes || []).length ? `
      <div class="detail-section">
        <h3>📝 Applied Changes (${(rem.changes || []).length})</h3>
        ${changesHtml}
        ${diffHtml}
      </div>` : ""}
      ${(run.validations || []).length ? `
      <div class="detail-section">
        <h3>✅ Validation Results (${(run.validations || []).length})</h3>
        ${validationHtml}
      </div>` : ""}
      <div class="detail-section">
        <h3>🔀 Pull Request</h3>
        ${prHtml}
      </div>
      <div class="detail-section">
        <h3>📋 Evidence & Report</h3>
        ${evidenceHtml}
      </div>
      ${(run.events || []).length ? `
      <div class="detail-section">
        <h3>📜 Activity Log</h3>
        ${eventsHtml}
      </div>` : ""}
    </div>
  `;
}

// ---- Data loaders ----
async function loadRunDetail() {
  if (!state.selectedRunId) { detailEl.innerHTML = ""; hintEl.style.display = "block"; return; }
  const run = await fetchJson(`/api/runs/${state.selectedRunId}`);
  showPage("run-detail");
  renderRunDetail(run);
}

async function loadRuns() {
  const runs = await fetchJson("/api/runs");
  renderRuns(runs);
}

// ---- Event listeners ----
$("refresh-runs").addEventListener("click", async () => { await loadRuns(); await loadRunDetail(); });

scanFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repoUrl = $("repo-url").value.trim();
  const requestedBy = $("requested-by").value.trim() || "hackathon-user";
  if (!repoUrl) return;
  startScanButtonEl.disabled = true;
  scanProgressPanelEl.classList.remove("hidden");
  scanProgressFillEl.style.width = "12%";
  scanProgressPhaseEl.textContent = "queued";
  scanProgressMessageEl.textContent = "Creating scan run.";
  const run = await fetchJson("/api/runs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, requested_by: requestedBy }),
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

// ---- Init ----
async function init() {
  showPage("dashboard");
  resetScanProgress();
  closeRemediationModal();
  await loadRuns();
  setInterval(async () => {
    await loadRuns();
    if (state.currentPage === "run-detail") await loadRunDetail();
    await monitorActiveScan();
    await monitorActiveRemediation();
  }, 2500);
}

init().catch((error) => { console.error(error); alert("Failed to initialize UI. Check backend logs."); });