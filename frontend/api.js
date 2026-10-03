"use strict";
/* ============ Config & API layer (loaded before script.js) ============ */
// Local dev talks to uvicorn; anywhere else uses your Render URL (edit this one line after deploying).
const API = ["", "localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:8000"
  : "https://YOUR-SERVICE.onrender.com";

async function req(path, opt = {}, ms = 20000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(API + path, { ...opt, signal: c.signal });
    let d = null; try { d = await r.json(); } catch {}
    if (!r.ok) throw { kind: "http", status: r.status, data: d };
    return d;
  } catch (e) { throw e.kind ? e : { kind: "network" }; }
  finally { clearTimeout(t); }
}
const memo = {};
const cached = (k, p) => memo[k] ??= req(p).catch(e => { delete memo[k]; throw e; });
const api = {
  ping: () => req("/", {}, 8000),
  predict: b => req("/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }, 30000),
  insights: () => cached("i", "/insights"),
  model: () => cached("m", "/model-insights"),
};