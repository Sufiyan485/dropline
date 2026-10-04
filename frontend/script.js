"use strict";
/* ============ Helpers (API layer lives in api.js) ============ */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RM = matchMedia("(prefers-reduced-motion:reduce)").matches;
const raf2 = f => requestAnimationFrame(() => requestAnimationFrame(f));
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

/* ============ Intro loader (once per visit) + background server wake-up ============ */
// The loader is a fixed intro shown once per browser session. It does not depend on the server:
// the server is woken in the background, and Run queues (meter sweeps) until it answers.
const INTRO_MS = 8000, INTRO_KEY = "dropline_intro";
const LOADING = 'Loading<span class="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';
let T0 = 0, serverUp = false, ready;
function setStatus(s, t) { const p = $("#status"); p.dataset.s = s; $("span", p).textContent = t; }
function showOverlay() { const w = $("#wake"); if (w.hidden) { w.hidden = false; $("#app").inert = true; } }
function hideOverlay() { $("#wake").hidden = true; $("#app").inert = false; }
function showLoading() { showOverlay(); $("#wt").innerHTML = LOADING; $("#wk-err").hidden = true; }
function showError(title, msg) { showOverlay(); $("#wt").textContent = title; $("#wk-em").textContent = msg; $("#wk-err").hidden = false; setStatus("off", "API offline"); }
function intro() {
  let seen = false;
  try { seen = sessionStorage.getItem(INTRO_KEY) === "1"; sessionStorage.setItem(INTRO_KEY, "1"); } catch { }
  if (seen) return;
  showLoading(); setTimeout(() => { if ($("#wk-err").hidden) hideOverlay(); }, INTRO_MS); // never hides an error screen
}

// Polls GET / until it answers. Cold-start responses usually lack CORS headers, so a failed fetch just means "not yet".
async function wakeLoop() {
  T0 = Date.now(); setStatus("wait", "Waking server"); serverUp = false; refreshRun();
  if (API.includes("YOUR-SERVICE")) { showError("API address not set", "Open api.js and replace YOUR-SERVICE.onrender.com with your Render URL."); return false; }
  while (Date.now() - T0 < 18e4) {
    try { await api.ping(); setStatus("on", "API online"); serverUp = true; refreshRun(); api.insights().catch(() => { }); return true; }
    catch (e) {
      $("#wk-d").textContent = `Trying ${API} · ${e.kind === "http" ? "HTTP " + e.status : "no response"}` + (API.startsWith("http://") ? " · is uvicorn running?" : "");
      await sleep(2500);
    }
  }
  showError("Couldn't reach the server", "The server didn't answer. It may be offline or still starting."); return false;
}
async function wake() {
  try { return await wakeLoop(); }
  catch (e) { console.error(e); showError("Couldn't connect", "Unexpected error: " + (e && e.message || e)); return false; }
}
$("#wk-retry").onclick = () => { showLoading(); ready = wake(); ready.then(ok => ok && hideOverlay()); };

/* ============ Predict form ============ */
const YN = ["Yes", "No"], NI = "No internet service";
const G = [
  ["Customer", [
    { k: "gender", l: "Gender", o: ["Male", "Female"] },
    { k: "senior_citizen", l: "Senior citizen", o: [["No", 0], ["Yes", 1]] },
    { k: "partner", l: "Partner", o: YN }, { k: "dependents", l: "Dependents", o: YN }]],
  ["Services", [
    { k: "phone_service", l: "Phone service", o: YN },
    { k: "multiple_lines", l: "Multiple lines", o: YN, dep: "phone_service", off: "No phone service" },
    { k: "internet_service", l: "Internet service", o: ["DSL", "Fiber optic", "No"] },
    ...[["online_security", "Online security"], ["online_backup", "Online backup"], ["device_protection", "Device protection"],
    ["tech_support", "Tech support"], ["streaming_tv", "Streaming TV"], ["streaming_movies", "Streaming movies"]]
      .map(([k, l]) => ({ k, l, o: YN, dep: "internet_service", off: NI }))]],
  ["Contract & billing", [
    { k: "contract", l: "Contract", o: ["Month-to-month", "One year", "Two year"] },
    { k: "paperless_billing", l: "Paperless billing", o: YN },
    { k: "payment_method", l: "Payment method", sel: ["Electronic check", "Mailed check", "Bank transfer (automatic)", "Credit card (automatic)"] }]],
  ["Charges", [
    { k: "tenure", l: "Tenure (months)", num: [0, 72, 1, 1], h: "Training data spans 0–72 months" },
    { k: "monthly_charges", l: "Monthly charges", num: [18, 120, .05, 1], h: "Training data spans 18–120" },
    { k: "total_charges", l: "Total charges", num: [0, 9000, .05, 0], h: "Estimated as tenure × monthly. Edit to override." }]],
];
const F = G.flatMap(g => g[1]);
const EX = {
  risky: { gender: "Female", senior_citizen: 0, partner: "No", dependents: "No", tenure: 3, phone_service: "Yes", multiple_lines: "No", internet_service: "Fiber optic", online_security: "No", online_backup: "No", device_protection: "No", tech_support: "No", streaming_tv: "Yes", streaming_movies: "Yes", contract: "Month-to-month", paperless_billing: "Yes", payment_method: "Electronic check", monthly_charges: 89.85, total_charges: 269.55 },
  loyal: { gender: "Male", senior_citizen: 0, partner: "Yes", dependents: "Yes", tenure: 60, phone_service: "Yes", multiple_lines: "Yes", internet_service: "DSL", online_security: "Yes", online_backup: "Yes", device_protection: "Yes", tech_support: "Yes", streaming_tv: "No", streaming_movies: "No", contract: "Two year", paperless_billing: "No", payment_method: "Credit card (automatic)", monthly_charges: 64.9, total_charges: 3894 },
};
const state = { ...EX.risky }; let auto = true, busy = false;

function field(d) {
  const w = el("fieldset", "f"); w.dataset.k = d.k; w.append(el("legend", "", d.l));
  if (d.sel) { const s = el("select"); s.name = d.k; d.sel.forEach(v => s.add(new Option(v, v))); w.append(s); }
  else if (d.num) {
    const [mn, mx, st, sl] = d.num, n = el("div", "num"), i = el("input"); i.type = "number"; i.name = d.k; i.min = mn; i.step = st; i.required = true; n.append(i);
    if (sl) { const r = el("input"); r.type = "range"; r.min = mn; r.max = mx; r.step = st; r.dataset.r = d.k; r.setAttribute("aria-label", d.l + " slider"); n.append(r); }
    w.append(n, el("small", "", d.h));
    if (!sl) { const b = el("button", "lnk", "use estimate"); b.type = "button"; b.id = "re"; b.onclick = () => { auto = true; sync(); }; $("small", w).append(" ", b); }
  } else {
    const s = el("div", "seg");
    d.o.forEach(o => { const [l, v] = Array.isArray(o) ? o : [o, o], lb = el("label"), i = el("input"); i.type = "radio"; i.name = d.k; i.value = v; lb.append(i, el("span", "", l)); s.append(lb); });
    w.append(s);
  }
  return w;
}
function buildForm() {
  const f = $("#form");
  G.forEach(([t, fs], gi) => { const g = el("section", "grp-wrap", `<h3><span class="mono">0${gi + 1}</span>${t}</h3>`), b = el("div", "grp"); g.style.setProperty("--i", gi); fs.forEach(d => b.append(field(d))); g.append(b); f.append(g); });
  const bt = el("button", "go", "<span>Run prediction</span>"); bt.type = "submit"; bt.id = "go"; f.append(bt);
  f.addEventListener("input", onInput); f.addEventListener("submit", onSubmit); sync();
}
// Mirrors the backend's validator: dependent services are locked to the "No … service" value, otherwise they can't use it.
function sync() {
  F.forEach(d => { if (d.dep) { const off = state[d.dep] === "No"; if (off) state[d.k] = d.off; else if (state[d.k] === d.off) state[d.k] = "No"; $(`[data-k=${d.k}]`).classList.toggle("off", off); } });
  if (auto) state.total_charges = +(state.tenure * state.monthly_charges || 0).toFixed(2);
  F.forEach(d => {
    const w = $(`[data-k=${d.k}]`); $$("input,select", w).forEach(i => {
      if (i.type === "radio") { i.checked = String(i.value) === String(state[d.k]); i.disabled = w.classList.contains("off"); }
      else if (i !== document.activeElement) i.value = state[d.k];
    });
  });
  $("#re").hidden = auto;
}
function onInput(e) {
  const i = e.target, k = i.name || i.dataset.r, d = F.find(x => x.k === k); if (!d) return;
  state[k] = d.num ? (i.value === "" ? "" : +i.value) : k === "senior_citizen" ? +i.value : i.value;
  if (k === "total_charges") auto = false;
  runId++; $("#wi").hidden = true; // inputs changed: what-if results would be stale
  sync(); clearErr();
}
$$("[data-ex]").forEach(b => b.onclick = () => { Object.assign(state, EX[b.dataset.ex]); auto = true; sync(); clearErr(); });

async function onSubmit(e) {
  e.preventDefault(); if (busy) return; busy = true; refreshRun(); clearErr();
  const sw = setTimeout(startSweep, 400); // warm requests finish before this and never flicker
  try {
    if (!serverUp && !(await ready)) throw { kind: "network" };
    let r; try { r = await api.predict(state); } catch (x) { if (x.kind !== "network" || !(ready = wake(), await ready)) throw x; r = await api.predict(state); }
    showResult(r);
  } catch (x) { stopSweep(true); showErr(x); }
  finally { clearTimeout(sw); busy = false; refreshRun(); }
}
// Run stays clickable while the server wakes: a click queues the prediction and it fires when the server answers.
function refreshRun() {
  $$(".go").forEach(b => {
    b.classList.toggle("busy", busy); b.disabled = busy;
    $("span", b).textContent = b.id === "go2" ? "Run" : busy && !serverUp ? "Waiting for server…" : !serverUp ? "Run when server is ready" : "Run prediction";
  });
}
function clearErr() { $("#err").hidden = true; $$(".f.bad").forEach(f => f.classList.remove("bad")); }
function showErr(x) {
  let m = "Something went wrong. Please try again.";
  if (x.kind === "network") m = `Can't reach the server at ${API}. It may be asleep or offline.`;
  else if (x.status === 422 && Array.isArray(x.data?.detail)) {
    m = x.data.detail.map(d => { const n = F.find(z => z.k === d.loc?.[1]); n && $(`[data-k=${n.k}]`).classList.add("bad"); const t = String(d.msg).replace(/^Value error, /, ""); return n ? `${n.l}: ${t}` : t; }).join(" · ");
  } else if (x.status) m = `Server error (${x.status}). Please try again.`;
  const e = $("#err"); e.textContent = m; e.hidden = false;
}

/* ============ Result gauge & context ============ */
const TK = 40, CX = 120, CY = 118;
function buildGauge() {
  let h = "";
  for (let i = 0; i < TK; i++) { const a = Math.PI * (1 - i / (TK - 1)), c = Math.cos(a), s = Math.sin(a); h += `<line class="tk" x1="${CX + c * 80}" y1="${CY - s * 80}" x2="${CX + c * 100}" y2="${CY - s * 100}"/>`; }
  $("#gauge").innerHTML = h + `<line class="cut" x1="${CX}" y1="${CY - 74}" x2="${CX}" y2="${CY - 112}"/><text x="${CX}" y="6" text-anchor="middle" fill="#8b96a6" font-size="10" font-family="JetBrains Mono,monospace">50% cut-off</text>`;
}
const IDLE = { v: $("#verdict").textContent, s: $("#vsub").textContent };
let cur = 0, animId = 0, sweeping = false, sweepRaf = 0;
const lit = v => { cur = v; $$(".tk").forEach((t, i) => t.classList.toggle("on", i < Math.round(v * TK))); };
function animateTo(p) { // glides from wherever the meter is now (idle, previous result or mid-sweep) to p
  const from = cur, pv = $("#pv"), t0 = performance.now(), D = RM ? 0 : 1200, my = ++animId;
  (function f(n) {
    if (my !== animId) return;
    const k = D ? Math.min(1, (n - t0) / D) : 1, e = 1 - Math.pow(1 - k, 3);
    lit(from + (p - from) * e); pv.textContent = (p * e * 100).toFixed(1) + "%"; if (k < 1) requestAnimationFrame(f);
  })(t0);
}
function revealResult() { // keep the meter in view, scrolling only when its top isn't already visible
  const top = $("#result").getBoundingClientRect().top;
  if (top < 80 || top > innerHeight * .6) $("#result").scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "start" });
}
// While the request is slow (server waking), the meter swings back and forth instead of showing a spinner.
function startSweep() {
  if (sweeping) return; sweeping = true; animId++;
  $("#result").dataset.v = "wait"; $("#pv").textContent = "…"; $("#verdict").textContent = "Waiting for the server…";
  $("#vsub").textContent = "Your prediction runs as soon as it answers."; $("#wi").hidden = true; $("#ctx").hidden = true; revealResult();
  if (RM) { lit(0); return; }
  const t0 = performance.now(), ph0 = Math.acos(1 - 2 * Math.min(1, Math.max(0, cur))); // start from the current position, no jump
  (function f(n) { if (!sweeping) return; lit((1 - Math.cos(ph0 + (n - t0) / 1800 * 2 * Math.PI)) / 2); sweepRaf = requestAnimationFrame(f); })(t0);
}
function stopSweep(reset) {
  const was = sweeping; sweeping = false; cancelAnimationFrame(sweepRaf);
  if (was && reset) { animId++; lit(0); delete $("#result").dataset.v; $("#pv").textContent = "—"; $("#verdict").textContent = IDLE.v; $("#vsub").textContent = IDLE.s; }
}
function showResult(r) {
  stopSweep(false);
  const churn = r.churn_prediction === 1;
  $("#result").dataset.v = churn ? "bad" : "ok";
  $("#verdict").textContent = churn ? "Likely to churn" : "Likely to stay";
  $("#vsub").textContent = `Model output: “${r.churn_result}”. The ${churn ? "probability is above" : "probability is below"} the 50% decision line.`;
  animateTo(r.churn_probability);
  // Sequence: meter -> what-if rows (staggered) -> training-data context
  $("#wi").hidden = true; $("#ctx").hidden = true;
  const id = ++runId, reveal = sleep(RM ? 0 : 1300); setDock(r, churn);
  Promise.all([whatIf(r, id, reveal), api.insights().catch(() => null)])
    .then(([, d]) => { if (id === runId && d) renderCtx(d); });
  revealResult();
}
const tenureIdx = t => t > 72 ? -1 : Math.max(0, Math.ceil(t / 12) - 1);
const chargeIdx = (m, E = [18, 40, 60, 80, 100, 120]) => m < 18 || m > 120 ? -1 : Math.max(0, E.findIndex((e, i) => i && m <= e) - 1);
function renderCtx(d) {
  const seg = (o, i, p) => { const k = Object.keys(o)[i]; return k ? [`${p}: ${k}`, o[k]] : null; };
  const rows = [
    [`Contract: ${state.contract}`, d.churn_by_contract[state.contract]],
    [`Internet: ${state.internet_service === "No" ? "none" : state.internet_service}`, d.churn_by_internet_service[state.internet_service]],
    [`Payment: ${state.payment_method}`, d.churn_by_payment_method[state.payment_method]],
    seg(d.churn_by_tenure, tenureIdx(state.tenure), "Tenure"), seg(d.churn_by_monthly_charges, chargeIdx(state.monthly_charges), "Monthly"),
  ].filter(r => r && r[1] != null);
  $("#ctx").hidden = false; bars($("#ctx-rows"), rows, d.churn_rate);
}

/* ============ Charts ============ */
function bars(c, rows, avg) {
  c.innerHTML = ""; const mx = Math.max(...rows.map(r => r[1]), avg || 0) * 1.1;
  rows.forEach(([l, v]) => {
    const r = el("div", "row", `<span></span><div class="bar"><b></b></div><span class="mono"></span>`);
    r.children[0].textContent = l; r.children[2].textContent = v.toFixed(1) + "%";
    if (avg != null) { $(".bar", r).style.setProperty("--avg", avg / mx * 100 + "%"); if (v > avg) r.classList.add("hi"); }
    c.append(r); raf2(() => $("b", r).style.width = v / mx * 100 + "%");
  });
}
function cols(c, o) {
  c.className = "cols"; c.innerHTML = ""; const e = Object.entries(o), mx = Math.max(...e.map(x => x[1]));
  e.forEach(([k, v]) => {
    const d = el("div", "col" + (v === mx ? " top" : ""), `<em class="mono"></em><b></b><small></small>`);
    d.children[0].textContent = v.toFixed(0) + "%"; d.children[2].textContent = k.replace(" months", ""); c.append(d); raf2(() => d.children[1].style.height = v / mx * 140 + "px");
  });
}
function count(e, n, dec = 0, suf = "") {
  const t0 = performance.now(), D = RM ? 0 : 1000;
  (function f(now) { const k = D ? Math.min(1, (now - t0) / D) : 1; e.textContent = (n * (1 - Math.pow(1 - k, 3))).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; if (k < 1) requestAnimationFrame(f); })(t0);
}
function failBox(v, retry) {
  v.innerHTML = `<div class="card empty"><h2>Couldn't load this</h2><p class="mut">The API didn't respond. Check that it's running, then retry.</p><button class="lnk" type="button">Retry</button></div>`;
  $("button", v).onclick = retry;
}

/* ============ Dataset & Model views ============ */
async function loadDataset() {
  const v = $("#dataset"); v.innerHTML = `<div class="card sk"></div>`;
  try {
    await ready; const d = await api.insights();
    const pm = Object.entries(d.churn_by_payment_method).sort((a, b) => b[1] - a[1]), hi = pm[0], lo = pm.at(-1);
    v.innerHTML = `<div class="intro"><h1>What the data says</h1><p class="mut">Churn patterns across the training dataset.</p></div>
      <div class="note"></div>
      <div class="kpis"><div class="kpi"><span class="mut">Customers</span><span class="mono" id="k1"></span></div><div class="kpi"><span class="mut">Churned</span><span class="mono" id="k2"></span></div><div class="kpi"><span class="mut">Churn rate</span><span class="mono bad" id="k3"></span></div></div>
      <div class="charts"><div class="card"><h3>By contract</h3><div id="c1"></div></div><div class="card"><h3>By internet service</h3><div id="c2"></div></div><div class="card"><h3>By payment method</h3><div id="c3"></div></div>
      <div class="card"><h3>By tenure (months)</h3><div id="c4"></div></div><div class="card"><h3>By monthly charges</h3><div id="c5"></div></div></div>
      <p class="mut sm">Bars: churn rate per segment · white line = dataset average (${d.churn_rate}%) · columns: share of customers who churned.</p>`;
    $(".note", v).textContent = `${hi[0]} customers churn at ${hi[1]}% — ${(hi[1] / lo[1]).toFixed(1)}× the rate of ${lo[0]} (${lo[1]}%).`;
    count($("#k1"), d.total_customers); count($("#k2"), d.churned_customers); count($("#k3"), d.churn_rate, 2, "%");
    const E = o => Object.entries(o);
    bars($("#c1"), E(d.churn_by_contract), d.churn_rate); bars($("#c2"), E(d.churn_by_internet_service), d.churn_rate); bars($("#c3"), E(d.churn_by_payment_method), d.churn_rate);
    cols($("#c4"), d.churn_by_tenure); cols($("#c5"), d.churn_by_monthly_charges);
  } catch { done.dataset = 0; failBox(v, () => route(true)); }
}
async function loadModel() {
  const v = $("#model"); v.innerHTML = `<div class="card sk"></div>`;
  try {
    await ready; const d = await api.model(), c = d.confusion_matrix, pos = c.true_positive + c.false_negative, flag = c.true_positive + c.false_positive;
    const pct = x => +(x * 100).toFixed(1) + "%";
    v.innerHTML = `<div class="intro"><h1>How the model performs</h1><p class="mut">Evaluation on held-out customers (${pos + flag - c.true_positive + c.true_negative}).</p></div>
      <div class="note"></div>
      <div class="kpis">${[["Accuracy", pct(d.accuracy)], ["Precision", pct(d.precision)], ["Recall", pct(d.recall)], ["F1 score", pct(d.f1_score)], ["ROC AUC", pct(d.roc_auc)]].map(([a, b]) => `<div class="kpi"><span class="mut">${a}</span><span class="mono">${b}</span></div>`).join("")}</div>
      <div class="charts"><div class="card"><h3>Confusion matrix</h3><div class="mx"><div class="h"></div><div class="h">Predicted stay</div><div class="h">Predicted churn</div>
      <div class="h">Actually stayed</div><div class="g"><span class="mono">${c.true_negative}</span>correct</div><div class="r"><span class="mono">${c.false_positive}</span>false alarm</div>
      <div class="h">Actually churned</div><div class="r"><span class="mono">${c.false_negative}</span>missed</div><div class="g"><span class="mono">${c.true_positive}</span>caught</div></div></div>
      <div class="card"><h3>Top drivers (model-wide)</h3><div id="fi"></div><p class="mut sm">Share of the model's total feature importance. This describes the model overall, not why one customer was scored.</p></div></div>`;
    $(".note", v).textContent = `Tuned to catch leavers: it flags ${(c.true_positive / pos * 100).toFixed(0)}% of customers who actually churn, but about ${(c.false_positive / flag * 100).toFixed(0)}% of its alerts are false alarms.`;
    bars($("#fi"), d.feature_importance.map(f => [f.feature.replace(/^\w+?__/, "").replace("_", ": "), f.importance * 100]));
  } catch { done.model = 0; failBox(v, () => route(true)); }
}

/* ============ What-if scenarios ============ */
let runId = 0;
const SCEN = s => {
  const o = [];
  if (s.contract === "Month-to-month") o.push(["Switch to a one-year contract", { contract: "One year" }]);
  if (s.contract !== "Two year") o.push(["Switch to a two-year contract", { contract: "Two year" }]);
  if (/check/.test(s.payment_method)) o.push(["Pay by card autopay", { payment_method: "Credit card (automatic)" }]);
  if (s.internet_service !== "No") {
    if (s.online_security === "No") o.push(["Add online security", { online_security: "Yes" }]);
    if (s.tech_support === "No") o.push(["Add tech support", { tech_support: "Yes" }]);
  }
  return o;
};
// Re-scores the same profile with one change each, using the real /predict endpoint.
// Requests start immediately, but the panel is revealed only after `reveal` (the meter animation) finishes.
async function whatIf(base, id, reveal) {
  const sc = SCEN(state), box = $("#wi"), rows = $("#wi-rows"), snap = { ...state };
  box.hidden = true; if (!sc.length) return;
  const calls = Promise.allSettled(sc.map(([, p]) => api.predict({ ...snap, ...p })));
  let settled = false; calls.then(() => settled = true);
  await reveal; if (id !== runId) return;
  if (!settled) { box.hidden = false; rows.innerHTML = `<p class="mut sm">Scoring options…</p>`; }
  const res = (await calls).map((r, i) => r.status === "fulfilled" ? { l: sc[i][0], p: sc[i][1], r: r.value } : null).filter(Boolean);
  if (id !== runId) return; // a newer prediction or an edit superseded this run
  if (!res.length) { box.hidden = true; return; }
  res.sort((a, b) => a.r.churn_probability - b.r.churn_probability); rows.innerHTML = ""; box.hidden = false;
  const top = res.slice(0, 3); // show only the 3 strongest options
  top.forEach((x, i) => {
    const b = base.churn_probability * 100, n = x.r.churn_probability * 100, d = n - b, flip = x.r.churn_prediction !== base.churn_prediction;
    const btn = el("button", "wr", `<span><strong></strong><br><small class="mono"></small></span><span class="d mono"></span>`); btn.type = "button"; btn.style.setProperty("--i", i);
    $("strong", btn).textContent = x.l;
    $("small", btn).textContent = `${b.toFixed(1)}% → ${n.toFixed(1)}%` + (flip ? ` · now “${x.r.churn_result}”` : "");
    const dd = $(".d", btn); dd.textContent = (d < 0 ? "▼ " : d > 0 ? "▲ " : "— ") + Math.abs(d).toFixed(1) + " pts"; dd.classList.add(d <= 0 ? "dn" : "up");
    btn.onclick = () => { Object.assign(state, x.p); sync(); $("#form").requestSubmit(); };
    rows.append(btn);
  });
  await sleep(RM ? 0 : 150 * top.length + 300); // let the rows finish arriving before the next section
}

/* ============ Mobile dock: latest result + Run button, shown while the result card is off-screen ============ */
const dock = $("#dock"), mq = matchMedia("(max-width:900px)"); let inView = false;
function dockSync() { dock.hidden = !(mq.matches && !$("#predict").hidden && !inView); }
function setDock(r, churn) {
  dock.dataset.v = churn ? "bad" : "ok";
  $("#chip b").textContent = (r.churn_probability * 100).toFixed(1) + "%";
  $("#chip small").textContent = (churn ? "Likely to churn" : "Likely to stay") + " · tap to view";
}
new IntersectionObserver(([e]) => { inView = e.isIntersecting; dockSync(); }).observe($("#result"));
mq.addEventListener("change", dockSync);
$("#chip").onclick = () => $("#result").scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "start" });
$("#go2").onclick = () => $("#form").requestSubmit();

/* ============ Routing ============ */
const done = {}, loaders = { dataset: loadDataset, model: loadModel };
function route(force) {
  const h = (location.hash || "#predict").slice(1), id = ["predict", "dataset", "model"].includes(h) ? h : "predict";
  $$(".view").forEach(v => v.hidden = v.id !== id);
  $$("#tabs a").forEach(a => a.toggleAttribute("aria-current", a.hash === "#" + id));
  if (loaders[id] && (force || !done[id])) { done[id] = 1; loaders[id](); }
  if (!force) scrollTo(0, 0);
  dockSync();
}
addEventListener("hashchange", () => route());

buildForm(); buildGauge(); intro(); ready = wake(); route();