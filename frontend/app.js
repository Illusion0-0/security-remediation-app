/* ==========================================================================
   SecureRemediate Dashboard — 10-Tab Report System with Chart.js
   ========================================================================== */
const state = { selectedRunId: null, currentPage: "dashboard", activeTab: "executive", activeScanRunId: null, activeRemediationRunId: null, charts: {} };
const API_BASE_URL = window.API_BASE_URL || "";
const $ = (id) => document.getElementById(id);

async function fetchJson(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (API_BASE_URL && API_BASE_URL.includes("ngrok")) { headers["ngrok-skip-browser-warning"] = "true"; }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
function escapeHtml(text) { const d = document.createElement("div"); d.textContent = String(text||""); return d.innerHTML; }
function statusBadge(status) { const labels = { completed: "✓ Completed", failed: "✕ Failed", awaiting_approval: "⏳ Approval", running: "⚡ Running", queued: "○ Queued" }; return `<span class="badge ${status}">${labels[status] || status}</span>`; }
function severityBadge(sev) { return `<span class="badge ${escapeHtml(sev)}"><span class="sev-dot ${escapeHtml(sev)}"></span>${escapeHtml(sev)}</span>`; }
function timeAgo(d) { if(!d) return ""; const m=Math.floor((Date.now()-new Date(d).getTime())/60000); return m<1?"just now":m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`; }
function shortRepo(u) { if(!u) return "unknown"; if(u.startsWith("http")){const p=u.replace("https://github.com/","").split("/");return p.length>=2?`${p[0]}/${p[1].replace(".git","")}`:u;} return u.split("\\").pop().split("/").pop()||u; }

function showPage(p) { state.currentPage=p; $("dashboard-page").classList.toggle("active",p==="dashboard"); $("run-detail-page").classList.toggle("active",p==="run-detail"); }
function goHome() { showPage("dashboard"); }
function openRun(id) { state.selectedRunId=id; showPage("run-detail"); loadRunDetail(); }
function openScanModal() { $("scan-modal-shell").classList.remove("hidden"); }
function resetScanProgress() { state.activeScanRunId=null; $("scan-progress-panel").classList.add("hidden"); $("scan-progress-fill").style.width="8%"; $("scan-progress-phase").textContent="queued"; $("scan-progress-message").textContent="Waiting..."; $("start-scan-button").disabled=false; }
function closeScanModal() { if(state.activeScanRunId) return; $("scan-modal-shell").classList.add("hidden"); $("scan-form").reset(); $("requested-by").value="hackathon-user"; resetScanProgress(); }
function openRemediationModal() { $("remediation-modal-shell").classList.remove("hidden"); }
function closeRemediationModal() { if(state.activeRemediationRunId) return; $("remediation-modal-shell").classList.add("hidden"); $("remediation-progress-fill").style.width="10%"; }

function scanProgressValue(phase, status) { if(status==="failed") return 100; const m={queued:10,scanning:35,awaiting_remediation_start:100,remediation_requested:55,remediation:65,remediation_apply:78,validation:88,evidence:96,completed:100,failed:100}; return m[phase]||20; }
function updateScanProgress(run) { $("scan-progress-panel").classList.remove("hidden"); $("scan-progress-fill").style.width=`${scanProgressValue(run.phase,run.status)}%`; $("scan-progress-phase").textContent=run.phase; $("scan-progress-message").textContent=run.events?.length?run.events[run.events.length-1].message:"Processing"; }
async function monitorActiveScan() { if(!state.activeScanRunId) return; const run=await fetchJson(`/api/runs/${state.activeScanRunId}`); updateScanProgress(run); if(["awaiting_remediation_start","completed","failed"].includes(run.phase)||["completed","failed"].includes(run.status)){state.selectedRunId=run.id;state.activeScanRunId=null;$("start-scan-button").disabled=false;$("scan-modal-shell").classList.add("hidden");showPage("run-detail");await loadRuns();renderRunDetail(run);}}
function remediationProgressValue(phase, status) { if(status==="failed") return 100; const m={remediation_requested:12,remediation:35,remediation_apply:62,validation:84,evidence:94,completed:100,failed:100}; return m[phase]||18; }
function updateRemediationProgress(run) { $("remediation-progress-fill").style.width=`${remediationProgressValue(run.phase,run.status)}%`; $("remediation-progress-phase").textContent=run.phase; $("remediation-progress-message").textContent=run.events?.length?run.events[run.events.length-1].message:"Processing"; $("remediation-commentary").textContent=(run.events||[]).slice(-4).map(e=>`[${e.level}] ${e.message}`).join("\n"); }
async function monitorActiveRemediation() { if(!state.activeRemediationRunId) return; const run=await fetchJson(`/api/runs/${state.activeRemediationRunId}`); updateRemediationProgress(run); if(["completed","failed"].includes(run.status)){state.selectedRunId=run.id;state.activeRemediationRunId=null;$("remediation-modal-shell").classList.add("hidden");showPage("run-detail");await loadRuns();renderRunDetail(run);}}

function renderStats(runs) {
  $("stats").innerHTML = `<div class="stat"><div class="stat-num">${runs.length}</div><div class="stat-label">Total Runs</div></div><div class="stat"><div class="stat-num" style="color:var(--critical);">${runs.reduce((s,r)=>s+(r.findings||[]).filter(f=>f.severity==="Critical").length,0)}</div><div class="stat-label">Critical</div></div><div class="stat"><div class="stat-num" style="color:var(--medium);">${runs.filter(r=>r.status==="awaiting_approval").length}</div><div class="stat-label">Pending</div></div><div class="stat"><div class="stat-num" style="color:var(--success);">${runs.filter(r=>r.status==="completed").length}</div><div class="stat-label">Completed</div></div>`;
}
function renderRuns(runs) {
  renderStats(runs);
  if(!runs.length){$("runs-table").innerHTML=`<div class="empty"><p>No scans yet. Click <strong>+ New Scan</strong>.</p></div>`;return;}
  $("runs-table").innerHTML=runs.map(run=>{const f=run.findings||[];const p=run.proposals||[];return `<div class="run-card" data-run-id="${run.id}"><div class="run-card-head"><div class="run-card-title">${escapeHtml(shortRepo(run.repo_url))}</div>${statusBadge(run.status)}</div><div class="muted" style="font-size:0.76rem;">${escapeHtml(run.phase)} · ${timeAgo(run.created_at)}</div><div class="muted" style="font-size:0.74rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:0.3rem;">${escapeHtml(run.events?.length?run.events[run.events.length-1].message:"")}</div><div class="run-card-stats"><div><span class="rcs-num">${f.length}</span><div class="rcs-label">Findings</div></div><div><span class="rcs-num" style="color:var(--critical);">${f.filter(x=>x.severity==="Critical").length}</span><div class="rcs-label">Critical</div></div><div><span class="rcs-num" style="color:var(--high);">${f.filter(x=>x.severity==="High").length}</span><div class="rcs-label">High</div></div><div><span class="rcs-num">${p.length}</span><div class="rcs-label">Fixes</div></div></div><div class="run-card-actions"><button class="slim" data-open-run="${run.id}">View Reports</button><a class="btn slim" href="${API_BASE_URL}/api/runs/${run.id}/executive-summary.pdf" download>📄</a></div></div>`;}).join("");
  $("runs-table").querySelectorAll("[data-open-run]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();openRun(b.getAttribute("data-open-run"));}));
  $("runs-table").querySelectorAll(".run-card[data-run-id]").forEach(c=>c.addEventListener("click",()=>openRun(c.getAttribute("data-run-id"))));
}
async function decide(runId,proposalId,decision){await fetchJson(`/api/runs/${runId}/approvals/${proposalId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decision,reviewer:"demo"})});await loadRuns();await loadRunDetail();}
window.decide=decide;
async function startRemediation(runId){openRemediationModal();$("remediation-progress-phase").textContent="remediation_requested";$("remediation-progress-message").textContent="Submitting...";const run=await fetchJson(`/api/runs/${runId}/start-remediation`,{method:"POST"});state.activeRemediationRunId=run.id;updateRemediationProgress(run);await loadRuns();}
window.startRemediation=startRemediation;

function pdfBtn(runId){return `<div style="text-align:right;margin-bottom:0.5rem;"><a class="btn-primary slim" href="${API_BASE_URL}/api/runs/${runId}/executive-summary.pdf" download>📄 Download PDF</a></div>`;}

function renderRunDetail(run){
  $("selected-run-hint").style.display="none";$("report-tabs").style.display="flex";
  renderTab(state.activeTab,run);
  document.querySelectorAll(".tab-btn").forEach(btn=>{btn.onclick=()=>{state.activeTab=btn.dataset.tab;document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");renderTab(state.activeTab,run);};});
}
function renderTab(tab,run){
  const c=$("tab-content");const findings=run.findings||[];const proposals=run.proposals||[];const rem=run.remediation_summary||{};const events=run.events||[];const pr=run.pull_request||{};
  switch(tab){
    case"executive":c.innerHTML=renderExecutiveTab(run,findings,proposals,rem,pr);break;
    case"vulnerabilities":c.innerHTML=renderVulnerabilitiesTab(findings);break;
    case"changes":c.innerHTML=renderChangesTab(rem,proposals);break;
    case"codefix":c.innerHTML=renderCodeFixTab(rem);break;
    case"tests":c.innerHTML=renderTestsTab(events);break;
    case"score":c.innerHTML=renderScoreTab(findings,proposals);setTimeout(()=>drawScoreChart(findings,proposals),100);break;
    case"pr":c.innerHTML=renderPRTab(pr);break;
    case"timeline":c.innerHTML=renderTimelineTab(events);break;
    case"deps":c.innerHTML=renderDepsTab(findings);setTimeout(()=>drawDepsChart(findings),100);break;
    case"evidence":c.innerHTML=renderEvidenceTab(run);break;
  }
}
function renderExecutiveTab(run,findings,proposals,rem,pr){
  const crit=findings.filter(f=>f.severity==="Critical").length;const high=findings.filter(f=>f.severity==="High").length;const med=findings.filter(f=>f.severity==="Medium").length;const low=findings.filter(f=>f.severity==="Low").length;
  return `${pdfBtn(run.id)}<div class="kpi-grid"><div class="kpi-card glass"><div class="kpi-num" style="color:var(--critical)">${findings.length}</div><div class="kpi-label">Vulnerabilities</div></div><div class="kpi-card glass"><div class="kpi-num" style="color:var(--success)">${proposals.length}</div><div class="kpi-label">Fixes Applied</div></div><div class="kpi-card glass"><div class="kpi-num" style="color:var(--accent)">${rem.changed_files?.length||0}</div><div class="kpi-label">Files Changed</div></div><div class="kpi-card glass"><div class="kpi-num">${pr.status==="created"?"✅":"⏳"}</div><div class="kpi-label">PR Status</div></div></div><div class="section glass" style="margin-top:1rem;"><h3>Severity Distribution</h3><div style="display:flex;gap:0.5rem;margin-top:0.5rem;"><div class="sev-bar critical" style="flex:${crit};min-width:40px;">Critical ${crit}</div><div class="sev-bar high" style="flex:${high};min-width:30px;">High ${high}</div><div class="sev-bar medium" style="flex:${med};min-width:30px;">Medium ${med}</div><div class="sev-bar low" style="flex:${low};min-width:20px;">Low ${low}</div></div></div><div class="section glass" style="margin-top:1rem;"><h3>Run Info</h3><table class="data-table"><tr><td>Run ID</td><td class="mono">${escapeHtml(run.id)}</td></tr><tr><td>Repository</td><td class="mono">${escapeHtml(run.repo_url)}</td></tr><tr><td>Status</td><td>${statusBadge(run.status)}</td></tr><tr><td>Phase</td><td>${escapeHtml(run.phase)}</td></tr><tr><td>Languages</td><td>${(run.languages||[]).join(", ")||"All"}</td></tr></table></div>`;
}
function renderVulnerabilitiesTab(findings){if(!findings.length)return `<div class="empty"><p>No vulnerabilities detected 🎉</p></div>`;return `<table class="data-table"><thead><tr><th>Severity</th><th>Dependency</th><th>Current</th><th>Fixed</th><th>CVE</th></tr></thead><tbody>${findings.map(f=>`<tr><td>${severityBadge(f.severity)}</td><td><strong>${escapeHtml(f.dependency)}</strong></td><td class="mono">${escapeHtml(f.current_version)}</td><td class="mono" style="color:var(--success);">${escapeHtml((f.recommended_versions||[])[0]||f.fixed_version||"?")}</td><td class="mono"><a href="https://nvd.nist.gov/vuln/detail/${escapeHtml(f.cve)}" target="_blank" style="color:var(--accent);">${escapeHtml(f.cve)}</a></td></tr>`).join("")}</tbody></table>`;}
function renderChangesTab(rem,proposals){const changes=rem.changes||[];if(!changes.length&&!proposals.length)return `<div class="empty"><p>No changes recorded.</p></div>`;return `<table class="data-table"><thead><tr><th>Dependency</th><th>Old</th><th>→</th><th>New</th><th>File</th></tr></thead><tbody>${(changes.length?changes:proposals.map(p=>({dependency:p.dependency,old_version:p.from_version,new_version:p.to_version,file_path:""}))).map(c=>`<tr><td><strong>${escapeHtml(c.dependency)}</strong></td><td class="mono">${escapeHtml(c.old_version||"?")}</td><td style="color:var(--accent);">→</td><td class="mono" style="color:var(--success);font-weight:600;">${escapeHtml(c.new_version||"?")}</td><td class="mono" style="font-size:0.76rem;color:var(--text-dim);">${escapeHtml(c.file_path||"")}</td></tr>`).join("")}</tbody></table>`;}
function renderCodeFixTab(rem){const diff=rem.diff_excerpt||"";if(!diff)return `<div class="empty"><p>No code fixes needed.</p></div>`;const lines=diff.split("\n").slice(0,100);return `<div class="diff-view">${lines.map(l=>{const cls=l.startsWith("+")?"diff-add":l.startsWith("-")?"diff-del":"diff-ctx";return `<div class="${cls}">${escapeHtml(l)||"&nbsp;"}</div>`;}).join("")}</div>`;}
function renderTestsTab(events){const te=events.filter(e=>e.message.includes("test")||e.message.includes("Test")||e.message.includes("passed")||e.message.includes("failed"));if(!te.length)return `<div class="empty"><p>No test results.</p></div>`;return `<div class="section">${te.map(e=>{const icon=e.message.includes("✅")||e.message.includes("passed")?"✅":e.message.includes("❌")||e.message.includes("failed")?"❌":"ℹ️";return `<div class="vuln-row"><div class="vuln-info"><div class="vuln-name">${icon} ${escapeHtml(e.message)}</div></div></div>`;}).join("")}</div>`;}
function renderScoreTab(findings,proposals){const total=findings.length;const fixed=proposals.length;const score=total>0?Math.round((fixed/total)*100):100;return `<div style="text-align:center;padding:1rem;"><canvas id="score-chart" width="200" height="200"></canvas><h3 style="margin-top:0.5rem;">Security Score: ${score}%</h3><p class="muted">${fixed} of ${total} vulnerabilities remediated</p></div>`;}
function drawScoreChart(findings,proposals){const ctx=document.getElementById("score-chart");if(!ctx)return;if(state.charts.score)state.charts.score.destroy();const fixed=proposals.length;const remaining=Math.max(0,findings.length-fixed);state.charts.score=new Chart(ctx,{type:"doughnut",data:{labels:["Fixed","Remaining"],datasets:[{data:[fixed,remaining],backgroundColor:["#22c55e","#ef4444"],borderWidth:0}]},options:{cutout:"70%",plugins:{legend:{position:"bottom"}}}});}
function renderPRTab(pr){return `<div class="section glass"><h3>Pull Request</h3><table class="data-table"><tr><td>Status</td><td><span class="badge ${pr.status==="created"?"completed":"queued"}">${escapeHtml(pr.status)}</span></td></tr><tr><td>URL</td><td>${pr.url?`<a href="${escapeHtml(pr.url)}" target="_blank" style="color:var(--accent);">${escapeHtml(pr.url)}</a>`:"N/A"}</td></tr><tr><td>Reason</td><td>${escapeHtml(pr.reason||"N/A")}</td></tr></table></div>`;}
function renderTimelineTab(events){if(!events.length)return `<div class="empty"><p>No events recorded.</p></div>`;return `<div class="timeline">${events.map(e=>{const icon=e.level==="error"?"❌":e.level==="warn"?"⚠️":"ℹ️";return `<div class="tl-item"><div class="tl-icon">${icon}</div><div class="tl-content"><div class="tl-time">${timeAgo(e.timestamp)}</div><div class="tl-msg">${escapeHtml(e.message)}</div></div></div>`;}).join("")}</div>`;}
function renderDepsTab(findings){if(!findings.length)return `<div class="empty"><p>No dependencies found.</p></div>`;return `<canvas id="deps-chart" width="400" height="200"></canvas>`;}
function drawDepsChart(findings){const ctx=document.getElementById("deps-chart");if(!ctx)return;if(state.charts.deps)state.charts.deps.destroy();const sc={};findings.forEach(f=>{sc[f.severity]=(sc[f.severity]||0)+1;});state.charts.deps=new Chart(ctx,{type:"bar",data:{labels:Object.keys(sc),datasets:[{label:"Vulnerabilities",data:Object.values(sc),backgroundColor:["#ef4444","#f97316","#eab308","#22c55e"]}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});}
function renderEvidenceTab(run){const ev=run.evidence||{};return `<div class="section glass"><h3>Evidence Bundle</h3><table class="data-table"><tr><td>Summary</td><td>${escapeHtml(ev.summary||"Pending...")}</td></tr><tr><td>Export Links</td><td>${(ev.export_links||[]).map(l=>`<div class="mono" style="font-size:0.78rem;">${escapeHtml(l)}</div>`).join("")}</td></tr><tr><td>Audit Events</td><td>${ev.audit_events||(run.events||[]).length}</td></tr></table></div>`;}

async function loadRunDetail(){if(!state.selectedRunId){$("tab-content").innerHTML="";$("selected-run-hint").style.display="block";$("report-tabs").style.display="none";return;}const run=await fetchJson(`/api/runs/${state.selectedRunId}`);showPage("run-detail");renderRunDetail(run);}
async function loadRuns(){const runs=await fetchJson("/api/runs");renderRuns(runs);}

$("refresh-runs").addEventListener("click",async()=>{await loadRuns();await loadRunDetail();});
$("scan-form").addEventListener("submit",async(event)=>{event.preventDefault();const repoUrl=$("repo-url").value.trim();const requestedBy=$("requested-by").value.trim()||"hackathon-user";if(!repoUrl)return;const languages=[];if($("lang-java")?.checked)languages.push("java");if($("lang-python")?.checked)languages.push("python");if($("lang-nodejs")?.checked)languages.push("nodejs");$("start-scan-button").disabled=true;$("scan-progress-panel").classList.remove("hidden");$("scan-progress-fill").style.width="12%";$("scan-progress-phase").textContent="queued";$("scan-progress-message").textContent="Creating scan run.";const run=await fetchJson("/api/runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({repo_url:repoUrl,requested_by:requestedBy,languages})});state.selectedRunId=run.id;state.activeScanRunId=run.id;updateScanProgress(run);await loadRuns();});
$("open-scan-modal").addEventListener("click",openScanModal);
$("close-scan-modal").addEventListener("click",closeScanModal);
$("scan-modal-backdrop").addEventListener("click",closeScanModal);
$("home-button").addEventListener("click",goHome);
$("run-detail-home").addEventListener("click",goHome);

async function init(){showPage("dashboard");resetScanProgress();closeRemediationModal();await loadRuns();setInterval(async()=>{try{await loadRuns();if(state.currentPage==="run-detail")await loadRunDetail();await monitorActiveScan();await monitorActiveRemediation();}catch(e){}},3000);}
init().catch((error)=>{console.error("Init failed:",error);$("stats").innerHTML="";$("runs-table").innerHTML=`<div class="empty"><p style="color:var(--danger);">⚠️ Backend connection failed</p><p class="muted" style="font-size:0.8rem;margin-top:0.5rem;">${escapeHtml(error.message||error)}</p><button class="btn-primary mt" onclick="location.reload()">Retry</button></div>`;});
