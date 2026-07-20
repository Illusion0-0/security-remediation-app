const state = {
  selectedRunId: null,
  currentPage: "dashboard",
  activeScanRunId: null,
  activeRemediationRunId: null,
};

const API_BASE_URL = window.API_BASE_URL || localStorage.getItem("API_BASE_URL") || "http://127.0.0.1:8010";

const runsTableEl = document.getElementById("runs-table");
const statsEl = document.getElementById("stats");
const detailEl = document.getElementById("run-detail-body");
const hintEl = document.getElementById("selected-run-hint");
const dashboardPageEl = document.getElementById("dashboard-page");
const runDetailPageEl = document.getElementById("run-detail-page");
const scanModalShellEl = document.getElementById("scan-modal-shell");
const scanModalBackdropEl = document.getElementById("scan-modal-backdrop");
const openScanModalButtonEl = document.getElementById("open-scan-modal");
const closeScanModalButtonEl = document.getElementById("close-scan-modal");
const homeButtonEl = document.getElementById("home-button");
const runDetailHomeButtonEl = document.getElementById("run-detail-home");
const scanProgressPanelEl = document.getElementById("scan-progress-panel");
const scanProgressFillEl = document.getElementById("scan-progress-fill");
const scanProgressTitleEl = document.getElementById("scan-progress-title");
const scanProgressPhaseEl = document.getElementById("scan-progress-phase");
const scanProgressMessageEl = document.getElementById("scan-progress-message");
const scanFormEl = document.getElementById("scan-form");
const startScanButtonEl = document.getElementById("start-scan-button");
const remediationModalShellEl = document.getElementById("remediation-modal-shell");
const remediationProgressFillEl = document.getElementById("remediation-progress-fill");
const remediationProgressTitleEl = document.getElementById("remediation-progress-title");
const remediationProgressPhaseEl = document.getElementById("remediation-progress-phase");
const remediationProgressMessageEl = document.getElementById("remediation-progress-message");
const remediationCommentaryEl = document.getElementById("remediation-commentary");

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
}

function statusBadge(status) {
  if (status === "completed") return '<span class="badge ok">completed</span>';
  if (status === "failed") return '<span class="badge bad">failed</span>';
  if (status === "awaiting_approval") return '<span class="badge warn">awaiting approval</span>';
  return `<span class="badge warn">active</span>`;
}

function showPage(pageName) {
  state.currentPage = pageName;
  dashboardPageEl.classList.toggle("active", pageName === "dashboard");
  runDetailPageEl.classList.toggle("active", pageName === "run-detail");
}

function goHome() {
  showPage("dashboard");
}

function openRun(runId) {
  state.selectedRunId = runId;
  showPage("run-detail");
  loadRunDetail();
}

function openScanModal() {
  scanModalShellEl.classList.remove("hidden");
}

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
  if (state.activeScanRunId) {
    return;
  }
  scanModalShellEl.classList.add("hidden");
  scanFormEl.reset();
  document.getElementById("requested-by").value = "hackathon-user";
  resetScanProgress();
}

function openRemediationModal() {
  remediationModalShellEl.classList.remove("hidden");
}

function closeRemediationModal() {
  if (state.activeRemediationRunId) {
    return;
  }
  remediationModalShellEl.classList.add("hidden");
  remediationProgressFillEl.style.width = "8%";
  remediationProgressTitleEl.textContent = "Remediation in progress";
  remediationProgressPhaseEl.textContent = "remediation_requested";
  remediationProgressMessageEl.textContent = "Waiting for remediation to start.";
  remediationCommentaryEl.textContent = "";
}

function scanProgressValue(phase, status) {
  if (status === "failed") return 100;
  const phaseMap = {
    queued: 10,
    scanning: 35,
    awaiting_remediation_start: 100,
    remediation_requested: 55,
    remediation: 65,
    remediation_apply: 78,
    validation: 88,
    evidence: 96,
    completed: 100,
    failed: 100,
  };
  return phaseMap[phase] || 20;
}

function updateScanProgress(run) {
  const lastEvent = run.events?.length ? run.events[run.events.length - 1].message : "Processing run";
  const progress = scanProgressValue(run.phase, run.status);
  scanProgressPanelEl.classList.remove("hidden");
  scanProgressFillEl.style.width = `${progress}%`;
  scanProgressPhaseEl.textContent = run.phase;
  scanProgressTitleEl.textContent = run.status === "failed" ? "Scan failed" : "Scan in progress";
  scanProgressMessageEl.textContent = lastEvent;
}

async function monitorActiveScan() {
  if (!state.activeScanRunId) {
    return;
  }

  const run = await fetchJson(`/api/runs/${state.activeScanRunId}`);
  updateScanProgress(run);

  if (
    run.phase === "awaiting_remediation_start" ||
    run.status === "completed" ||
    run.status === "failed"
  ) {
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
  const phaseMap = {
    remediation_requested: 12,
    remediation: 35,
    remediation_apply: 62,
    validation: 84,
    evidence: 94,
    completed: 100,
    failed: 100,
  };
  return phaseMap[phase] || 18;
}

function updateRemediationProgress(run) {
  const lastEvent = run.events?.length ? run.events[run.events.length - 1].message : "Processing remediation";
  const commentary = (run.events || [])
    .slice(-4)
    .map((event) => `[${event.level}] ${event.message}`)
    .join("\n");
  remediationProgressFillEl.style.width = `${remediationProgressValue(run.phase, run.status)}%`;
  remediationProgressTitleEl.textContent = run.status === "failed" ? "Remediation failed" : "Remediation in progress";
  remediationProgressPhaseEl.textContent = run.phase;
  remediationProgressMessageEl.textContent = lastEvent;
  remediationCommentaryEl.textContent = commentary;
}

async function monitorActiveRemediation() {
  if (!state.activeRemediationRunId) {
    return;
  }

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

function renderStats(runs) {
  const queued = runs.filter((r) => r.status === "queued").length;
  const running = runs.filter((r) => r.status === "running").length;
  const waiting = runs.filter((r) => r.status === "awaiting_approval").length;
  const complete = runs.filter((r) => r.status === "completed").length;
  statsEl.innerHTML = `
    <div class="stat"><div>Queued</div><strong>${queued}</strong></div>
    <div class="stat"><div>Running</div><strong>${running}</strong></div>
    <div class="stat"><div>Approval</div><strong>${waiting}</strong></div>
    <div class="stat"><div>Completed</div><strong>${complete}</strong></div>
  `;
}

function renderRuns(runs) {
  renderStats(runs);
  runsTableEl.innerHTML = "";
  if (runs.length === 0) {
    runsTableEl.innerHTML = '<p class="muted">No runs yet. Create one from New Scan.</p>';
    return;
  }

  runs.forEach((run) => {
    const lastEvent = run.events?.length ? run.events[run.events.length - 1].message : "No events yet";
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <h4>${run.repo_url}</h4>
      <div>${statusBadge(run.status)} phase=${run.phase}</div>
      <div class="muted">findings=${run.findings.length} proposals=${run.proposals.length} validations=${run.validations.length}</div>
      <div class="muted">latest: ${lastEvent}</div>
      <div class="muted">runId=${run.id}</div>
      <div class="run-card-actions">
        <button data-run-id="${run.id}" class="secondary">Open Run</button>
        <a class="download-button" href="${API_BASE_URL}/api/runs/${run.id}/executive-summary.pdf" download>Export Executive Summary</a>
      </div>
    `;
    runsTableEl.appendChild(row);
  });

  runsTableEl.querySelectorAll('button[data-run-id]').forEach((button) => {
    button.addEventListener("click", () => {
      openRun(button.getAttribute("data-run-id"));
    });
  });
}

function proposalActions(runId, proposal) {
  if (proposal.approval_status !== "pending") {
    return `<span class="muted">approval=${proposal.approval_status}</span>`;
  }
  return `
    <div class="inline-actions">
      <button onclick="decide('${runId}','${proposal.id}','approve')">Approve</button>
      <button class="reject" onclick="decide('${runId}','${proposal.id}','reject')">Reject</button>
    </div>
  `;
}

async function decide(runId, proposalId, decision) {
  await fetchJson(`/api/runs/${runId}/approvals/${proposalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reviewer: "demo-reviewer" }),
  });
  await loadRuns();
  await loadRunDetail();
}

window.decide = decide;

async function startRemediation(runId) {
  openRemediationModal();
  remediationProgressFillEl.style.width = "10%";
  remediationProgressPhaseEl.textContent = "remediation_requested";
  remediationProgressMessageEl.textContent = "Submitting remediation request.";
  remediationCommentaryEl.textContent = "User approved remediation. Waiting for agent pipeline to begin.";

  const run = await fetchJson(`/api/runs/${runId}/start-remediation`, {
    method: "POST",
  });
  state.activeRemediationRunId = run.id;
  updateRemediationProgress(run);
  await loadRuns();
}

window.startRemediation = startRemediation;

function renderRunDetail(run) {
  hintEl.style.display = "none";
  const validationByProposal = new Map(run.validations.map((v) => [v.proposal_id, v]));

  const findingsHtml = run.findings
    .map(
      (finding) => `
    <div class="row">
      <div><strong>${finding.dependency}</strong></div>
      <div>${finding.current_version}</div>
      <div class="muted">severity=${finding.severity} cve=${finding.cve}</div>
      <div class="muted">recommended=${(finding.recommended_versions || []).join(", ") || "none"}</div>
    </div>
    `
    )
    .join("");

  const proposalsHtml = run.proposals
    .map(
      (proposal) => `
    <div class="row">
      <div><strong>${proposal.dependency}</strong></div>
      <div>${proposal.from_version} -> ${proposal.to_version}</div>
      <div class="muted">confidence=${proposal.confidence_score} approval=${proposal.approval_status}</div>
      <div class="muted">reason=${proposal.reasoning}</div>
      <div class="muted">validation=${validationByProposal.get(proposal.id)?.passed ? "passed" : validationByProposal.get(proposal.id) ? "failed" : "pending"}</div>
      ${proposalActions(run.id, proposal)}
    </div>
    `
    )
    .join("");

  const eventsHtml = run.events
    .slice(-8)
    .map((event) => `<li>[${event.level}] ${event.message}</li>`)
    .join("");

  const evidenceHtml = run.evidence
    ? `<div class="row"><strong>Evidence</strong><div>${run.evidence.summary}</div><div class="muted">${run.evidence.export_links.join(" | ")}</div></div>`
    : '<p class="muted">Evidence pending...</p>';

  const validationHtml = run.validations
    .map(
      (item) => `
    <div class="row">
      <div><strong>proposalId=${item.proposal_id}</strong></div>
      <div class="muted">build=${item.build_ok} test=${item.tests_ok} startup=${item.startup_ok}</div>
      <div class="muted">${item.details}</div>
    </div>
    `
    )
    .join("");

  const pr = run.pull_request || { status: "not_attempted", url: null, reason: "No PR data" };
  const prHtml = `
    <div class="row">
      <strong>Pull Request</strong>
      <div class="muted">status=${pr.status}</div>
      <div class="muted">url=${pr.url || "not available"}</div>
      <div class="muted">reason=${pr.reason || "none"}</div>
    </div>
  `;

  const rem = run.remediation_summary || {
    status: "not_started",
    changed_files: [],
    changes: [],
    diff_excerpt: null,
    error: null,
    workspace_path: null,
  };

  const remediationGate =
    run.phase === "awaiting_remediation_start" && run.findings.length > 0 && !run.remediation_requested
      ? `<div class="row"><strong>User Action Required:</strong><div class="muted">Review vulnerabilities and start remediation.</div><button onclick="startRemediation('${run.id}')">Start Remediation</button></div>`
      : "";

  const changesHtml = (rem.changes || [])
    .map(
      (change) => `
    <div class="row">
      <div><strong>${change.dependency}</strong></div>
      <div class="muted">${change.old_version || "(none)"} -> ${change.new_version}</div>
      <div class="muted">file=${change.file_path}</div>
    </div>
    `
    )
    .join("");

  const diffHtml = rem.diff_excerpt
    ? `<pre class="muted" style="white-space: pre-wrap; max-height: 220px; overflow: auto;">${rem.diff_excerpt.replaceAll("<", "&lt;")}</pre>`
    : '<p class="muted">No diff available yet.</p>';

  detailEl.innerHTML = `
    <div>${statusBadge(run.status)} phase=${run.phase}</div>
    ${remediationGate}
    <div class="list"><strong>Findings (${run.findings.length}):</strong>${findingsHtml || '<p class="muted">No vulnerabilities detected.</p>'}</div>
    <div class="list"><strong>Remediation Proposals (${run.proposals.length}):</strong>${proposalsHtml || '<p class="muted">No remediation needed.</p>'}</div>
    <div class="list"><strong>Remediation Summary:</strong>
      <div class="row">
        <div class="muted">status=${rem.status}</div>
        <div class="muted">workspace=${rem.workspace_path || "not available"}</div>
        <div class="muted">changed_files=${(rem.changed_files || []).join(", ") || "none"}</div>
        <div class="muted">error=${rem.error || "none"}</div>
      </div>
      ${changesHtml || '<p class="muted">No file changes recorded yet.</p>'}
      ${diffHtml}
    </div>
    <div class="list"><strong>Validation Results (${run.validations.length}):</strong>${validationHtml || '<p class="muted">No validation executed yet.</p>'}</div>
    <div class="list">${prHtml}</div>
    <div class="list"><strong>Events:</strong><ul>${eventsHtml}</ul></div>
    <div class="list">${evidenceHtml}</div>
  `;
}

async function loadRunDetail() {
  if (!state.selectedRunId) {
    detailEl.innerHTML = "";
    hintEl.style.display = "block";
    return;
  }
}

async function loadRunDetail() {
  if (!state.selectedRunId) {
    hintEl.style.display = "block";
    return;
  }

  const run = await fetchJson(`/api/runs/${state.selectedRunId}`);
  showPage("run-detail");
  renderRunDetail(run);
}

async function loadRuns() {
  const runs = await fetchJson("/api/runs");
  renderRuns(runs);
}

document.getElementById("refresh-runs").addEventListener("click", async () => {
  await loadRuns();
  await loadRunDetail();
});

scanFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repoUrl = document.getElementById("repo-url").value.trim();
  const requestedBy = document.getElementById("requested-by").value.trim() || "hackathon-user";

  if (!repoUrl) {
    return;
  }

  startScanButtonEl.disabled = true;
  scanProgressPanelEl.classList.remove("hidden");
  scanProgressFillEl.style.width = "12%";
  scanProgressPhaseEl.textContent = "queued";
  scanProgressMessageEl.textContent = "Creating scan run.";

  const run = await fetchJson("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, requested_by: requestedBy }),
  });

  state.selectedRunId = run.id;
  state.activeScanRunId = run.id;
  updateScanProgress(run);
  await loadRuns();
});

openScanModalButtonEl.addEventListener("click", openScanModal);
closeScanModalButtonEl.addEventListener("click", closeScanModal);
scanModalBackdropEl.addEventListener("click", closeScanModal);
homeButtonEl.addEventListener("click", goHome);
runDetailHomeButtonEl.addEventListener("click", goHome);

async function init() {
  showPage("dashboard");
  resetScanProgress();
  closeRemediationModal();
  await loadRuns();
  await loadRunDetail();
  setInterval(async () => {
    await loadRuns();
    if (state.currentPage === "run-detail") {
      await loadRunDetail();
    }
    await monitorActiveScan();
    await monitorActiveRemediation();
  }, 2500);
}

init().catch((error) => {
  console.error(error);
  alert("Failed to initialize UI. Check backend logs.");
});