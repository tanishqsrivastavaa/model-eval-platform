import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent, RunMeta, RunStatus } from '@/types/events';
import { runStore } from '../streamStore';
import { TraceTab } from './TraceTab';

function makeRun(status: RunStatus = 'running'): RunMeta {
  return {
    id: 'r1',
    created_at: 1700000000,
    provider: 'openai',
    model: 'gpt-4.1',
    prompt: 'do things',
    config: {
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'do things',
      system: 'sys',
      tools: ['calculator'],
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

function seed(events: RunEvent[], status: RunStatus = 'running') {
  runStore.reset(makeRun(status));
  for (const ev of events) runStore.applyEvent(ev);
  runStore.flushSync();
}

function started(seq: number, t_ms: number, call = 1): RunEvent {
  return {
    seq,
    t_ms,
    type: 'llm_call_started',
    data: { call, request: { messages: [{ role: 'user', content: 'hi' }] } },
  } as RunEvent;
}

describe('TraceTab', () => {
  beforeEach(() => {
    runStore.reset(makeRun('interrupted'));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders an LLM card in waiting state with streaming meta', () => {
    seed([
      { seq: 1, t_ms: 0, type: 'run_started', data: {} } as RunEvent,
      started(2, 10),
      { seq: 3, t_ms: 15, type: 'llm_headers', data: { call: 1, ms: 5 } } as RunEvent,
    ]);

    render(<TraceTab follow={false} />);

    const card = document.getElementById('card-llm-1');
    expect(card).toBeTruthy();
    expect(screen.getByText('LLM call #1')).toBeTruthy();
    expect(screen.getByText('waiting for first token…')).toBeTruthy();
    expect(screen.getByText('streaming…')).toBeTruthy();
    expect(card?.textContent).toContain('took');
    expect(card?.textContent).toContain('TTFT');
  });

  it('renders thinking, text output and tool-call chips', () => {
    seed([
      started(1, 0),
      { seq: 2, t_ms: 20, type: 'reasoning_delta', data: { call: 1, text: 'hmm ' } } as RunEvent,
      { seq: 3, t_ms: 30, type: 'llm_first_token', data: { call: 1, ttft_ms: 30 } } as RunEvent,
      {
        seq: 4,
        t_ms: 40,
        type: 'content_delta',
        data: { call: 1, text: 'hello world' },
      } as RunEvent,
      {
        seq: 5,
        t_ms: 50,
        type: 'tool_call_detected',
        data: { call: 1, index: 0, id: 't1', name: 'calculator' },
      } as RunEvent,
      {
        seq: 6,
        t_ms: 60,
        type: 'tool_args_delta',
        data: { call: 1, index: 0, text: '{"n": 2}' },
      } as RunEvent,
    ]);

    render(<TraceTab follow={false} />);

    expect(screen.getByText('thinking')).toBeTruthy();
    expect(screen.getByText(/hmm/)).toBeTruthy();
    expect(screen.getByText('text output')).toBeTruthy();
    expect(screen.getByText(/hello world/)).toBeTruthy();
    expect(screen.getByText('tool calls requested')).toBeTruthy();
    expect(screen.getByText(/calculator\(/)).toBeTruthy();
  });

  it('renders tool cards with args, result and failure styling', () => {
    seed([
      {
        seq: 1,
        t_ms: 0,
        type: 'tool_started',
        data: { call: 1, id: 'a', name: 'calculator', args: { n: 2 }, raw_args: '{"n":2}' },
      } as RunEvent,
      {
        seq: 2,
        t_ms: 120,
        type: 'tool_finished',
        data: {
          call: 1,
          id: 'a',
          name: 'calculator',
          ok: false,
          result: 'boom',
          start_ms: 0,
          end_ms: 120,
          duration_ms: 120,
        },
      } as RunEvent,
    ]);

    render(<TraceTab follow={false} />);

    const card = document.getElementById('card-tool-1:a');
    expect(card).toBeTruthy();
    expect(card?.className).toContain('border-l-fail');
    expect(screen.getByText('⚙ calculator')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(card?.textContent).toContain('took');
  });

  it('renders error cards and the final answer card when finished', () => {
    seed(
      [
        { seq: 1, t_ms: 0, type: 'error', data: { message: 'something broke' } } as RunEvent,
        {
          seq: 2,
          t_ms: 900,
          type: 'run_finished',
          data: {
            status: 'completed',
            final_answer: 'the answer is 42',
            totals: {
              wall_ms: 900,
              llm_ms: 700,
              tool_ms: 100,
              overhead_ms: 100,
              llm_calls: 1,
              tool_calls: 0,
              tool_errors: 0,
              prompt_tokens: 10,
              completion_tokens: 5,
              reasoning_tokens: 0,
              cached_tokens: 0,
              cost: null,
              first_ttft_ms: null,
            },
          },
        } as RunEvent,
      ],
      'running',
    );

    render(<TraceTab follow={false} />);

    expect(document.getElementById('err-0')).toBeTruthy();
    expect(screen.getByText('something broke')).toBeTruthy();
    expect(document.getElementById('card-final')).toBeTruthy();
    expect(screen.getByText('final answer')).toBeTruthy();
    expect(screen.getByText('the answer is 42')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('900ms')).toBeTruthy();
  });

  it('maps non-answer final statuses to their fallback message', () => {
    seed([
      {
        seq: 1,
        t_ms: 500,
        type: 'run_finished',
        data: {
          status: 'max_turns',
          final_answer: null,
          totals: {
            wall_ms: 500,
            llm_ms: 400,
            tool_ms: 50,
            overhead_ms: 50,
            llm_calls: 3,
            tool_calls: 1,
            tool_errors: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            reasoning_tokens: 0,
            cached_tokens: 0,
            cost: null,
            first_ttft_ms: null,
          },
        },
      } as RunEvent,
    ]);

    render(<TraceTab follow={false} />);
    expect(screen.getByText('Stopped: hit the max-turns limit.')).toBeTruthy();
  });
});
