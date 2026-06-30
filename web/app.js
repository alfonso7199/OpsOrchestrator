// OpsOrchestrator frontend logic

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

const MAX_FILE_MB = 5;
const MAX_FILES = 6;
const ACCEPTED = new Set(["txt", "eml", "md", "text"]);

const state = { files: [], example: null };
const session = { dossier: "" };

const dropzone = $("#dropzone");
const fileInput = $("#file-input");
const fileList = $("#file-list");
const runBtn = $("#run-btn");
const hint = $("#input-hint");

function extOf(name) { return (name.toLowerCase().split(".").pop() || ""); }

function appendAudit(summary) {
  const audit = document.querySelector(".audit");
  if (!audit) return;
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = el("div");
  line.innerHTML = `<span class="a-time">[${ts}]</span> <span class="a-agent">Reviewer</span>: ${esc(summary)}`;
  audit.appendChild(line);
}

// ---------- files ----------
function renderFiles() {
  fileList.innerHTML = "";
  state.files.forEach((f, i) => {
    const li = el("li");
    li.innerHTML =
      `<svg class="fl-icon"><use href="#i-doc"/></svg>` +
      `<span class="fl-name">${esc(f.name)}</span>` +
      `<span class="fl-kind">${(f.size / 1024).toFixed(0)} KB</span>` +
      `<button class="fl-x" title="Remove">&times;</button>`;
    li.querySelector(".fl-x").onclick = () => { state.files.splice(i, 1); renderFiles(); updateRun(); };
    fileList.appendChild(li);
  });
}
function addFiles(list) {
  const warnings = [];
  for (const f of list) {
    const ext = extOf(f.name);
    if (!ACCEPTED.has(ext)) { warnings.push(`${f.name}: unsupported type`); continue; }
    if (f.size > MAX_FILE_MB * 1024 * 1024) { warnings.push(`${f.name}: over ${MAX_FILE_MB} MB`); continue; }
    if (state.files.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (state.files.length >= MAX_FILES) { warnings.push(`max ${MAX_FILES} files`); break; }
    state.files.push(f);
  }
  renderFiles();
  updateRun();
  if (warnings.length) hint.textContent = "Skipped — " + warnings.join("; ");
}
function updateRun() {
  const has = state.files.length || $("#text-input").value.trim();
  runBtn.disabled = !has;
  hint.textContent = "";
}

dropzone.onclick = () => fileInput.click();
dropzone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
$("#text-input").addEventListener("input", updateRun);

// ---------- examples ----------
async function loadExamples() {
  try {
    const names = await (await fetch("/api/examples")).json();
    if (!Array.isArray(names)) return;
    const box = $("#example-chips");
    names.forEach((n) => {
      const chip = el("button", "chip");
      chip.textContent = n.replace(/_/g, " ").replace(/^\d+\s*/, "");
      chip.onclick = async () => {
        const wasActive = state.example === n;
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        if (wasActive) { state.example = null; $("#text-input").value = ""; }
        else {
          chip.classList.add("active");
          state.example = n;
          try {
            const d = await (await fetch("/api/example/" + encodeURIComponent(n))).json();
            $("#text-input").value = d.text || "";
          } catch (e) { /* ignore */ }
        }
        updateRun();
      };
      box.appendChild(chip);
    });
  } catch (e) { /* optional */ }
}

// ---------- timeline ----------
const STEPS = [
  { key: "evidence", label: "Evidence intake", desc: "Ticket normalized into a dossier" },
  { key: "classify", label: "Classify", desc: "Department, urgency and gaps" },
  { key: "policy", label: "Policy check", desc: "Internal controls with citations" },
  { key: "resolution", label: "Resolution", desc: "Route, response and actions" },
  { key: "sop", label: "SOP", desc: "Reusable procedure" },
  { key: "ready", label: "Human review", desc: "Approve, reject or override" },
];
const AGENT_STEP = {
  ClassifierAgent: "classify", PolicyAgent: "policy",
  ResolutionAgent: "resolution", SOPAgent: "sop", Manager: "ready",
};

function buildTimeline() {
  const ol = $("#timeline");
  ol.innerHTML = "";
  STEPS.forEach((s) => {
    const li = el("li");
    li.dataset.key = s.key;
    li.innerHTML = `<span class="tl-dot">${icon("i-check")}</span><div class="tl-label">${s.label}</div><div class="tl-desc">${s.desc}</div>`;
    ol.appendChild(li);
  });
}
function setStep(key) {
  const order = STEPS.map((s) => s.key);
  const idx = order.indexOf(key);
  if (idx < 0) return;
  document.querySelectorAll("#timeline li").forEach((li) => {
    const i = order.indexOf(li.dataset.key);
    li.classList.remove("active", "done");
    if (i < idx) li.classList.add("done");
    else if (i === idx) li.classList.add("active");
  });
}
function finishTimeline() {
  document.querySelectorAll("#timeline li").forEach((li) => { li.classList.remove("active"); li.classList.add("done"); });
}
function addEvidence(name, kind) {
  const li = el("li");
  li.innerHTML = `<svg><use href="#i-doc"/></svg><span>${esc(name)}</span><span class="ev-kind">${esc(kind)}</span>`;
  $("#evidence-list").appendChild(li);
}

// ---------- run ----------
function startJob(fd) {
  $("#input-card").classList.add("hidden");
  buildTimeline();
  $("#evidence-list").innerHTML = "";
  $("#run-card").classList.remove("hidden");
  $("#result-card").classList.add("hidden");
  $("#reset-row").classList.add("hidden");
  $("#run-card").scrollIntoView({ behavior: "smooth", block: "start" });

  (async () => {
    let job;
    try {
      job = await (await fetch("/api/process", { method: "POST", body: fd })).json();
    } catch (e) { return showError("Could not reach the server. Is it running?"); }
    if (!job || !job.job_id) return showError("The server did not start a job.");

    let done = false;
    const es = new EventSource("/api/events/" + job.job_id);
    es.onmessage = (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.type === "progress") setStep(AGENT_STEP[ev.agent] || "evidence");
      else if (ev.type === "evidence") addEvidence(ev.name, ev.kind);
      else if (ev.type === "note") addEvidence(ev.message, "note");
      else if (ev.type === "result") { done = true; es.close(); session.dossier = ev.dossier || session.dossier; renderResult(ev.data); }
      else if (ev.type === "error") { done = true; es.close(); showError(ev.message); }
    };
    es.onerror = () => { es.close(); if (!done) showError("Lost connection during processing. Please retry."); };
  })();
}

runBtn.onclick = () => {
  const fd = new FormData();
  fd.append("text", $("#text-input").value || "");
  state.files.forEach((f) => fd.append("files", f, f.name));
  startJob(fd);
};

function showError(message) {
  finishTimeline();
  const r = $("#result-card");
  r.classList.remove("hidden");
  r.innerHTML = `<div class="panel"><h3>${icon("i-alert")} Could not complete</h3>
    <p class="para">${esc(message)}</p>
    <p class="para muted">Check that OPENAI_API_KEY is set in .env and that the ticket is readable.</p></div>`;
  $("#reset-row").classList.remove("hidden");
}

// ---------- rendering ----------
const pct = (v) => (v == null || isNaN(Number(v)) ? "—" : (Number(v) * 100).toFixed(0) + "%");
const tags = (arr, cls) => (Array.isArray(arr) && arr.length)
  ? `<div class="tagrow">${arr.map((t) => `<span class="tag ${cls || ""}">${esc(t)}</span>`).join("")}</div>` : "";
const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "N/A")}</dd>`).join("")}</dl>`;

const ROUTE = {
  auto_resolve: "Auto-resolve ready",
  human_approval: "Approval required",
  escalate: "Escalate to control owner",
  pending_information: "Pending information",
};
const ACTION_LABEL = {
  ticket_resolved: "Ticket resolved",
  approval_requested: "Approval requested",
  escalated: "Escalated",
  request_info: "Information requested",
};

function renderResult(d) {
  const r = $("#result-card");
  r.innerHTML = "";
  r.classList.remove("hidden");
  finishTimeline();

  const ix = d.intake || {}, pol = d.policy || {}, res = d.resolution || {}, sop = d.sop || {};
  const routeLabel = ROUTE[res.route] || esc(res.route || "—");

  // banner
  const banner = el("div", "banner route-" + (res.route || "unknown"));
  banner.innerHTML =
    `<span class="b-dot"></span>` +
    `<div><div class="b-main">${routeLabel}</div><div class="b-sub">${esc(res.action_summary || "")}</div></div>` +
    `<span class="b-conf">confidence ${pct(res.confidence)}</span>`;
  r.appendChild(banner);

  if (res.requires_human_review) {
    r.appendChild(el("div", "review-note", `${icon("i-alert")} Human review required before execution.`));
  }

  // intake + policy
  const row = el("div", "grid-2");
  const intake = el("div", "panel");
  intake.innerHTML = `<h3>Ticket intake ${icon("i-doc")}</h3>
    ${kv([
      ["Requester", ix.requester_name],
      ["Email", ix.requester_email],
      ["Department", ix.department],
      ["Category", ix.category],
      ["Urgency", ix.urgency],
    ])}
    <p class="para">${esc(ix.summary || ix.requested_action || "")}</p>
    ${tags(ix.entities)}
    ${Array.isArray(ix.missing_fields) && ix.missing_fields.length ? `<p class="para muted" style="margin-top:14px">Missing fields</p>${tags(ix.missing_fields, "warn")}` : ""}
    ${Array.isArray(ix.risk_flags) && ix.risk_flags.length ? `<p class="para muted" style="margin-top:14px">Risk flags</p>${tags(ix.risk_flags, "bad")}` : ""}`;
  row.appendChild(intake);

  const policy = el("div", "panel");
  const allowed = pol.allowed_action
    ? `<span class="flagline flag-yes">${icon("i-check")} Allowed by policy</span>`
    : `<span class="flagline flag-no">${icon("i-alert")} Control gate required</span>`;
  policy.innerHTML = `<h3>Policy check ${icon("i-search")}</h3>
    ${allowed}
    <p class="para muted" style="margin-top:8px">${esc(pol.applicable_policy || "Internal policy")}</p>
    <p class="para">${esc(pol.reasoning || "")}</p>
    ${Array.isArray(pol.controls_required) && pol.controls_required.length ? `<p class="para muted" style="margin-top:12px">Controls required</p>${tags(pol.controls_required, "ok")}` : ""}
    ${Array.isArray(pol.missing_controls) && pol.missing_controls.length ? `<p class="para muted" style="margin-top:12px">Missing controls</p>${tags(pol.missing_controls, "warn")}` : ""}
    ${(Array.isArray(pol.clause_citations) ? pol.clause_citations : []).map((c) => `<div class="cite"><div class="c-id">${esc(c.clause)}</div><div class="c-quote">${esc(c.quote)}</div></div>`).join("")}`;
  row.appendChild(policy);
  r.appendChild(row);

  // resolution + decision
  const resolution = el("div", "panel");
  const cur = res.route || "";
  const opts = Object.keys(ROUTE).map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${ROUTE[k]}</option>`).join("");
  resolution.innerHTML = `<h3>Resolution draft ${icon("i-route")}</h3>
    <p class="para">${esc(res.employee_response || "")}</p>
    ${Array.isArray(res.system_actions) && res.system_actions.length ? `<p class="para muted" style="margin-top:12px">System actions</p>${tags(res.system_actions)}` : ""}
    ${Array.isArray(res.approvers) && res.approvers.length ? `<p class="para muted" style="margin-top:12px">Approvers</p>${tags(res.approvers, "warn")}` : ""}
    <div class="override">
      <label class="ov-label">Decision route <select class="ov-route">${opts}</select></label>
      <textarea class="ov-note" rows="2" placeholder="Reviewer note (optional) — recorded in the audit trail"></textarea>
    </div>
    <div class="actions" style="margin-top:14px">
      <button class="btn-approve">${icon("i-check")} Approve</button>
      <button class="btn-reject">Reject</button>
      <button class="btn-ghost btn-dl">${icon("i-download")} Download JSON</button>
    </div>
    <div class="decision-made muted" style="margin-top:14px"></div>`;
  r.appendChild(resolution);

  const note = resolution.querySelector(".decision-made");
  const approveBtn = resolution.querySelector(".btn-approve");
  const rejectBtn = resolution.querySelector(".btn-reject");
  const routeSel = resolution.querySelector(".ov-route");
  const noteEl = resolution.querySelector(".ov-note");

  async function finalize(decision) {
    approveBtn.disabled = rejectBtn.disabled = true;
    note.style.color = "var(--slate)";
    note.innerHTML = `<span class="spinner"></span> Triggering downstream action...`;
    const chosenRoute = routeSel ? routeSel.value : res.route;
    const reviewerNote = noteEl ? noteEl.value.trim() : "";
    const overridden = chosenRoute !== res.route;
    const resolutionOut = Object.assign({}, res, { route: chosenRoute });
    try {
      const fin = await (await fetch("/api/finalize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, intake: d.intake, policy: d.policy, resolution: resolutionOut, note: reviewerNote }),
      })).json();
      if (fin.error) { note.textContent = "Could not finalize: " + fin.error; note.style.color = "var(--coral)"; approveBtn.disabled = rejectBtn.disabled = false; return; }
      note.textContent = "";
      appendAudit(`${decision}` + (overridden ? ` · route overridden to ${ROUTE[chosenRoute] || chosenRoute}` : "") + (reviewerNote ? ` · note: ${reviewerNote}` : ""));
      renderOutcome(decision, fin, r, d, { approveBtn, rejectBtn, note });
    } catch (e) { note.textContent = "Could not finalize. Please retry."; note.style.color = "var(--coral)"; approveBtn.disabled = rejectBtn.disabled = false; }
  }
  approveBtn.onclick = () => finalize("approved");
  rejectBtn.onclick = () => finalize("rejected");
  resolution.querySelector(".btn-dl").onclick = () => {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = el("a"); a.href = URL.createObjectURL(blob); a.download = "work_item.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // SOP
  const sopP = el("div", "panel");
  sopP.innerHTML = `<h3>Reusable SOP ${icon("i-sop")}</h3>
    <p class="para"><strong>${esc(sop.title || "")}</strong></p>
    ${sop.trigger ? `<p class="para muted">Trigger: ${esc(sop.trigger)}</p>` : ""}
    ${Array.isArray(sop.steps) && sop.steps.length ? `<ol class="steps">${sop.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
    ${tags(sop.controls, "ok")}`;
  r.appendChild(sopP);

  // audit
  auditPanel(r, d.audit_log);
  reevalPanel(r);

  $("#reset-row").classList.remove("hidden");
  r.scrollIntoView({ behavior: "smooth", block: "start" });
}

function auditPanel(r, log) {
  const p = el("div", "panel");
  p.innerHTML = `<h3>Audit trail ${icon("i-clip")}</h3><div class="audit">` +
    (Array.isArray(log) ? log : []).map((e) =>
      `<div><span class="a-time">[${esc(e.timestamp)}]</span> <span class="a-agent">${esc(e.agent)}</span>: ${esc(e.summary)}</div>`
    ).join("") + `</div>`;
  r.appendChild(p);
}

function renderOutcome(decision, fin, r, full, controls) {
  full.decision = decision;
  full.finalization = fin;
  const ok = decision === "approved";
  const p = el("div", "panel");
  p.innerHTML =
    `<h3>Outcome ${icon(ok ? "i-check" : "i-alert")}</h3>` +
    `<div class="flagline ${ok ? "flag-yes" : "flag-no"}">${icon(ok ? "i-check" : "i-alert")} ${esc(ACTION_LABEL[fin.action] || fin.action || "")} — ${esc(fin.action_summary || "")}</div>` +
    `<p class="para muted" style="margin-top:16px">Employee message</p>` +
    `<div class="info-email">${esc(fin.employee_message || "")}</div>` +
    (Array.isArray(fin.next_steps) && fin.next_steps.length
      ? `<p class="para muted" style="margin-top:16px">Next steps</p><ul class="next">${fin.next_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "") +
    `<div class="actions" style="margin-top:18px">
        <button class="btn-ghost btn-copy">Copy message</button>
        <button class="btn-ghost btn-reopen">${icon("i-redo")} Reopen for review</button>
     </div>`;
  p.querySelector(".btn-copy").onclick = () => navigator.clipboard && navigator.clipboard.writeText(fin.employee_message || "");
  p.querySelector(".btn-reopen").onclick = () => {
    p.remove();
    if (controls) { controls.approveBtn.disabled = false; controls.rejectBtn.disabled = false; controls.note.textContent = ""; }
    appendAudit("work item reopened for review");
  };
  r.appendChild(p);
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function reevalPanel(r) {
  const p = el("div", "panel");
  p.innerHTML = `<h3>${icon("i-upload")} Add information &amp; re-evaluate</h3>
    <p class="para muted">Got the missing data or a policy update? Add it and OpsOrchestrator re-runs the full workflow, merged with the current item.</p>
    <textarea class="re-text" rows="3" placeholder="e.g. Manager approval attached; cost center is 4021"></textarea>
    <div class="actions" style="margin-top:12px">
      <label class="btn-ghost re-file-label">${icon("i-upload")} Add files</label>
      <input type="file" class="re-files" multiple hidden accept=".txt,.eml,.md,.text">
      <span class="re-fname muted"></span>
      <button class="btn-approve re-run">${icon("i-redo")} Re-evaluate</button>
    </div>`;
  const fileInputR = p.querySelector(".re-files");
  const fname = p.querySelector(".re-fname");
  let extra = [];
  p.querySelector(".re-file-label").onclick = () => fileInputR.click();
  fileInputR.onchange = () => { extra = Array.from(fileInputR.files); fname.textContent = extra.map((f) => f.name).join(", "); };
  p.querySelector(".re-run").onclick = () => {
    const txt = p.querySelector(".re-text").value.trim();
    if (!txt && !extra.length) { fname.textContent = "Add a note or a file first."; return; }
    const fd = new FormData();
    fd.append("text", (session.dossier || "") + "\n\n=== ADDITIONAL INFORMATION (provided by reviewer) ===\n" + txt);
    extra.forEach((f) => fd.append("files", f, f.name));
    startJob(fd);
  };
  r.appendChild(p);
}

// ---------- reset ----------
$("#reset-btn").onclick = () => {
  state.files = []; state.example = null;
  fileInput.value = ""; $("#text-input").value = "";
  renderFiles();
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  $("#result-card").classList.add("hidden");
  $("#run-card").classList.add("hidden");
  $("#reset-row").classList.add("hidden");
  $("#input-card").classList.remove("hidden");
  updateRun();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

loadExamples();

/* ============================================================
   Bring-your-own OpenAI key (for public / self-hosted demo).
   Adds a top-bar button; stores the key in localStorage and
   sends it as X-OpenAI-Key on every /api/ request. The server
   uses it if present, otherwise falls back to its .env key.
   ============================================================ */
(function () {
  var KEY = "OPENAI_KEY";
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    var k = localStorage.getItem(KEY);
    if (k && typeof url === "string" && url.indexOf("/api/") === 0) {
      opts = Object.assign({}, opts);
      opts.headers = Object.assign({}, opts.headers || {}, { "X-OpenAI-Key": k });
    }
    return _fetch(url, opts);
  };

  var ACC = "var(--accent, var(--teal, var(--accent-deep, #2563eb)))";
  var CARD = "var(--card, var(--panel, var(--paper, #ffffff)))";
  var INK = "var(--ink, #1a1a1a)";
  var LINE = "var(--line, #dddddd)";
  var MUTED = "var(--muted, var(--slate, var(--muted-ink, #888888)))";
  var css =
    ".kk-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid " + LINE + ";background:" + CARD + ";color:" + INK + ";font:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px;cursor:pointer}" +
    ".kk-btn:hover{border-color:" + ACC + "}" +
    ".kk-dot{width:8px;height:8px;border-radius:50%;background:#d9a33a}" +
    ".kk-dot.on{background:#2aa676}" +
    ".kk-ov{position:fixed;inset:0;background:rgba(10,15,20,.55);display:grid;place-items:center;z-index:99999;padding:20px}" +
    ".kk-card{background:" + CARD + ";color:" + INK + ";border:1px solid " + LINE + ";border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);font-family:inherit}" +
    ".kk-card h4{margin:0 0 6px;font-size:18px}" +
    ".kk-card p{margin:0 0 14px;font-size:13px;color:" + MUTED + "}" +
    ".kk-card input{width:100%;box-sizing:border-box;border:1px solid " + LINE + ";border-radius:10px;padding:11px 13px;font:inherit;font-size:14px;background:" + CARD + ";color:" + INK + "}" +
    ".kk-card input:focus{outline:none;border-color:" + ACC + "}" +
    ".kk-row{display:flex;gap:10px;margin-top:14px}" +
    ".kk-save{flex:1;border:none;cursor:pointer;background:" + ACC + ";color:#fff;border-radius:10px;padding:11px;font:inherit;font-weight:600}" +
    ".kk-clear{border:1px solid " + LINE + ";background:transparent;color:" + INK + ";border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit;font-weight:600}" +
    ".kk-note{margin-top:12px;font-size:11.5px;color:" + MUTED + ";line-height:1.5}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement("button");
  btn.className = "kk-btn";
  btn.type = "button";
  function refresh() {
    var has = !!localStorage.getItem(KEY);
    btn.innerHTML = '<span class="kk-dot' + (has ? " on" : "") + '"></span>' + (has ? "API key set" : "Add API key");
  }
  function mount() {
    var h = document.querySelector(".nav-inner") || document.querySelector(".topbar");
    if (!h) {
      btn.style.position = "fixed"; btn.style.top = "14px"; btn.style.right = "16px"; btn.style.zIndex = "9998";
      document.body.appendChild(btn);
    } else {
      h.appendChild(btn);
    }
    refresh();
  }
  btn.onclick = function () {
    var ov = document.createElement("div"); ov.className = "kk-ov";
    var cur = localStorage.getItem(KEY) || "";
    var card = document.createElement("div"); card.className = "kk-card";
    card.innerHTML =
      "<h4>OpenAI API key</h4>" +
      "<p>Use your own key to run this demo. It is stored only in this browser and sent to your local server with each request.</p>" +
      '<input type="password" class="kk-in" placeholder="sk-..." autocomplete="off">' +
      '<div class="kk-row"><button class="kk-save" type="button">Save</button><button class="kk-clear" type="button">Clear</button></div>' +
      '<div class="kk-note">Stored in your browser (localStorage) on this device only. Never commit your key to the repo. If you leave this empty, the server uses its own .env key.</div>';
    ov.appendChild(card);
    card.querySelector(".kk-in").value = cur;
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    card.querySelector(".kk-save").onclick = function () {
      var v = card.querySelector(".kk-in").value.trim();
      if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
      refresh(); ov.remove();
    };
    card.querySelector(".kk-clear").onclick = function () { localStorage.removeItem(KEY); refresh(); ov.remove(); };
    document.body.appendChild(ov);
    card.querySelector(".kk-in").focus();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
