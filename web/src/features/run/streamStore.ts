/**
 * Run stream store — pure event reduction + rAF-coalesced snapshot commits.
 * Port of static/app.js reduce()/newState()/now()/phase() (lines 58-120) and
 * the dirty||live render loop (556-560), restructured for React's
 * useSyncExternalStore: snapshots are frozen, identity-stable between
 * commits, and rebuilt only from dirty call/tool drafts.
 */
import type {
  LlmCallFinishedData,
  LlmRequestBody,
  RunEvent,
  RunFinishedData,
  RunMeta,
  RunStartedData,
  RunStatus,
} from '@/types/events';

export type SegKind = 'wait' | 'think' | 'text' | 'args';

export interface DraftSeg {
  kind: SegKind;
  from: number;
}

export interface DraftTc {
  id: string | null;
  name: string;
  args: string;
}

export interface DraftCall {
  n: number;
  start: number;
  request: LlmRequestBody;
  reasoning: string;
  content: string;
  tcs: Map<number, DraftTc>;
  segs: DraftSeg[];
  done: LlmCallFinishedData | null;
  end: number | null;
  headers?: number;
  ttft?: number;
  ver: number;
}

export interface DraftTool {
  key: string;
  call: number;
  id: string;
  name: string;
  args: Record<string, unknown> | null;
  raw_args: string;
  start: number;
  end: number | null;
  ok?: boolean;
  result?: string;
  duration_ms?: number;
  ver: number;
}

export interface CallSnapshot {
  readonly n: number;
  readonly start: number;
  readonly end: number | null;
  readonly request: LlmRequestBody;
  readonly reasoning: string;
  readonly content: string;
  readonly tcs: readonly { index: number; id: string | null; name: string; args: string }[];
  readonly segs: readonly DraftSeg[];
  readonly done: LlmCallFinishedData | null;
  readonly headers: number | null;
  readonly ttft: number | null;
  readonly ver: number;
}

export interface ToolSnapshot {
  readonly key: string;
  readonly call: number;
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown> | null;
  readonly raw_args: string;
  readonly start: number;
  readonly end: number | null;
  readonly ok: boolean | undefined;
  readonly result: string | undefined;
  readonly duration_ms: number | undefined;
  readonly ver: number;
}

export type OrderItem = { kind: 'llm'; key: number } | { kind: 'tool'; key: string };

export interface RunSnapshot {
  readonly run: RunMeta | null;
  readonly ver: number;
  readonly now: number;
  readonly lastT: number;
  readonly live: boolean;
  readonly status: RunStatus;
  readonly started: RunStartedData | null;
  readonly finished: RunFinishedData | null;
  readonly order: readonly OrderItem[];
  readonly errors: readonly string[];
  readonly calls: Readonly<Record<number, CallSnapshot>>;
  readonly tools: Readonly<Record<string, ToolSnapshot>>;
  readonly callsCount: number;
  readonly eventsLen: number;
  readonly eventsRef: readonly RunEvent[];
  readonly lastSeq: number;
  readonly grew: boolean;
}

interface Draft {
  run: RunMeta;
  events: RunEvent[];
  lastSeq: number;
  lastT: number;
  lastRecv: number;
  live: boolean;
  calls: Map<number, DraftCall>;
  tools: Map<string, DraftTool>;
  order: OrderItem[];
  errors: string[];
  finished: RunFinishedData | null;
  started: RunStartedData | null;
  ver: number;
  dirtyCalls: Set<number>;
  dirtyTools: Set<string>;
  grew: boolean;
}

export interface RunStore {
  applyEvent(ev: RunEvent): boolean;
  markStreamEnd(): void;
  reset(run: RunMeta): void;
  getSnapshot(): RunSnapshot;
  getServerSnapshot(): RunSnapshot;
  subscribe(listener: () => void): () => void;
  scheduleCommit(): void;
  commit(): void;
  flushSync(): void;
}

const EMPTY_SNAPSHOT: RunSnapshot = Object.freeze({
  run: null,
  ver: 0,
  now: 0,
  lastT: 0,
  live: false,
  status: 'interrupted' as RunStatus,
  started: null,
  finished: null,
  order: Object.freeze([]) as readonly OrderItem[],
  errors: Object.freeze([]) as readonly string[],
  calls: Object.freeze({}) as Readonly<Record<number, CallSnapshot>>,
  tools: Object.freeze({}) as Readonly<Record<string, ToolSnapshot>>,
  callsCount: 0,
  eventsLen: 0,
  eventsRef: Object.freeze([]) as readonly RunEvent[],
  lastSeq: 0,
  grew: false,
});

function phase(c: DraftCall, kind: SegKind, t: number): void {
  if (c.segs[c.segs.length - 1].kind !== kind) c.segs.push({ kind, from: t });
}

function freezeCall(c: DraftCall): CallSnapshot {
  const tcs = Array.from(c.tcs, ([index, tc]) => ({
    index,
    id: tc.id,
    name: tc.name,
    args: tc.args,
  }));
  return Object.freeze({
    n: c.n,
    start: c.start,
    end: c.end,
    request: c.request,
    reasoning: c.reasoning,
    content: c.content,
    tcs: Object.freeze(tcs),
    segs: Object.freeze(c.segs.map((s) => Object.freeze({ ...s }))),
    done: c.done,
    headers: c.headers ?? null,
    ttft: c.ttft ?? null,
    ver: c.ver,
  });
}

function freezeTool(t: DraftTool): ToolSnapshot {
  return Object.freeze({
    key: t.key,
    call: t.call,
    id: t.id,
    name: t.name,
    args: t.args,
    raw_args: t.raw_args,
    start: t.start,
    end: t.end,
    ok: t.ok,
    result: t.result,
    duration_ms: t.duration_ms,
    ver: t.ver,
  });
}

function scheduleFrame(frame: () => void): { cancel: () => void } {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => frame());
    return { cancel: () => cancelAnimationFrame(id) };
  }
  const id = setTimeout(frame, 16);
  return { cancel: () => clearTimeout(id) };
}

export function createRunStore(nowFn: () => number = () => performance.now()): RunStore {
  let draft: Draft | null = null;
  let current: RunSnapshot = EMPTY_SNAPSHOT;
  let pending: { cancel: () => void } | null = null;
  const listeners = new Set<() => void>();
  const callSnaps = new Map<number, CallSnapshot>();
  const toolSnaps = new Map<string, ToolSnapshot>();
  const callVerCache = new WeakMap<DraftCall, { ver: number; snap: CallSnapshot }>();
  const toolVerCache = new WeakMap<DraftTool, { ver: number; snap: ToolSnapshot }>();

  function notify(): void {
    for (const l of [...listeners]) l();
  }

  function cancelPending(): void {
    pending?.cancel();
    pending = null;
  }

  function newDraft(run: RunMeta): Draft {
    return {
      run,
      events: [],
      lastSeq: 0,
      lastT: 0,
      lastRecv: nowFn(),
      live: run.status === 'running',
      calls: new Map(),
      tools: new Map(),
      order: [],
      errors: [],
      finished: null,
      started: null,
      ver: 0,
      dirtyCalls: new Set(),
      dirtyTools: new Set(),
      grew: false,
    };
  }

  function commit(): void {
    const d = draft;
    if (!d) return;

    for (const n of d.dirtyCalls) {
      const c = d.calls.get(n);
      if (!c) {
        callSnaps.delete(n);
        continue;
      }
      const hit = callVerCache.get(c);
      if (hit && hit.ver === c.ver) {
        callSnaps.set(n, hit.snap);
      } else {
        const snap = freezeCall(c);
        callVerCache.set(c, { ver: c.ver, snap });
        callSnaps.set(n, snap);
      }
    }
    d.dirtyCalls.clear();

    for (const key of d.dirtyTools) {
      const t = d.tools.get(key);
      if (!t) {
        toolSnaps.delete(key);
        continue;
      }
      const hit = toolVerCache.get(t);
      if (hit && hit.ver === t.ver) {
        toolSnaps.set(key, hit.snap);
      } else {
        const snap = freezeTool(t);
        toolVerCache.set(t, { ver: t.ver, snap });
        toolSnaps.set(key, snap);
      }
    }
    d.dirtyTools.clear();

    const calls: Record<number, CallSnapshot> = {};
    for (const [n, snap] of callSnaps) calls[n] = snap;
    const tools: Record<string, ToolSnapshot> = {};
    for (const [key, snap] of toolSnaps) tools[key] = snap;

    const order: OrderItem[] = d.order.map((o) => Object.freeze({ ...o }) as OrderItem);
    const errors: string[] = d.errors.slice();
    const now = d.live ? d.lastT + (nowFn() - d.lastRecv) : d.lastT;
    const status = d.finished?.status ?? (d.live ? 'running' : d.run.status);

    current = Object.freeze({
      run: d.run,
      ver: current.ver + 1,
      now,
      lastT: d.lastT,
      live: d.live,
      status,
      started: d.started,
      finished: d.finished,
      order: Object.freeze(order),
      errors: Object.freeze(errors),
      calls: Object.freeze(calls),
      tools: Object.freeze(tools),
      callsCount: d.calls.size,
      eventsLen: d.events.length,
      eventsRef: d.events,
      lastSeq: d.lastSeq,
      grew: d.grew,
    });
    d.grew = false;
    notify();
  }

  function scheduleCommit(): void {
    if (pending || !draft) return;
    pending = scheduleFrame(() => {
      pending = null;
      commit();
      // Port app.js:556-560 — keep re-rendering while the run is live.
      if (draft?.live) scheduleCommit();
    });
  }

  function applyEvent(ev: RunEvent): boolean {
    const d = draft;
    if (!d) return false;
    if (ev.seq <= d.lastSeq) return false; // EventSource replays from the start
    d.lastSeq = ev.seq;
    d.lastT = ev.t_ms;
    d.lastRecv = nowFn();
    d.events.push(ev);
    d.ver++;
    const data = ev.data as { call?: number };
    const c = typeof data.call === 'number' ? d.calls.get(data.call) : undefined;
    if (c) {
      c.ver++;
      d.dirtyCalls.add(c.n);
      d.grew = true;
    }
    switch (ev.type) {
      case 'run_started':
        d.started = ev.data;
        break;
      case 'llm_call_started': {
        const { call, request } = ev.data;
        d.calls.set(call, {
          n: call,
          start: ev.t_ms,
          request,
          reasoning: '',
          content: '',
          tcs: new Map(),
          segs: [{ kind: 'wait', from: ev.t_ms }],
          done: null,
          end: null,
          ver: 1,
        });
        d.order.push({ kind: 'llm', key: call });
        d.dirtyCalls.add(call);
        d.grew = true;
        break;
      }
      case 'llm_headers':
        if (c) c.headers = ev.data.ms;
        break;
      case 'llm_first_token':
        if (c) c.ttft = ev.data.ttft_ms;
        break;
      case 'reasoning_delta':
        if (c) {
          c.reasoning += ev.data.text;
          phase(c, 'think', ev.t_ms);
        }
        break;
      case 'content_delta':
        if (c) {
          c.content += ev.data.text;
          phase(c, 'text', ev.t_ms);
        }
        break;
      case 'tool_call_detected':
        if (c) {
          c.tcs.set(ev.data.index, { id: ev.data.id, name: ev.data.name, args: '' });
          phase(c, 'args', ev.t_ms);
        }
        break;
      case 'tool_args_delta': {
        if (c) {
          let tc = c.tcs.get(ev.data.index);
          if (!tc) {
            tc = { id: null, name: '?', args: '' };
            c.tcs.set(ev.data.index, tc);
          }
          tc.args += ev.data.text;
          phase(c, 'args', ev.t_ms);
        }
        break;
      }
      case 'llm_call_finished':
        if (c) {
          c.done = ev.data;
          c.end = ev.data.end_ms;
        }
        break;
      case 'tool_started': {
        const { call, id } = ev.data;
        const key = `${call}:${id}`;
        d.tools.set(key, {
          key,
          call,
          id,
          name: ev.data.name,
          args: ev.data.args,
          raw_args: ev.data.raw_args,
          start: ev.t_ms,
          end: null,
          ver: 1,
        });
        d.order.push({ kind: 'tool', key });
        d.dirtyTools.add(key);
        d.grew = true;
        break;
      }
      case 'tool_finished': {
        const key = `${ev.data.call}:${ev.data.id}`;
        const t = d.tools.get(key);
        if (t) {
          t.end = ev.data.end_ms;
          t.ok = ev.data.ok;
          t.result = ev.data.result;
          t.duration_ms = ev.data.duration_ms;
          t.ver++;
          d.dirtyTools.add(key);
          d.grew = true;
        }
        break;
      }
      case 'error':
        d.errors.push(ev.data.message);
        d.grew = true;
        break;
      case 'run_finished':
        d.finished = ev.data;
        d.live = false;
        d.grew = true;
        break;
    }
    scheduleCommit();
    return true;
  }

  function markStreamEnd(): void {
    if (!draft) return;
    draft.live = false; // no record, no seq
    scheduleCommit();
  }

  function reset(run: RunMeta): void {
    cancelPending();
    callSnaps.clear();
    toolSnaps.clear();
    draft = newDraft(run);
    commit(); // fresh identity immediately so React re-renders the new run
  }

  return {
    applyEvent,
    markStreamEnd,
    reset,
    getSnapshot: () => current,
    getServerSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    scheduleCommit,
    commit,
    flushSync() {
      cancelPending();
      commit();
    },
  };
}

export const runStore: RunStore = createRunStore();
