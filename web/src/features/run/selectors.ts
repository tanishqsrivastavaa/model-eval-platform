/**
 * Selectors over RunSnapshot.
 *
 * Identity contract (legacy patch gate, app.js:364-365): a card only needs a
 * new identity when it is live AND unfinished — then it wraps {view, now} so
 * every commit while streaming produces a new object. Finished/not-live cards
 * return the frozen snapshot itself, identity-stable across commits.
 * Stats/timeline/events tables are memoized per snapshot via WeakMap.
 */

import type { Usage } from '@/types/events';
import type { RunSnapshot, SegKind } from './streamStore';

export interface CallViewWrapper<T> {
  call: T;
  now: number;
}

const callViewCache = new WeakMap<RunSnapshot, Map<number, object>>();
const toolViewCache = new WeakMap<RunSnapshot, Map<string, object>>();
const statsCache = new WeakMap<RunSnapshot, StatsView>();
const timelineCache = new WeakMap<RunSnapshot, TimelineModel>();
const eventsCache = new WeakMap<RunSnapshot, EventsTable>();

export type CallView = ReturnType<typeof selectCallView>;
export type ToolView = ReturnType<typeof selectToolView>;

export function selectCallView(s: RunSnapshot, n: number) {
  const call = s.calls[n];
  if (!call) return undefined;
  if (!s.live || call.done) return call;
  let map = callViewCache.get(s);
  if (!map) {
    map = new Map();
    callViewCache.set(s, map);
  }
  let wrapped = map.get(n) as CallViewWrapper<typeof call> | undefined;
  if (!wrapped) {
    wrapped = { call, now: s.now };
    map.set(n, wrapped);
  }
  return wrapped;
}

export function selectToolView(s: RunSnapshot, key: string) {
  const tool = s.tools[key];
  if (!tool) return undefined;
  if (!s.live || tool.end != null) return tool;
  let map = toolViewCache.get(s);
  if (!map) {
    map = new Map();
    toolViewCache.set(s, map);
  }
  let wrapped = map.get(key) as CallViewWrapper<typeof tool> | undefined;
  if (!wrapped) {
    wrapped = { call: tool, now: s.now };
    map.set(key, wrapped);
  }
  return wrapped;
}

export const selectStatus = (s: RunSnapshot) => s.status;
export const selectLive = (s: RunSnapshot) => s.live;
export const selectOrder = (s: RunSnapshot) => s.order;
export const selectErrorsLen = (s: RunSnapshot) => s.errors.length;
export const selectFinished = (s: RunSnapshot) => s.finished;
export const selectContextKey = (s: RunSnapshot) => s.callsCount * 1000 + (s.finished ? 1 : 0);
export const selectEventsLen = (s: RunSnapshot) => s.eventsLen;

export interface StatsView {
  wall: number;
  llm: number;
  tool: number;
  overhead: number | null;
  ttft: number | null;
  avgSpeed: number | null;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  tokensIn: number | null;
  cached: number;
  tokensOut: number | null;
  reasoning: number;
  cost: number | null;
  percents: { llm: string; tool: string };
}

/** Port of renderStats (app.js:173-201) using s.now; memoized per snapshot. */
export function selectStats(s: RunSnapshot): StatsView {
  const hit = statsCache.get(s);
  if (hit) return hit;

  const t = s.now;
  const calls = Object.values(s.calls).sort((a, b) => a.n - b.n);
  const tools = Object.values(s.tools);
  const tot = s.finished?.totals;
  const llm = tot?.llm_ms ?? calls.reduce((a, c) => a + ((c.end ?? t) - c.start), 0);
  const tool = tot?.tool_ms ?? tools.reduce((a, x) => a + ((x.end ?? t) - x.start), 0);
  const wall = tot?.wall_ms ?? t;
  const pct = (x: number) => (wall ? `${Math.round((100 * x) / wall)}% of wall` : '');
  const usage = calls.map((c) => c.done?.usage ?? {});
  const sum = (f: (u: Usage) => number | null | undefined) =>
    usage.reduce<number>((a, u) => a + (f(u) ?? 0), 0);
  const tps = calls.map((c) => c.done?.tokens_per_s).filter((x): x is number => Boolean(x));
  const toolErrors = tools.filter((x) => x.end != null && !x.ok).length;
  const reasoning = sum((u) => u.completion_tokens_details?.reasoning_tokens);
  const cost = tot?.cost ?? (sum((u) => u.cost) || null);
  const first = calls[0];

  const stats: StatsView = {
    wall,
    llm,
    tool,
    overhead: tot ? tot.overhead_ms : null,
    ttft: first?.ttft ?? null,
    avgSpeed: tps.length ? Math.round(tps.reduce((a, b) => a + b, 0) / tps.length) : null,
    turns: calls.length,
    toolCalls: tools.length,
    toolErrors,
    tokensIn: sum((u) => u.prompt_tokens) || null,
    cached: sum((u) => u.prompt_tokens_details?.cached_tokens),
    tokensOut: sum((u) => u.completion_tokens) || null,
    reasoning,
    cost,
    percents: { llm: pct(llm), tool: pct(tool) },
  };
  statsCache.set(s, stats);
  return stats;
}

export interface TimelineSeg {
  kind: SegKind;
  from: number;
  end: number;
  pct: number;
}

export interface TimelineRow {
  kind: 'llm' | 'tool';
  key: number | string;
  label: string;
  start: number;
  end: number;
  segs: readonly TimelineSeg[];
  state: 'running' | 'done' | 'ok' | 'fail';
  depth: 0 | 1;
}

export interface TimelineModel {
  rows: readonly TimelineRow[];
  live: boolean;
  nowMs: number;
  lastTMs: number;
  version: number;
}

/** Port of niceStep (app.js:204-207). */
export function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}

/** Viewport window: {t0: 0, t1: max(lastT, 1) * 1.02}. */
export function fitView(model: Pick<TimelineModel, 'lastTMs'>): { t0: number; t1: number } {
  return { t0: 0, t1: Math.max(model.lastTMs, 1) * 1.02 };
}

/** Port of renderTimeline's row building (app.js:209-247); memoized per snapshot. */
export function selectTimelineModel(s: RunSnapshot): TimelineModel {
  const hit = timelineCache.get(s);
  if (hit) return hit;

  const rows: TimelineRow[] = [];
  for (const item of s.order) {
    if (item.kind === 'llm') {
      const c = s.calls[item.key];
      if (!c) continue;
      const end = c.end ?? s.now;
      const segs: TimelineSeg[] = c.segs.map((seg, i) => {
        const segEnd = c.segs[i + 1]?.from ?? end;
        return {
          kind: seg.kind,
          from: seg.from,
          end: segEnd,
          pct: end > c.start ? (100 * (segEnd - seg.from)) / (end - c.start) : 0,
        };
      });
      rows.push({
        kind: 'llm',
        key: item.key,
        label: `LLM #${c.n}`,
        start: c.start,
        end,
        segs,
        state: c.end == null ? 'running' : 'done',
        depth: 0,
      });
    } else {
      const x = s.tools[item.key];
      if (!x) continue;
      rows.push({
        kind: 'tool',
        key: item.key,
        label: `↳ ${x.name}`,
        start: x.start,
        end: x.end ?? s.now,
        segs: [],
        state: x.end == null ? 'running' : x.ok ? 'ok' : 'fail',
        depth: 1,
      });
    }
  }

  const model: TimelineModel = {
    rows,
    live: s.live,
    nowMs: s.now,
    lastTMs: s.lastT,
    version: s.ver,
  };
  timelineCache.set(s, model);
  return model;
}

export interface EventsTable {
  eventsRef: RunSnapshot['eventsRef'];
  eventsLen: number;
}

/** Stable {eventsRef, eventsLen} handle for the events table; memoized per snapshot. */
export function selectEventsTable(s: RunSnapshot): EventsTable {
  const hit = eventsCache.get(s);
  if (hit) return hit;
  const table: EventsTable = { eventsRef: s.eventsRef, eventsLen: s.eventsLen };
  eventsCache.set(s, table);
  return table;
}
