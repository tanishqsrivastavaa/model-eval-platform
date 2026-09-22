import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEvent, RunMeta } from '@/types/events';
import { runStore } from '../streamStore';
import { EventsTab } from './EventsTab';

function makeRun(): RunMeta {
  return {
    id: 'r1',
    created_at: 1700000000,
    provider: 'openai',
    model: 'gpt-4.1',
    prompt: 'events',
    config: {
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'events',
      system: '',
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

describe('EventsTab', () => {
  beforeEach(() => {
    runStore.reset(makeRun());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders rows with seq, fixed-1 t_ms, type and truncated data preview', () => {
    runStore.applyEvent({
      seq: 1,
      t_ms: 12.34,
      type: 'content_delta',
      data: { call: 1, text: 'x'.repeat(300) },
    } as RunEvent);
    runStore.applyEvent({
      seq: 2,
      t_ms: 40,
      type: 'error',
      data: { message: 'bad' },
    } as RunEvent);
    runStore.flushSync();

    const { container } = render(<EventsTab />);

    expect(screen.getByText('#')).toBeTruthy();
    expect(screen.getByText('t (ms)')).toBeTruthy();
    expect(screen.getByText('12.3')).toBeTruthy();
    expect(screen.getByText('40.0')).toBeTruthy();
    expect(screen.getByText('content_delta')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();

    const previews = container.querySelectorAll('tbody td:last-child');
    expect(previews).toHaveLength(2);
    expect(String(previews[0].textContent)).toHaveLength(241); // 240 chars + …
    expect(String(previews[0].textContent).endsWith('…')).toBe(true);
    expect(previews[1].textContent).toContain('"message":"bad"');
    expect(screen.getByText('error').className).toContain('text-fail');
  });
});
