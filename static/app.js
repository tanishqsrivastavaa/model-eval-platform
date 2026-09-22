"use strict";

// ---------- helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}
const fmtNum = (n) => (n == null ? "—" : n.toLocaleString());
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
const ago = (ts) => {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body));
  return body;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const PRESETS = [
  ["Fibonacci via Python", "Use run_python to compute the 35th Fibonacci number, then double-check the answer's last three digits with the calculator. Report the result."],
  ["Parallel math", "Compute these three independently with the calculator, calling the tool for all three in parallel if you can: 2**64, 123456*654321, (17**5) % 1000."],
  ["Write → read → analyze", "Create people.csv with 12 made-up people (name, age, city). Then read it back and use Python to compute the average age per city. Report the table."],
  ["Web fetch + summarize", "Fetch https://example.com and https://httpbin.org/json, then summarize what each contains in two sentences each."],
  ["Write, run, fix", "Write a Python script primes.py that prints all primes below 100, run it, and fix it if the output is wrong. Show the final output."],
  ["No tools needed", "In three sentences, explain why the sky is blue. Do not use any tools."],
];

// ---------- run state (built purely from events, so live and replay are identical) ----------
let S = null;
let es = null;
let dirty = false;

function newState(run) {
  return {
    run, events: [], lastSeq: 0, lastT: 0, lastRecv: 0, live: run.status === "running",
    calls: new Map(), tools: new Map(), order: [], errors: [], finished: null, started: null,
    ver: 0,
  };
}

function now() {
  if (!S) return 0;
  return S.live ? S.lastT + (performance.now() - S.lastRecv) : S.lastT;
}

function phase(c, kind, t) {
  if (c.segs.at(-1).kind !== kind) c.segs.push({ kind, from: t });
}

function reduce(ev) {
  if (ev.seq <= S.lastSeq) return; // EventSource reconnects replay from the start
  S.lastSeq = ev.seq;
  S.events.push(ev);
  S.lastT = ev.t_ms;
  S.lastRecv = performance.now();
  S.ver++;
  const d = ev.data;
  const c = S.calls.get(d.call);
  if (c) c.ver++;
  switch (ev.type) {
    case "run_started": S.started = d; break;
    case "llm_call_started":
      S.calls.set(d.call, {
        n: d.call, start: ev.t_ms, request: d.request, reasoning: "", content: "",
        tcs: new Map(), segs: [{ kind: "wait", from: ev.t_ms }], done: null, ver: 1,
      });
      S.order.push({ kind: "llm", key: d.call });
      break;
    case "llm_headers": c.headers = d.ms; break;
    case "llm_first_token": c.ttft = d.ttft_ms; break;
    case "reasoning_delta": c.reasoning += d.text; phase(c, "think", ev.t_ms); break;
    case "content_delta": c.content += d.text; phase(c, "text", ev.t_ms); break;
    case "tool_call_detected": c.tcs.set(d.index, { id: d.id, name: d.name, args: "" }); phase(c, "args", ev.t_ms); break;
    case "tool_args_delta": {
      const tc = c.tcs.get(d.index) ?? c.tcs.set(d.index, { id: null, name: "?", args: "" }).get(d.index);
      tc.args += d.text;
      phase(c, "args", ev.t_ms);
      break;
    }
    case "llm_call_finished": c.done = d; c.end = d.end_ms; break;
    case "tool_started": {
      const key = `${d.call}:${d.id}`;
      S.tools.set(key, { key, ...d, start: ev.t_ms, end: null, ver: 1 });
      S.order.push({ kind: "tool", key });
      break;
    }
    case "tool_finished": {
      const t = S.tools.get(`${d.call}:${d.id}`);
      if (t) { Object.assign(t, { end: d.end_ms, ok: d.ok, result: d.result, duration_ms: d.duration_ms }); t.ver++; }
      break;
    }
    case "error": S.errors.push(d.message); break;
    case "run_finished": S.finished = d; S.live = false; break;
  }
}

// ---------- opening a run ----------
async function openRun(id) {
  if (es) es.close();
  let run;
  try { run = await api(`/api/runs/${id}`); } catch { return; }
  S = newState(run);
  cardEls.clear();
  ctxRendered = -1;
  $("#tab-trace").replaceChildren();
  $("#tab-context").replaceChildren();
  $("#events-body").replaceChildren();
  $("#empty").hidden = true;
  $("#run-view").hidden = false;
  $("#rv-model").textContent = run.model;
  $("#rv-provider").textContent = `via ${run.provider}`;
  $("#rv-prompt").textContent = run.prompt;
  history.replaceState(null, "", `#${id}`);
  markActiveHistory();

  const mine = S;
  es = new EventSource(`/api/runs/${id}/stream`);
  es.onmessage = (msg) => {
    if (S !== mine) return;
    const ev = JSON.parse(msg.data);
    if (ev.type === "stream_end") { S.live = false; es.close(); dirty = true; return; }
    reduce(ev);
    dirty = true;
    if (ev.type === "run_finished") { es.close(); loadHistory(); }
  };
  es.onerror = () => { if (S !== mine || !S.live) es.close(); };
  dirty = true;
}

// ---------- rendering ----------
function render() {
  const status = S.finished?.status ?? (S.live ? "running" : S.run.status);
  const pill = $("#rv-status");
  pill.textContent = status;
  pill.className = `pill ${status}`;
  $("#cancel-btn").hidden = !S.live;
  renderStats();
  renderTimeline();
  renderTrace();
  if (!$("#tab-context").hidden) renderContext();
  if (!$("#tab-events").hidden) renderEvents();
}

function stat(k, v, s) {
  return h("div", { class: "stat" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), s ? h("div", { class: "s" }, s) : null);
}

function renderStats() {
  const t = now();
  const calls = [...S.calls.values()];
  const tools = [...S.tools.values()];
  const tot = S.finished?.totals;
  const llmMs = tot?.llm_ms ?? calls.reduce((a, c) => a + ((c.end ?? t) - c.start), 0);
  const toolMs = tot?.tool_ms ?? tools.reduce((a, x) => a + ((x.end ?? t) - x.start), 0);
  const wall = tot?.wall_ms ?? t;
  const pct = (x) => (wall ? `${Math.round((100 * x) / wall)}% of wall` : "");
  const usage = calls.map((c) => c.done?.usage ?? {});
  const sum = (f) => usage.reduce((a, u) => a + (f(u) ?? 0), 0);
  const tps = calls.map((c) => c.done?.tokens_per_s).filter(Boolean);
  const errs = tools.filter((x) => x.end != null && !x.ok).length;
  const reasoningTok = sum((u) => u.completion_tokens_details?.reasoning_tokens);
  const cost = tot?.cost ?? (sum((u) => u.cost) || null);
  const ttft = calls[0]?.ttft;

  $("#stats").replaceChildren(
    stat("Wall time", fmtMs(wall)),
    stat("LLM time", fmtMs(llmMs), pct(llmMs)),
    stat("Tool time", fmtMs(toolMs), pct(toolMs)),
    stat("Overhead", fmtMs(tot ? tot.overhead_ms : null), "harness + gaps"),
    stat("First TTFT", fmtMs(ttft), calls[0]?.headers != null ? `headers at ${fmtMs(calls[0].headers)}` : ""),
    stat("Avg speed", tps.length ? `${Math.round(tps.reduce((a, b) => a + b) / tps.length)} tok/s` : "—", "after first token"),
    stat("Turns", fmtNum(calls.length), `${tools.length} tool calls${errs ? `, ${errs} failed` : ""}`),
    stat("Tokens in", fmtNum(sum((u) => u.prompt_tokens) || null), sum((u) => u.prompt_tokens_details?.cached_tokens) ? `${fmtNum(sum((u) => u.prompt_tokens_details?.cached_tokens))} cached` : "summed over turns"),
    stat("Tokens out", fmtNum(sum((u) => u.completion_tokens) || null), reasoningTok ? `${fmtNum(reasoningTok)} reasoning` : ""),
    cost ? stat("Cost", `$${cost.toFixed(cost < 0.01 ? 5 : 3)}`) : null,
  );
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}

function renderTimeline() {
  const t = now();
  const total = Math.max(t, 1) * 1.02;
  const pos = (ms) => `${(100 * ms) / total}%`;
  const step = niceStep(total / 6);
  const axis = h("div", { class: "tl-track" });
  for (let x = 0; x <= total; x += step) axis.append(h("span", { style: `left:${pos(x)}` }, fmtMs(x)));

  const rows = [h("div", { class: "tl-axis" }, h("div"), axis)];
  for (const item of S.order) {
    const track = h("div", { class: "tl-track" });
    let label;
    if (item.kind === "llm") {
      const c = S.calls.get(item.key);
      const end = c.end ?? t;
      const bar = h("div", { class: `bar${c.end == null ? " live" : ""}`, style: `left:${pos(c.start)};width:${pos(end - c.start)}` });
      c.segs.forEach((s, i) => {
        const segEnd = c.segs[i + 1]?.from ?? end;
        const w = end > c.start ? (100 * (segEnd - s.from)) / (end - c.start) : 0;
        bar.append(h("div", { class: `seg ${{ wait: "wait", think: "think", text: "text", args: "args" }[s.kind]}`, style: `width:${w}%` }));
      });
      track.append(bar);
      label = h("div", { class: "tl-label" }, `LLM #${c.n}`);
    } else {
      const x = S.tools.get(item.key);
      const end = x.end ?? t;
      const cls = x.end == null ? "tool live" : x.ok ? "tool" : "fail";
      track.append(h("div", { class: `bar ${cls}`, style: `left:${pos(x.start)};width:${pos(end - x.start)}` }));
      label = h("div", { class: "tl-label tool" }, `↳ ${x.name}`);
    }
    rows.push(h("div", { class: "tl-row", "data-kind": item.kind, "data-key": item.key }, label, track));
  }
  const tl = $("#timeline");
  tl.replaceChildren(...rows);
  if (S.live) {
    const overlay = h("div", { style: "position:absolute;inset:0 0 0 150px;pointer-events:none" }, h("div", { class: "tl-now", style: `left:${pos(t)}` }));
    tl.append(overlay);
  }
}

function tooltipText(kind, key) {
  if (kind === "llm") {
    const c = S.calls.get(Number(key));
    if (!c) return "";
    const d = c.done;
    const end = c.end ?? now();
    const lines = [`LLM call #${c.n}`, `start       ${fmtMs(c.start)}`, `duration    ${fmtMs(end - c.start)}`,
      `headers     ${fmtMs(c.headers)}`, `TTFT        ${fmtMs(c.ttft)}`];
    const spans = {};
    c.segs.forEach((s, i) => { spans[s.kind] = (spans[s.kind] ?? 0) + ((c.segs[i + 1]?.from ?? end) - s.from); });
    for (const [k, v] of Object.entries(spans)) lines.push(`  ${k.padEnd(10)}${fmtMs(v)}`);
    if (d) {
      lines.push(`tokens      ${d.usage?.prompt_tokens ?? "?"} in / ${d.usage?.completion_tokens ?? "?"} out`);
      if (d.tokens_per_s) lines.push(`speed       ${d.tokens_per_s} tok/s`);
      lines.push(`chunks      ${d.chunks}`, `finish      ${d.finish_reason ?? "—"}`);
    }
    return lines.join("\n");
  }
  const x = S.tools.get(key);
  if (!x) return "";
  return [`tool ${x.name}`, `start       ${fmtMs(x.start)}`, `duration    ${fmtMs((x.end ?? now()) - x.start)}`,
    `status      ${x.end == null ? "running" : x.ok ? "ok" : "error"}`].join("\n");
}

// Cards are created once and then patched, so streaming text never resets open <details>.
const cardEls = new Map();

function llmCard(c) {
  const els = {
    title: h("span", { class: "card-title" }, `LLM call #${c.n}`),
    meta: h("span", { class: "card-meta" }),
    thinkWrap: h("details", { open: true, hidden: true }, h("summary", {}, "thinking"), null),
    think: h("pre", { class: "block think" }),
    textWrap: h("div", { hidden: true }, h("div", { class: "sect-label" }, "text output")),
    text: h("div", { class: "text-out" }),
    callsWrap: h("div", { hidden: true }, h("div", { class: "sect-label" }, "tool calls requested")),
    calls: h("div", { style: "display:flex;flex-direction:column;gap:6px" }),
    waiting: h("div", { class: "muted mono" }, "waiting for first token…"),
  };
  els.thinkWrap.append(els.think);
  els.textWrap.append(els.text);
  els.callsWrap.append(els.calls);
  els.root = h("div", { class: "card", id: `card-llm-${c.n}` },
    h("div", { class: "card-head" }, els.title, els.meta),
    h("div", { class: "card-body" }, els.waiting, els.thinkWrap, els.textWrap, els.callsWrap));
  return els;
}

function patchLlmCard(els, c) {
  const d = c.done;
  const t = now();
  const meta = [
    ["took", fmtMs((c.end ?? t) - c.start)],
    ["TTFT", fmtMs(c.ttft)],
    d?.tokens_per_s ? ["speed", `${d.tokens_per_s} tok/s`] : null,
    d?.usage?.prompt_tokens != null ? ["tokens", `${d.usage.prompt_tokens}→${d.usage.completion_tokens}`] : null,
    d ? ["finish", d.finish_reason ?? "—"] : ["", "streaming…"],
  ].filter(Boolean);
  els.meta.replaceChildren(...meta.map(([k, v]) => h("span", {}, k ? `${k} ` : "", h("b", {}, v))));
  const streaming = !d;
  els.waiting.hidden = c.ttft != null || !streaming;
  if (!streaming && c.ttft == null) { els.waiting.hidden = false; els.waiting.textContent = "(empty response)"; }
  els.thinkWrap.hidden = !c.reasoning;
  if (els.think.textContent.length !== c.reasoning.length) els.think.textContent = c.reasoning;
  els.textWrap.hidden = !c.content;
  if (els.text.textContent.length !== c.content.length) els.text.textContent = c.content;
  const lastSeg = c.segs.at(-1).kind;
  els.think.classList.toggle("cursor", streaming && lastSeg === "think");
  els.text.classList.toggle("cursor", streaming && lastSeg === "text");
  els.callsWrap.hidden = c.tcs.size === 0;
  if (c.tcs.size) {
    els.calls.replaceChildren(...[...c.tcs.values()].map((tc) =>
      h("div", { class: `call-chip${streaming ? " cursor" : ""}` }, `${tc.name}(${streaming ? tc.args : pretty(tc.args)})`)));
  }
}

function toolCard(x) {
  const els = {
    meta: h("span", { class: "card-meta" }),
    args: h("pre", { class: "block" }, x.args != null ? JSON.stringify(x.args, null, 2) : x.raw_args),
    result: h("pre", { class: "block" }, ""),
  };
  els.root = h("div", { class: "card tool", id: `card-tool-${x.key}` },
    h("div", { class: "card-head" }, h("span", { class: "card-title" }, `⚙ ${x.name}`), els.meta),
    h("div", { class: "card-body" },
      h("div", {}, h("div", { class: "sect-label" }, "arguments"), els.args),
      h("div", {}, h("div", { class: "sect-label" }, "result"), els.result)));
  return els;
}

function patchToolCard(els, x) {
  const running = x.end == null;
  els.meta.replaceChildren(
    h("span", {}, "took ", h("b", {}, fmtMs((x.end ?? now()) - x.start))),
    h("span", {}, "status ", h("b", {}, running ? "running…" : x.ok ? "ok" : "error")),
    h("span", {}, "at ", h("b", {}, fmtMs(x.start))),
  );
  els.root.classList.toggle("fail", !running && !x.ok);
  if (!running && els.result.textContent !== x.result) els.result.textContent = x.result;
  els.result.classList.toggle("cursor", running);
}

function renderTrace() {
  const trace = $("#tab-trace");
  let grew = false;
  for (const item of S.order) {
    const id = `${item.kind}:${item.key}`;
    const obj = item.kind === "llm" ? S.calls.get(item.key) : S.tools.get(item.key);
    let entry = cardEls.get(id);
    if (!entry) {
      entry = { els: item.kind === "llm" ? llmCard(obj) : toolCard(obj), ver: -1 };
      cardEls.set(id, entry);
      trace.append(entry.els.root);
      grew = true;
    }
    const isLive = (item.kind === "llm" ? obj.done == null : obj.end == null) && S.live;
    if (entry.ver !== obj.ver || isLive) {
      if (entry.ver !== obj.ver) grew = true;
      (item.kind === "llm" ? patchLlmCard : patchToolCard)(entry.els, obj);
      entry.ver = obj.ver;
    }
  }
  for (const [i, msg] of S.errors.entries()) {
    if (cardEls.has(`err:${i}`)) continue;
    const root = h("div", { class: "card err" }, h("div", { class: "card-head" }, h("span", { class: "card-title" }, "error")),
      h("div", { class: "card-body" }, h("pre", { class: "block" }, msg)));
    cardEls.set(`err:${i}`, { els: { root } });
    trace.append(root);
    grew = true;
  }
  if (S.finished && !cardEls.has("final")) {
    const f = S.finished;
    const body = f.final_answer
      ? h("div", { class: "text-out" }, f.final_answer)
      : h("div", { class: "muted" }, { max_turns: "Stopped: hit the max-turns limit.", cancelled: "Cancelled.", error: "Run failed; see error above." }[f.status] ?? f.status);
    const root = h("div", { class: "card final" },
      h("div", { class: "card-head" }, h("span", { class: "card-title" }, "final answer"),
        h("span", { class: "card-meta" }, h("span", {}, "status ", h("b", {}, f.status)), h("span", {}, "wall ", h("b", {}, fmtMs(f.totals.wall_ms))))),
      h("div", { class: "card-body" }, body));
    cardEls.set("final", { els: { root } });
    trace.append(root);
    grew = true;
  }
  if (grew && S.live && $("#follow").checked && !$("#tab-trace").hidden) {
    const main = $("#main");
    main.scrollTop = main.scrollHeight;
  }
}

let ctxRendered = -1;
function renderContext() {
  const done = [...S.calls.values()];
  const key = done.length * 1000 + (S.finished ? 1 : 0);
  if (key === ctxRendered) return;
  ctxRendered = key;
  let prevLen = 0;
  const out = done.map((c) => {
    const { messages = [], ...rest } = c.request ?? {};
    const toolNames = (rest.tools ?? []).map((t) => t.function?.name);
    delete rest.tools;
    const msgs = messages.map((m, i) => {
      let body = m.content ?? "";
      if (m.tool_calls) body += (body ? "\n" : "") + m.tool_calls.map((tc) => `→ ${tc.function.name}(${tc.function.arguments})`).join("\n");
      const role = m.role + (m.tool_call_id ? `\n${m.tool_call_id}` : "");
      return h("div", { class: "ctx-msg" }, h("div", { class: `ctx-role${i >= prevLen ? " new" : ""}` }, role), h("pre", {}, body));
    });
    const chars = JSON.stringify(messages).length;
    const tokIn = c.done?.usage?.prompt_tokens;
    prevLen = messages.length;
    return h("div", { class: "card" },
      h("div", { class: "card-head" }, h("span", { class: "card-title" }, `Request #${c.n}`),
        h("span", { class: "card-meta" },
          h("span", {}, "messages ", h("b", {}, messages.length)),
          h("span", {}, "size ", h("b", {}, `${fmtNum(chars)} chars`)),
          tokIn != null ? h("span", {}, "prompt tokens ", h("b", {}, fmtNum(tokIn))) : null,
          h("span", {}, "tools ", h("b", {}, toolNames.length)))),
      h("div", { class: "card-body" },
        h("details", {}, h("summary", {}, "request parameters"), h("pre", { class: "block" }, JSON.stringify(rest, null, 2))),
        h("div", {}, ...msgs)));
  });
  $("#tab-context").replaceChildren(
    h("p", { class: "muted" }, "Every turn re-sends the entire conversation. Highlighted roles are new since the previous request."),
    ...out);
}

function renderEvents() {
  const body = $("#events-body");
  for (let i = body.children.length; i < S.events.length; i++) {
    const ev = S.events[i];
    let preview = JSON.stringify(ev.data);
    if (preview.length > 240) preview = preview.slice(0, 240) + "…";
    body.append(h("tr", {}, h("td", {}, ev.seq), h("td", {}, ev.t_ms.toFixed(1)), h("td", {}, ev.type), h("td", {}, preview)));
  }
}

// ---------- sidebar ----------
let meta = null;

async function loadHistory() {
  let runs = [];
  try { runs = await api("/api/runs"); } catch { return; }
  $("#history").replaceChildren(...runs.map((r) =>
    h("li", { "data-id": r.id, onclick: () => openRun(r.id), title: r.prompt },
      h("span", { class: `dot ${r.status}` }),
      h("div", { style: "min-width:0" }, h("div", { class: "h-model" }, r.model), h("div", { class: "h-prompt" }, r.prompt)),
      h("span", { class: "h-time" }, r.summary ? fmtMs(r.summary.wall_ms) : ago(r.created_at)))));
  if (!runs.length) $("#history").append(h("li", { class: "muted", style: "cursor:default" }, "No runs yet."));
  markActiveHistory();
}

function markActiveHistory() {
  for (const li of $("#history").children) li.classList.toggle("active", li.dataset.id === S?.run.id);
}

async function loadModels(provider) {
  const model = $("#model");
  model.value = store.get(`model:${provider}`) ?? "";
  $("#model-list").replaceChildren();
  $("#model-hint").textContent = "loading models…";
  try {
    const ids = await api(`/api/models?provider=${encodeURIComponent(provider)}`);
    $("#model-list").replaceChildren(...ids.map((id) => h("option", { value: id })));
    $("#model-hint").textContent = `${ids.length} models${provider === "openrouter" ? " with tool support" : ""} — type to filter`;
  } catch (e) {
    $("#model-hint").textContent = `couldn't list models: ${e.message}`;
  }
}

async function init() {
  meta = await api("/api/meta");
  const provSel = $("#provider");
  provSel.replaceChildren(...meta.providers.map((p) => h("option", { value: p.id }, p.label)));
  $("#no-providers").hidden = meta.providers.length > 0;
  $("#run-btn").disabled = meta.providers.length === 0;
  const lastProv = store.get("provider");
  if (lastProv && meta.providers.some((p) => p.id === lastProv)) provSel.value = lastProv;
  provSel.onchange = () => { store.set("provider", provSel.value); loadModels(provSel.value); };
  if (provSel.value) loadModels(provSel.value);

  $("#tool-boxes").replaceChildren(...meta.tools.map((t) =>
    h("label", { title: t.description }, h("input", { type: "checkbox", value: t.name, checked: true }), t.name)));
  $("#system").value = meta.default_system;
  $("#preset").append(...PRESETS.map(([label], i) => h("option", { value: i }, label)));
  $("#preset").onchange = (e) => { if (e.target.value !== "") $("#prompt").value = PRESETS[e.target.value][1]; };

  $("#run-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = (k) => (f.get(k) === "" || f.get(k) == null ? null : Number(f.get(k)));
    const body = {
      provider: f.get("provider"), model: f.get("model").trim(), prompt: f.get("prompt"), system: f.get("system"),
      tools: [...document.querySelectorAll("#tool-boxes input:checked")].map((i) => i.value),
      max_turns: num("max_turns") ?? 10, temperature: num("temperature"), max_tokens: num("max_tokens"),
      reasoning_effort: f.get("reasoning_effort") || null,
      tool_delay_ms: num("tool_delay_ms") ?? 0, tool_failure_rate: num("tool_failure_rate") ?? 0,
    };
    store.set(`model:${body.provider}`, body.model);
    $("#form-error").textContent = "";
    $("#run-btn").disabled = true;
    try {
      const { id } = await api("/api/runs", { method: "POST", body: JSON.stringify(body) });
      await openRun(id);
      loadHistory();
    } catch (err) {
      $("#form-error").textContent = err.message;
    } finally {
      $("#run-btn").disabled = false;
    }
  };

  $("#cancel-btn").onclick = () => S && api(`/api/runs/${S.run.id}/cancel`, { method: "POST" });

  for (const btn of document.querySelectorAll(".tabs button")) {
    btn.onclick = () => {
      for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b === btn);
      for (const tab of ["trace", "context", "events"]) $(`#tab-${tab}`).hidden = tab !== btn.dataset.tab;
      dirty = true;
    };
  }

  const tl = $("#timeline");
  const tip = $("#tooltip");
  tl.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".tl-row");
    if (!row || !S) { tip.hidden = true; return; }
    tip.textContent = tooltipText(row.dataset.kind, row.dataset.key);
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  tl.addEventListener("mouseleave", () => { tip.hidden = true; });
  tl.addEventListener("click", (e) => {
    const row = e.target.closest(".tl-row");
    if (!row) return;
    const card = document.getElementById(`card-${row.dataset.kind}-${row.dataset.key}`);
    if (!card) return;
    $(".tabs button[data-tab=trace]").click();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  });

  await loadHistory();
  const fromHash = location.hash.slice(1);
  if (fromHash) openRun(fromHash);

  const frame = () => {
    if (S && (dirty || S.live)) { dirty = false; render(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

init().catch((e) => { document.body.prepend(h("pre", { class: "form-error" }, `failed to start: ${e.message}`)); });
