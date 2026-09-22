import { beforeEach, describe, expect, it } from 'vitest';
import type { RunMeta, RunStatus } from '@/types/events';
import {
  fitView,
  niceStep,
  selectCallView,
  selectContextKey,
  selectErrorsLen,
  selectEventsLen,
  selectEventsTable,
  selectFinished,
  selectLive,
  selectOrder,
  selectStats,
  selectStatus,
  selectTimelineModel,
  selectToolView,
} from './selectors';
import { createRunStore, type RunStore } from './streamStore';

function makeRun(status: RunStatus = 'running'): RunMeta {
  return {
    id: 'r1',
    created_at: 1700000000,
    provider: 'openai',
    model: 'gpt-4.1',
    prompt: 'hi',
    config: {
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'hi',
      system: 'sys',
      tools: ['calc'],
      max_turns: 10,
      temperature: null,
      max_tokens: null,
      reasoning_effort: null,
      tool_delay_ms: 0,
      tool_failure_rate: 0,
    },
    status,
    summary: null,
  };
}

interface Ctx {
  store: RunStore;
  perf: { t: number };
}

function setup(status: RunStatus = 'running'): Ctx {
  const perf = { t: 0 };
  const store = createRunStore(() => perf.t);
  perf.t = 100;
  store.reset(makeRun(status));
  return { store, perf };
}

const started = (seq: number, t: number, call = 1) => ({
  seq,
  t_ms: t,
  type: 'llm_call_started' as const,
  data: { call, request: { model: 'gpt-4.1', messages: [], stream: true } },
});

describe('streamStore.applyEvent', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('1. dedupes a replayed seq', () => {
    const ev = {
      seq: 1,
      t_ms: 10,
      type: 'run_started' as const,
      data: {
        provider: 'openai',
        model: 'gpt-4.1',
        prompt: 'hi',
        system: 'sys',
        tools: [],
        config: makeRun().config,
      },
    };
    expect(ctx.store.applyEvent(ev)).toBe(true);
    expect(ctx.store.applyEvent(ev)).toBe(false);
    ctx.store.flushSync();
    expect(ctx.store.getSnapshot().eventsLen).toBe(1);
    expect(ctx.store.getSnapshot().lastSeq).toBe(1);
  });

  it('2. drops a lower seq', () => {
    expect(ctx.store.applyEvent(started(5, 10))).toBe(true);
    expect(ctx.store.applyEvent(started(3, 20))).toBe(false);
    ctx.store.flushSync();
    expect(ctx.store.getSnapshot().lastSeq).toBe(5);
    expect(ctx.store.getSnapshot().eventsLen).toBe(1);
  });

  it('3. records run_started', () => {
    ctx.store.applyEvent({
      seq: 1,
      t_ms: 5,
      type: 'run_started',
      data: {
        provider: 'openai',
        model: 'gpt-4.1',
        prompt: 'hi',
        system: 'sys',
        tools: ['calc'],
        config: makeRun().config,
      },
    });
    ctx.store.flushSync();
    const s = ctx.store.getSnapshot();
    expect(s.started?.provider).toBe('openai');
    expect(s.started?.model).toBe('gpt-4.1');
    expect(s.grew).toBe(false); // cleared after commit
  });

  it('4. llm_call_started creates call + order + wait seg', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.flushSync();
    const s = ctx.store.getSnapshot();
    expect(s.callsCount).toBe(1);
    expect(s.order).toEqual([{ kind: 'llm', key: 1 }]);
    expect(s.calls[1].segs).toEqual([{ kind: 'wait', from: 10 }]);
    expect(s.calls[1].start).toBe(10);
    expect(s.calls[1].done).toBeNull();
    expect(s.calls[1].end).toBeNull();
  });

  it('5. llm_headers + llm_first_token land on the call', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({ seq: 2, t_ms: 40, type: 'llm_headers', data: { call: 1, ms: 30 } });
    ctx.store.applyEvent({
      seq: 3,
      t_ms: 90,
      type: 'llm_first_token',
      data: { call: 1, ttft_ms: 80 },
    });
    ctx.store.flushSync();
    const c = ctx.store.getSnapshot().calls[1];
    expect(c.headers).toBe(30);
    expect(c.ttft).toBe(80);
    expect(c.ver).toBe(3); // created 1 + two bumps (headers, first_token)
  });

  it('6. reasoning deltas coalesce by phase and transition segments', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 20,
      type: 'reasoning_delta',
      data: { call: 1, text: 'a' },
    });
    ctx.store.applyEvent({
      seq: 3,
      t_ms: 30,
      type: 'reasoning_delta',
      data: { call: 1, text: 'b' },
    });
    ctx.store.applyEvent({ seq: 4, t_ms: 40, type: 'content_delta', data: { call: 1, text: 'x' } });
    ctx.store.applyEvent({ seq: 5, t_ms: 50, type: 'content_delta', data: { call: 1, text: 'y' } });
    ctx.store.flushSync();
    const c = ctx.store.getSnapshot().calls[1];
    expect(c.reasoning).toBe('ab');
    expect(c.content).toBe('xy');
    expect(c.segs.map((s) => s.kind)).toEqual(['wait', 'think', 'text']);
    expect(c.segs.map((s) => s.from)).toEqual([10, 20, 40]);
  });

  it('7. content delta appends text', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 20,
      type: 'content_delta',
      data: { call: 1, text: 'hel' },
    });
    ctx.store.applyEvent({
      seq: 3,
      t_ms: 30,
      type: 'content_delta',
      data: { call: 1, text: 'lo' },
    });
    ctx.store.flushSync();
    expect(ctx.store.getSnapshot().calls[1].content).toBe('hello');
  });

  it('8. tool_call_detected records tc and switches to args phase', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({ seq: 2, t_ms: 20, type: 'content_delta', data: { call: 1, text: 'x' } });
    ctx.store.applyEvent({
      seq: 3,
      t_ms: 30,
      type: 'tool_call_detected',
      data: { call: 1, index: 0, id: 'call_1_0', name: 'calc' },
    });
    ctx.store.flushSync();
    const c = ctx.store.getSnapshot().calls[1];
    expect(c.tcs).toEqual([{ index: 0, id: 'call_1_0', name: 'calc', args: '' }]);
    expect(c.segs.map((s) => s.kind)).toEqual(['wait', 'text', 'args']);
  });

  it('9. tool_args_delta before detection creates a placeholder', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 20,
      type: 'tool_args_delta',
      data: { call: 1, index: 0, text: '{"x"' },
    });
    ctx.store.flushSync();
    const c = ctx.store.getSnapshot().calls[1];
    expect(c.tcs).toEqual([{ index: 0, id: null, name: '?', args: '{"x"' }]);
    expect(c.segs.map((s) => s.kind)).toEqual(['wait', 'args']);
  });

  it('10. llm_call_finished sets done + end', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 200,
      type: 'llm_call_finished',
      data: {
        call: 1,
        start_ms: 10,
        end_ms: 200,
        duration_ms: 190,
        ttft_ms: 80,
        marks: {},
        chunks: 3,
        finish_reason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        tokens_per_s: 40,
        content: 'hi',
        reasoning: '',
        tool_calls: [],
      },
    });
    ctx.store.flushSync();
    const c = ctx.store.getSnapshot().calls[1];
    expect(c.done?.finish_reason).toBe('stop');
    expect(c.end).toBe(200);
    expect(selectCallView(ctx.store.getSnapshot(), 1)).toBe(c); // frozen identity when done
  });

  it('11. tool_started/tool_finished bump tool ver', () => {
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 210,
      type: 'tool_started',
      data: { call: 1, id: 't1', name: 'calc', args: { a: 1 }, raw_args: '{"a":1}' },
    });
    ctx.store.flushSync();
    const s1 = ctx.store.getSnapshot();
    expect(s1.tools['1:t1'].ver).toBe(1);
    expect(s1.tools['1:t1'].end).toBeNull();
    expect(s1.order).toEqual([
      { kind: 'llm', key: 1 },
      { kind: 'tool', key: '1:t1' },
    ]);

    ctx.store.applyEvent({
      seq: 3,
      t_ms: 260,
      type: 'tool_finished',
      data: {
        call: 1,
        id: 't1',
        name: 'calc',
        ok: true,
        result: '42',
        start_ms: 210,
        end_ms: 260,
        duration_ms: 50,
      },
    });
    ctx.store.flushSync();
    const t = ctx.store.getSnapshot().tools['1:t1'];
    expect(t.ver).toBe(2);
    expect(t.end).toBe(260);
    expect(t.ok).toBe(true);
    expect(t.result).toBe('42');
    expect(t.duration_ms).toBe(50);
  });

  it('12. tool_finished without tool_started is a no-op', () => {
    ctx.store.applyEvent(started(1, 10));
    const ok = ctx.store.applyEvent({
      seq: 2,
      t_ms: 50,
      type: 'tool_finished',
      data: {
        call: 1,
        id: 'ghost',
        name: 'calc',
        ok: false,
        result: 'ERROR',
        start_ms: 40,
        end_ms: 50,
        duration_ms: 10,
      },
    });
    ctx.store.flushSync();
    expect(ok).toBe(true); // event accepted
    const s = ctx.store.getSnapshot();
    expect(Object.keys(s.tools)).toEqual([]);
    expect(s.order).toEqual([{ kind: 'llm', key: 1 }]);
  });

  it('13. error pushes into errors[]', () => {
    ctx.store.applyEvent({ seq: 1, t_ms: 5, type: 'error', data: { message: 'boom' } });
    ctx.store.flushSync();
    const s = ctx.store.getSnapshot();
    expect(s.errors).toEqual(['boom']);
    expect(selectErrorsLen(s)).toBe(1);
  });

  it('14. run_finished sets status + freezes live', () => {
    ctx.store.applyEvent({
      seq: 1,
      t_ms: 100,
      type: 'run_finished',
      data: {
        status: 'completed',
        final_answer: 'done',
        totals: {
          wall_ms: 100,
          llm_ms: 80,
          tool_ms: 10,
          overhead_ms: 10,
          llm_calls: 1,
          tool_calls: 1,
          tool_errors: 0,
          prompt_tokens: 10,
          completion_tokens: 5,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cost: null,
          first_ttft_ms: null,
        },
      },
    });
    ctx.store.flushSync();
    const s = ctx.store.getSnapshot();
    expect(s.finished?.final_answer).toBe('done');
    expect(s.live).toBe(false);
    expect(s.status).toBe('completed');
    expect(selectFinished(s)?.status).toBe('completed');
  });

  it('15. unknown call does not throw and skips the case', () => {
    ctx.store.applyEvent({ seq: 1, t_ms: 10, type: 'llm_headers', data: { call: 42, ms: 5 } });
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 20,
      type: 'content_delta',
      data: { call: 42, text: 'x' },
    });
    ctx.store.flushSync();
    const s = ctx.store.getSnapshot();
    expect(s.callsCount).toBe(0);
    expect(s.eventsLen).toBe(2);
  });
});

describe('streamStore lifecycle', () => {
  it('16. markStreamEnd sets live=false without recording', () => {
    const ctx = setup();
    ctx.store.applyEvent(started(1, 50));
    ctx.store.flushSync();
    const before = ctx.store.getSnapshot();
    ctx.store.markStreamEnd();
    ctx.store.flushSync();
    const after = ctx.store.getSnapshot();
    expect(after.live).toBe(false);
    expect(after.eventsLen).toBe(before.eventsLen);
    expect(after.lastSeq).toBe(before.lastSeq);
    expect(after.now).toBe(50); // frozen at lastT
  });

  it('17. now extrapolates while live, freezes after end', () => {
    const ctx = setup();
    ctx.store.applyEvent({
      seq: 1,
      t_ms: 50,
      type: 'run_started',
      data: {
        provider: 'openai',
        model: 'gpt-4.1',
        prompt: 'hi',
        system: 'sys',
        tools: [],
        config: makeRun().config,
      },
    });
    ctx.perf.t = 400;
    ctx.store.flushSync();
    // lastT=50, lastRecv=100 (nowFn at apply), now = 50 + (400-100) = 350
    expect(ctx.store.getSnapshot().now).toBe(350);
    expect(ctx.store.getSnapshot().live).toBe(true);

    ctx.store.markStreamEnd();
    ctx.perf.t = 999;
    ctx.store.flushSync();
    expect(ctx.store.getSnapshot().live).toBe(false);
    expect(ctx.store.getSnapshot().now).toBe(50);
  });

  it('18. status fallbacks: running / completed / interrupted', () => {
    const live = setup('running');
    live.store.flushSync();
    expect(selectStatus(live.store.getSnapshot())).toBe('running');

    const done = setup('running');
    done.store.applyEvent({
      seq: 1,
      t_ms: 10,
      type: 'run_finished',
      data: {
        status: 'completed',
        final_answer: null,
        totals: {
          wall_ms: 10,
          llm_ms: 10,
          tool_ms: 0,
          overhead_ms: 0,
          llm_calls: 0,
          tool_calls: 0,
          tool_errors: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cost: null,
          first_ttft_ms: null,
        },
      },
    });
    done.store.flushSync();
    expect(selectStatus(done.store.getSnapshot())).toBe('completed');

    const stale = setup('interrupted');
    stale.store.flushSync();
    expect(selectStatus(stale.store.getSnapshot())).toBe('interrupted');
  });

  it('19. contextKey is stable across deltas', () => {
    const ctx = setup();
    ctx.store.applyEvent(started(1, 10));
    ctx.store.flushSync();
    const k1 = selectContextKey(ctx.store.getSnapshot());
    ctx.store.applyEvent({ seq: 2, t_ms: 20, type: 'content_delta', data: { call: 1, text: 'a' } });
    ctx.store.applyEvent({ seq: 3, t_ms: 30, type: 'content_delta', data: { call: 1, text: 'b' } });
    ctx.store.flushSync();
    expect(selectContextKey(ctx.store.getSnapshot())).toBe(k1);
    expect(k1).toBe(1000);
  });

  it('20. snapshot identity is stable until flushSync/commit', () => {
    const ctx = setup();
    const afterReset = ctx.store.getSnapshot();
    expect(ctx.store.getSnapshot()).toBe(afterReset);

    ctx.store.applyEvent(started(1, 10));
    // no commit yet — identity unchanged
    expect(ctx.store.getSnapshot()).toBe(afterReset);

    ctx.store.flushSync();
    const afterFlush = ctx.store.getSnapshot();
    expect(afterFlush).not.toBe(afterReset);
    expect(ctx.store.getSnapshot()).toBe(afterFlush);
    // second flush with no events still produces a new snapshot (ver bump)
    ctx.store.flushSync();
    expect(ctx.store.getSnapshot()).not.toBe(afterFlush);
  });
});

describe('selectors', () => {
  it('21. selectStats math spot-check (live, unfinished)', () => {
    const ctx = setup();
    ctx.store.applyEvent(started(1, 100));
    ctx.perf.t = 600;
    ctx.store.flushSync();
    // lastT=100, lastRecv=100 → now = 100 + (600-100) = 600
    const s = ctx.store.getSnapshot();
    expect(s.now).toBe(600);
    const stats = selectStats(s);
    expect(stats.wall).toBe(600);
    expect(stats.llm).toBe(500); // 600 - 100
    expect(stats.tool).toBe(0);
    expect(stats.overhead).toBeNull();
    expect(stats.turns).toBe(1);
    expect(stats.toolCalls).toBe(0);
    expect(stats.toolErrors).toBe(0);
    expect(stats.tokensIn).toBeNull();
    expect(stats.cost).toBeNull();
    expect(stats.percents.llm).toBe('83% of wall');
    expect(stats.percents.tool).toBe('0% of wall');
    // memoized per snapshot
    expect(selectStats(s)).toBe(stats);
  });

  it('21b. selectStats uses finished totals + usage sums', () => {
    const ctx = setup();
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 50,
      type: 'llm_first_token',
      data: { call: 1, ttft_ms: 40 },
    });
    ctx.store.applyEvent({
      seq: 3,
      t_ms: 110,
      type: 'llm_call_finished',
      data: {
        call: 1,
        start_ms: 10,
        end_ms: 110,
        duration_ms: 100,
        ttft_ms: 40,
        marks: {},
        chunks: 2,
        finish_reason: 'stop',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens_details: { reasoning_tokens: 2 },
          cost: 0.001,
        },
        tokens_per_s: 50,
        content: 'ok',
        reasoning: '',
        tool_calls: [],
      },
    });
    ctx.store.applyEvent({
      seq: 4,
      t_ms: 150,
      type: 'tool_started',
      data: { call: 1, id: 't1', name: 'calc', args: null, raw_args: '' },
    });
    ctx.store.applyEvent({
      seq: 5,
      t_ms: 200,
      type: 'tool_finished',
      data: {
        call: 1,
        id: 't1',
        name: 'calc',
        ok: false,
        result: 'ERROR: nope',
        start_ms: 150,
        end_ms: 200,
        duration_ms: 50,
      },
    });
    ctx.store.applyEvent({
      seq: 6,
      t_ms: 300,
      type: 'run_finished',
      data: {
        status: 'completed',
        final_answer: 'ok',
        totals: {
          wall_ms: 300,
          llm_ms: 100,
          tool_ms: 50,
          overhead_ms: 150,
          llm_calls: 1,
          tool_calls: 1,
          tool_errors: 1,
          prompt_tokens: 10,
          completion_tokens: 5,
          reasoning_tokens: 2,
          cached_tokens: 3,
          cost: 0.001,
          first_ttft_ms: 40,
        },
      },
    });
    ctx.store.flushSync();
    const stats = selectStats(ctx.store.getSnapshot());
    expect(stats.wall).toBe(300);
    expect(stats.llm).toBe(100);
    expect(stats.tool).toBe(50);
    expect(stats.overhead).toBe(150);
    expect(stats.ttft).toBe(40);
    expect(stats.avgSpeed).toBe(50);
    expect(stats.turns).toBe(1);
    expect(stats.toolCalls).toBe(1);
    expect(stats.toolErrors).toBe(1);
    expect(stats.tokensIn).toBe(10);
    expect(stats.cached).toBe(3);
    expect(stats.tokensOut).toBe(5);
    expect(stats.reasoning).toBe(2);
    expect(stats.cost).toBe(0.001);
    expect(stats.percents.llm).toBe('33% of wall');
    expect(stats.percents.tool).toBe('17% of wall');
  });

  it('22. timeline model rows: order, labels, depth, state', () => {
    const ctx = setup();
    ctx.store.applyEvent(started(1, 10));
    ctx.store.applyEvent({
      seq: 2,
      t_ms: 200,
      type: 'tool_started',
      data: { call: 1, id: 't1', name: 'calc', args: null, raw_args: '{}' },
    });
    ctx.store.applyEvent(started(3, 300, 2));
    ctx.store.applyEvent({
      seq: 4,
      t_ms: 400,
      type: 'tool_started',
      data: { call: 2, id: 't2', name: 'run_python', args: null, raw_args: '{}' },
    });
    ctx.store.applyEvent({
      seq: 5,
      t_ms: 450,
      type: 'tool_finished',
      data: {
        call: 2,
        id: 't2',
        name: 'run_python',
        ok: false,
        result: 'ERROR',
        start_ms: 400,
        end_ms: 450,
        duration_ms: 50,
      },
    });
    ctx.store.flushSync();
    const s = ctx.store.getSnapshot();
    const model = selectTimelineModel(s);
    expect(model.rows.map((r) => r.label)).toEqual(['LLM #1', '↳ calc', 'LLM #2', '↳ run_python']);
    expect(model.rows.map((r) => r.depth)).toEqual([0, 1, 0, 1]);
    expect(model.rows.map((r) => r.kind)).toEqual(['llm', 'tool', 'llm', 'tool']);
    expect(model.rows.map((r) => r.state)).toEqual(['running', 'running', 'running', 'fail']);
    expect(model.rows[0].start).toBe(10);
    expect(model.rows[1].start).toBe(200);
    expect(model.rows[1].end).toBe(200 + (s.now - 200)); // running → now
    expect(model.live).toBe(true);
    expect(model.nowMs).toBe(s.now);
    expect(model.lastTMs).toBe(450);
    expect(model.version).toBe(s.ver);
    expect(selectTimelineModel(s)).toBe(model); // memoized per snapshot

    // LLM segs carry computed pct widths
    const llmRow = model.rows[0];
    expect(llmRow.segs).toHaveLength(1);
    expect(llmRow.segs[0].kind).toBe('wait');
    expect(llmRow.segs[0].pct).toBeGreaterThan(0);
  });

  it('22b. view identity follows the live/done patch gate', () => {
    const ctx = setup();
    ctx.store.applyEvent(started(1, 10));
    ctx.store.flushSync();
    const s1 = ctx.store.getSnapshot();
    const v1 = selectCallView(s1, 1);
    const v2 = selectCallView(s1, 1);
    expect(v1).toBe(v2); // stable per snapshot while streaming
    expect(v1).toMatchObject({ now: expect.any(Number) });
    expect((v1 as { call: unknown }).call).toBe(s1.calls[1]);

    ctx.store.applyEvent({ seq: 2, t_ms: 30, type: 'content_delta', data: { call: 1, text: 'x' } });
    ctx.store.flushSync();
    const s2 = ctx.store.getSnapshot();
    const v3 = selectCallView(s2, 1);
    expect(v3).not.toBe(v1); // wrapper identity changes across commits while live

    ctx.store.markStreamEnd();
    ctx.store.flushSync();
    const s3 = ctx.store.getSnapshot();
    expect(selectCallView(s3, 1)).toBe(s3.calls[1]); // frozen when !live

    expect(selectToolView(s3, 'nope')).toBeUndefined();
    expect(selectCallView(s3, 99)).toBeUndefined();
  });

  it('22c. niceStep + fitView port', () => {
    expect(niceStep(100)).toBe(100);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.15)).toBe(0.2);
    expect(niceStep(3)).toBe(5);
    expect(fitView({ lastTMs: 1000 })).toEqual({ t0: 0, t1: 1020 });
    expect(fitView({ lastTMs: 0 })).toEqual({ t0: 0, t1: 1.02 });
  });

  it('22d. scalar selectors + events table stability', () => {
    const ctx = setup();
    ctx.store.applyEvent(started(1, 10));
    ctx.store.flushSync();
    const s = ctx.store.getSnapshot();
    expect(selectLive(s)).toBe(true);
    expect(selectOrder(s)).toBe(s.order);
    expect(selectEventsLen(s)).toBe(1);
    expect(selectEventsTable(s)).toBe(selectEventsTable(s));
    expect(selectErrorsLen(s)).toBe(0);
  });
});
