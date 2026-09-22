import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent, RunMeta } from '@/types/events';
import { runStore } from '../streamStore';
import { ContextTab } from './ContextTab';

function makeRun(): RunMeta {
  return {
    id: 'r1',
    created_at: 1700000000,
    provider: 'openai',
    model: 'gpt-4.1',
    prompt: 'ctx',
    config: {
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'ctx',
      system: 'sys',
      tools: [],
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

function callStarted(seq: number, call: number, messages: unknown[]): RunEvent {
  return {
    seq,
    t_ms: seq * 10,
    type: 'llm_call_started',
    data: { call, request: { messages, model: 'gpt-4.1', temperature: 0.2 } },
  } as RunEvent;
}

describe('ContextTab', () => {
  beforeEach(() => {
    runStore.reset(makeRun());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a request card per call with meta and request parameters', () => {
    runStore.applyEvent(callStarted(1, 1, [{ role: 'user', content: 'hello' }]));
    runStore.applyEvent(
      callStarted(2, 2, [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]),
    );

    runStore.flushSync();
    render(<ContextTab />);

    expect(screen.getByText('Request #1')).toBeTruthy();
    expect(screen.getByText('Request #2')).toBeTruthy();
    expect(screen.getAllByText('request parameters')).toHaveLength(2);
    expect(
      screen.getByText(
        'Every turn re-sends the entire conversation. Highlighted roles are new since the previous request.',
      ),
    ).toBeTruthy();

    const roles = screen.getAllByTestId('ctx-role');
    expect(roles).toHaveLength(3);
    // First request: no "new" highlights (improvement over legacy).
    expect(roles[0].className).not.toContain('text-accent');
    // Second request: only the appended message is highlighted.
    expect(roles[1].className).not.toContain('text-accent');
    expect(roles[2].className).toContain('text-accent');
  });

  it('shows tool_call_id on tool result roles and arrow lines for tool calls', () => {
    runStore.applyEvent(
      callStarted(1, 1, [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'calc', arguments: '{"n":1}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: '1' },
      ]),
    );

    runStore.flushSync();
    render(<ContextTab />);

    const roles = screen.getAllByTestId('ctx-role');
    expect(roles[0].textContent).toBe('assistant');
    expect(roles[1].textContent).toBe('tool\nc1');
    expect(screen.getByText('→ calc({"n":1})')).toBeTruthy();
  });
});
