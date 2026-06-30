const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

const state = { example: null, files: [], dossier: "", result: null };
const steps = ["evidence", "classify", "policy", "resolution", "sop", "ready"];
const agentStep = {
  ClassifierAgent: "classify",
  PolicyAgent: "policy",
  ResolutionAgent: "resolution",
  SOPAgent: "sop",
  Manager: "ready",
};
const routes = {
  auto_resolve: { label: "Auto-resolve ready", icon: "i-check" },
  human_approval: { label: "Approval required", icon: "i-shield" },
  escalate: { label: "Escalate to control owner", icon: "i-alert" },
  pending_information: { label: "Pending information", icon: "i-alert" },
};

function routeClass(route) {
  return String(route || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
}

function updateRun() {
  const hasInput = $("#text").value.trim() || state.example || state.files.length;
  $("#run").disabled = !hasInput;
  $("#hint").textContent = "";
}

function setStep(step) {
  const idx = steps.indexOf(step);
  document.querySelectorAll("#timeline li").forEach((li) => {
    const i = steps.indexOf(li.dataset.step);
    li.classList.remove("active", "done");
    li.removeAttribute("aria-current");
    if (i < idx) li.classList.add("done");
    if (i === idx) {
      li.classList.add("active");
      li.setAttribute("aria-current", "step");
    }
  });
}

function finishTimeline() {
  document.querySelectorAll("#timeline li").forEach((li) => {
    li.classList.remove("active");
    li.classList.add("done");
    li.removeAttribute("aria-current");
  });
}

function resetTimeline() {
  document.querySelectorAll("#timeline li").forEach((li) => {
    li.classList.remove("active", "done");
    li.removeAttribute("aria-current");
  });
}

function tags(items, cls = "") {
  return Array.isArray(items) && items.length
    ? `<div class="tags">${items.map((x) => `<span class="tag ${cls}">${esc(x)}</span>`).join("")}</div>`
    : "";
}

function kv(rows) {
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "N/A")}</dd>`).join("")}</dl>`;
}

async function loadExamples() {
  const names = await (await fetch("/api/examples")).json();
  const box = $("#examples");
  box.innerHTML = "";
  names.forEach((name) => {
    const b = el("button", "chip", name.replace(/_/g, " "));
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => {
      const active = state.example === name;
      document.querySelectorAll(".chip").forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-pressed", "false");
      });
      state.example = active ? null : name;
      if (!active) {
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
      }
      updateRun();
    };
    box.appendChild(b);
  });
}

function renderFiles() {
  const list = $("#file-list");
  list.innerHTML = "";
  state.files.forEach((f, i) => {
    const li = el("li");
    li.innerHTML = `<span>${esc(f.name)}</span><span>${Math.max(1, Math.round(f.size / 1024))} KB <button type="button" aria-label="Remove ${esc(f.name)}">x</button></span>`;
    li.querySelector("button").onclick = () => {
      state.files.splice(i, 1);
      renderFiles();
      updateRun();
    };
    list.appendChild(li);
  });
}

$("#text").addEventListener("input", updateRun);
$("#files").addEventListener("change", () => {
  state.files = Array.from($("#files").files || []);
  renderFiles();
  updateRun();
});

$("#run").onclick = async () => {
  const fd = new FormData();
  fd.append("text", $("#text").value || "");
  if (state.example) fd.append("examples", state.example);
  state.files.forEach((f) => fd.append("files", f, f.name));

  $("#run").disabled = true;
  $("#hint").textContent = "";
  $("#evidence").innerHTML = "";
  $("#status").textContent = "Starting agent workflow...";
  resetTimeline();
  setStep("evidence");
  renderLoading();

  let job;
  try {
    job = await (await fetch("/api/process", { method: "POST", body: fd })).json();
  } catch (e) {
    $("#run").disabled = false;
    $("#hint").textContent = "Server not reachable.";
    renderError("Server not reachable.");
    return;
  }

  const es = new EventSource(`/api/events/${job.job_id}`);
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === "progress") {
      $("#status").textContent = `${ev.agent}: ${ev.status}`;
      setStep(agentStep[ev.agent] || "evidence");
    }
    if (ev.type === "evidence") addEvidence(ev.name, ev.kind);
    if (ev.type === "note") addEvidence(ev.message, "note");
    if (ev.type === "error") {
      es.close();
      $("#run").disabled = false;
      $("#hint").textContent = ev.message;
      renderError(ev.message);
    }
    if (ev.type === "result") {
      es.close();
      $("#run").disabled = false;
      finishTimeline();
      state.dossier = ev.dossier;
      state.result = ev.data;
      renderResult(ev.data);
    }
  };
  es.onerror = () => {
    es.close();
    $("#run").disabled = false;
    renderError("Lost connection during processing. Please retry.");
  };
};

function addEvidence(name, kind) {
  const li = el("li");
  li.innerHTML = `<span>${esc(name)}</span><span>${esc(kind)}</span>`;
  $("#evidence").appendChild(li);
}

function renderLoading() {
  $("#results").innerHTML = `
    <div class="empty-state">
      <span>${icon("i-flow")}</span>
      <h2>Agents at work</h2>
      <p>The decision file will appear here as soon as the workflow completes.</p>
    </div>
  `;
}

function renderError(message) {
  $("#results").innerHTML = `
    <div class="decision-banner route-pending_information">
      <span class="decision-icon">${icon("i-alert")}</span>
      <div>
        <h2>Could not complete workflow</h2>
        <p>${esc(message)}</p>
      </div>
      <div class="confidence"><strong>--</strong><span>status</span></div>
    </div>
  `;
}

function renderResult(d) {
  const r = $("#results");
  const intake = d.intake || {};
  const policy = d.policy || {};
  const res = d.resolution || {};
  const sop = d.sop || {};
  const route = routes[res.route] || { label: res.route || "Route", icon: "i-route" };
  const confidence = Math.round((Number(res.confidence) || 0) * 100);
  const allowedText = policy.allowed_action ? "Allowed by policy" : "Control gate required";

  r.innerHTML = `
    <div class="decision-banner route-${routeClass(res.route)}">
      <span class="decision-icon">${icon(route.icon)}</span>
      <div>
        <h2>${esc(route.label)}</h2>
        <p>${esc(res.action_summary || "No action summary returned.")}</p>
        ${res.requires_human_review ? `<p class="review-callout">${icon("i-lock")} Human review required before execution.</p>` : ""}
      </div>
      <div class="confidence"><strong>${confidence}%</strong><span>confidence</span></div>
    </div>

    <div class="grid-2">
      <section class="result-block" aria-label="Ticket intake">
        <h3>Ticket intake</h3>
        ${kv([
          ["Requester", intake.requester_name],
          ["Email", intake.requester_email],
          ["Department", intake.department],
          ["Category", intake.category],
          ["Urgency", intake.urgency],
        ])}
        <p>${esc(intake.summary)}</p>
        ${tags(intake.entities)}
        ${tags(intake.missing_fields, "warn")}
        ${tags(intake.risk_flags, "bad")}
      </section>

      <section class="result-block" aria-label="Policy check">
        <h3>Policy check</h3>
        <p><strong>${esc(allowedText)}</strong> &middot; ${esc(policy.applicable_policy || "Internal policy")}</p>
        <p>${esc(policy.reasoning)}</p>
        ${tags(policy.controls_required, "ok")}
        ${tags(policy.missing_controls, "warn")}
        ${(policy.clause_citations || []).map((c) => `<div class="cite"><strong>${esc(c.clause)}</strong>${esc(c.quote)}</div>`).join("")}
      </section>
    </div>

    <section class="result-block" aria-label="Resolution draft">
      <h3>Resolution draft</h3>
      <p>${esc(res.employee_response)}</p>
      ${tags(res.system_actions)}
      ${tags(res.approvers, "warn")}
      <div class="actions">
        <button class="approve" id="approve" type="button">${icon("i-check")} Approve</button>
        <button id="reject" type="button">Reject</button>
      </div>
      <div id="final" class="final-output" aria-live="polite" hidden></div>
    </section>

    <section class="result-block" aria-label="Reusable SOP">
      <h3>Reusable SOP</h3>
      <p><strong>${esc(sop.title)}</strong></p>
      <p>${esc(sop.trigger)}</p>
      ${Array.isArray(sop.steps) && sop.steps.length ? `<ol>${sop.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      ${tags(sop.controls, "ok")}
    </section>

    <section class="result-block audit" aria-label="Audit trail">
      <h3>Audit trail</h3>
      ${(d.audit_log || []).map((a) => `<div>[${esc(a.timestamp)}] ${esc(a.agent)}: ${esc(a.summary)}</div>`).join("")}
    </section>
  `;
  $("#approve").onclick = () => finalize("approved");
  $("#reject").onclick = () => finalize("rejected");
}

async function finalize(decision) {
  const d = state.result;
  const final = $("#final");
  final.hidden = false;
  final.textContent = "Triggering downstream action...";
  const fin = await (await fetch("/api/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, intake: d.intake, policy: d.policy, resolution: d.resolution }),
  })).json();
  final.textContent = fin.error ? fin.error : `${fin.action}: ${fin.action_summary}`;
}

loadExamples();
