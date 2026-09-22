import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent, RunMeta } from '@/types/events';
import { runStore } from '../streamStore';
import { StatsStrip } from './StatsStrip';

function makeRun(): RunMeta {
  return {
    id: 'r1',
    created_at: 1700000000,
    provider: 'openai',
    model: 'gpt-4.1',
    prompt: 'stats',
    config: {
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'stats',
      system: '',
      tools: ['calculator'],
      max_turns: 10,
      temperature: null,
      max_tokens: null,
      reasoning_effort: null,
      tool_delay_ms: 0,
      tool_failure_rate: 0,
    },
    status: 'running',
    summary: null,
  };
}

describe('StatsStrip', () => {
  beforeEach(() => {
    runStore.reset(makeRun());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the legacy tile set with labels, values and subs', () => {
    runStore.applyEvent({
      seq: 1,
      t_ms: 10,
      type: 'llm_call_started',
      data: { call: 1, request: { messages: [] } },
    } as RunEvent);
    runStore.applyEvent({
      seq: 2,
      t_ms: 20,
      type: 'llm_headers',
      data: { call: 1, ms: 120 },
    } as RunEvent);
    runStore.applyEvent({
      seq: 3,
      t_ms: 260,
      type: 'llm_first_token',
      data: { call: 1, ttft_ms: 250 },
    } as RunEvent);
    runStore.applyEvent({
      seq: 4,
      t_ms: 1500,
      type: 'llm_call_finished',
      data: {
        call: 1,
        start_ms: 10,
        end_ms: 1400,
        duration_ms: 1390,
        ttft_ms: 250,
        marks: {},
        chunks: 5,
        finish_reason: 'stop',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 10 },
        },
        tokens_per_s: 40,
        content: 'done',
        reasoning: '',
        tool_calls: [],
      },
    } as RunEvent);
    runStore.applyEvent({
      seq: 5,
      t_ms: 1600,
      type: 'tool_started',
      data: { call: 1, id: 'a', name: 'calculator', args: {}, raw_args: '{}' },
    } as RunEvent);
    runStore.applyEvent({
      seq: 6,
      t_ms: 1900,
      type: 'tool_finished',
      data: {
        call: 1,
        id: 'a',
        name: 'calculator',
        ok: false,
        result: 'err',
        start_ms: 1600,
        end_ms: 1900,
        duration_ms: 300,
      },
    } as RunEvent);
    runStore.applyEvent({
      seq: 7,
      t_ms: 2000,
      type: 'run_finished',
      data: {
        status: 'completed',
        final_answer: 'ok',
        totals: {
          wall_ms: 2000,
          llm_ms: 1400,
          tool_ms: 300,
          overhead_ms: 300,
          llm_calls: 1,
          tool_calls: 1,
          tool_errors: 1,
          prompt_tokens: 100,
          completion_tokens: 50,
          reasoning_tokens: 10,
          cached_tokens: 40,
          cost: 0.0123,
          first_ttft_ms: 250,
        },
      },
    } as RunEvent);
    runStore.flushSync();

    render(<StatsStrip />);

    for (const label of [
      'Wall time',
      'LLM time',
      'Tool time',
      'Overhead',
      'First TTFT',
      'Avg speed',
      'Turns',
      'Tokens in',
      'Tokens out',
      'Cost',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    expect(screen.getByText('2.00s')).toBeTruthy(); // wall
    expect(screen.getByText('1.40s')).toBeTruthy(); // llm
    expect(screen.getByText('70% of wall')).toBeTruthy();
    expect(screen.getByText('harness + gaps')).toBeTruthy();
    expect(screen.getByText('250ms')).toBeTruthy(); // ttft
    expect(screen.getByText('headers at 120ms')).toBeTruthy();
    expect(screen.getByText('40 tok/s')).toBeTruthy();
    expect(screen.getByText('after first token')).toBeTruthy();
    expect(screen.getByText('1 tool calls, 1 failed')).toBeTruthy();
    expect(screen.getByText('40 cached')).toBeTruthy();
    expect(screen.getByText('10 reasoning')).toBeTruthy();
    expect(screen.getByText('$0.012')).toBeTruthy();
  });

  it('omits the cost tile when cost is null and shows dashes for missing values', () => {
    render(<StatsStrip />);
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('summed over turns')).toBeTruthy();
    expect(screen.getByText('0 tool calls')).toBeTruthy();
  });
});
