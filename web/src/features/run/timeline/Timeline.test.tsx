/**
 * Timeline component tests — render contract, hit/tooltip port fidelity,
 * activation keys (card id match), keyboard navigation, wheel/dblclick
 * no-throw, empty-state axis-only.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunMeta } from '@/types/events';
import { runStore } from '../streamStore';
import { Timeline } from './Timeline';
import { clampView, zoomAt } from './view';

function makeRun(): RunMeta {
  return {
    id: 'r1',
    created_at: 1700000000,
    provider: 'openai',
    model: 'gpt-4.1',
    prompt: 'timeline',
    config: {
      provider: 'openai',
      model: 'gpt-4.1',
      prompt: 'timeline',
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

function seedFinished(): void {
  runStore.reset(makeRun());
  const events: RunEvent[] = [
    { seq: 1, t_ms: 0, type: 'run_started', data: {} } as RunEvent,
    {
      seq: 2,
      t_ms: 10,
      type: 'llm_call_started',
      data: { call: 1, request: { messages: [] } },
    } as RunEvent,
    { seq: 3, t_ms: 120, type: 'llm_headers', data: { call: 1, ms: 110 } } as RunEvent,
    { seq: 4, t_ms: 250, type: 'llm_first_token', data: { call: 1, ttft_ms: 240 } } as RunEvent,
    {
      seq: 5,
      t_ms: 300,
      type: 'content_delta',
      data: { call: 1, text: 'hi' },
    } as RunEvent,
    {
      seq: 6,
      t_ms: 1400,
      type: 'llm_call_finished',
      data: {
        call: 1,
        start_ms: 10,
        end_ms: 1400,
        duration_ms: 1390,
        ttft_ms: 240,
        marks: {},
        chunks: 3,
        finish_reason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        tokens_per_s: 40,
        content: 'hi',
        reasoning: '',
        tool_calls: [],
      },
    } as RunEvent,
    {
      seq: 7,
      t_ms: 1500,
      type: 'tool_started',
      data: { call: 1, id: 'a', name: 'calculator', args: {}, raw_args: '{}' },
    } as RunEvent,
    {
      seq: 8,
      t_ms: 1800,
      type: 'tool_finished',
      data: {
        call: 1,
        id: 'a',
        name: 'calculator',
        ok: false,
        result: 'boom',
        start_ms: 1500,
        end_ms: 1800,
        duration_ms: 300,
      },
    } as RunEvent,
    {
      seq: 9,
      t_ms: 2000,
      type: 'run_finished',
      data: {
        status: 'completed',
        final_answer: 'x',
        totals: {
          wall_ms: 2000,
          llm_ms: 1390,
          tool_ms: 300,
          overhead_ms: 310,
          llm_calls: 1,
          tool_calls: 1,
          tool_errors: 1,
          prompt_tokens: 10,
          completion_tokens: 5,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cost: null,
          first_ttft_ms: 240,
        },
      },
    } as RunEvent,
  ];
  for (const ev of events) runStore.applyEvent(ev);
  runStore.flushSync();
}

function seedEmpty(): void {
  runStore.reset(makeRun());
  runStore.flushSync();
}

beforeAll(() => {
  // jsdom has no 2D canvas — keep getContext quiet and return null (draw no-ops).
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => null,
  });
});

describe('Timeline', () => {
  beforeEach(() => {
    seedFinished();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the viewport, gutter labels and the text fallback', () => {
    render(<Timeline />);
    expect(screen.getByLabelText('Timeline')).toBeTruthy();
    expect(screen.getByTestId('timeline-spacer')).toBeTruthy();
    expect(screen.getByText('LLM #1')).toBeTruthy();
    expect(screen.getByText('↳ calculator')).toBeTruthy();
    expect(screen.getByText('Timeline as text')).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBe(2);
  });

  it('renders axis-only with an empty fallback list when the store is empty', () => {
    seedEmpty();
    render(<Timeline />);
    expect(screen.getByLabelText('Timeline')).toBeTruthy();
    expect(screen.getByText('Timeline as text')).toBeTruthy();
    expect(screen.queryByText('LLM #1')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('timeline-spacer').style.height).toBe('23px');
  });

  it('activates rows from the text fallback with card-matching keys', () => {
    const onActivate = vi.fn();
    render(<Timeline onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button', { name: /LLM #1/ }));
    expect(onActivate).toHaveBeenLastCalledWith('llm', '1');
    fireEvent.click(screen.getByRole('button', { name: /calculator/ }));
    expect(onActivate).toHaveBeenLastCalledWith('tool', '1:a');
  });

  it('activates a row on pointer click (gutter included) and ignores empty rows', () => {
    const onActivate = vi.fn();
    render(<Timeline onActivate={onActivate} />);
    const vp = screen.getByLabelText('Timeline');

    // row 0 (LLM): y = axisH(23) + 0 + 5
    fireEvent.pointerDown(vp, { clientX: 40, clientY: 28, button: 0, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 40, clientY: 28, button: 0, pointerId: 1 });
    expect(onActivate).toHaveBeenLastCalledWith('llm', '1');

    // row 1 (tool): y = 23 + 24 + 5
    fireEvent.pointerDown(vp, { clientX: 12, clientY: 52, button: 0, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 12, clientY: 52, button: 0, pointerId: 1 });
    expect(onActivate).toHaveBeenLastCalledWith('tool', '1:a');

    // past the last row — no activation
    onActivate.mockClear();
    fireEvent.pointerDown(vp, { clientX: 40, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 40, clientY: 300, button: 0, pointerId: 1 });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not activate when the pointer moved ≥3px (drag = pan, not click)', () => {
    const onActivate = vi.fn();
    render(<Timeline onActivate={onActivate} />);
    const vp = screen.getByLabelText('Timeline');
    fireEvent.pointerDown(vp, { clientX: 40, clientY: 28, button: 0, pointerId: 1 });
    fireEvent.pointerMove(vp, { clientX: 80, clientY: 28, pointerId: 1 });
    fireEvent.pointerUp(vp, { clientX: 80, clientY: 28, button: 0, pointerId: 1 });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('shows the ported LLM tooltip on pointermove over a row', () => {
    render(<Timeline />);
    const vp = screen.getByLabelText('Timeline');
    fireEvent.pointerMove(vp, { clientX: 80, clientY: 30, pointerId: 1 });
    const tip = screen.getByTestId('timeline-tooltip');
    expect(tip.hidden).toBe(false);
    const text = tip.textContent ?? '';
    expect(text).toContain('LLM call #1');
    expect(text).toContain('start       10ms');
    expect(text).toContain('duration    1.39s');
    expect(text).toContain('headers     110ms');
    expect(text).toContain('TTFT        240ms');
    expect(text).toContain('wait');
    expect(text).toContain('text');
    expect(text).toContain('tokens      10 in / 5 out');
    expect(text).toContain('speed       40 tok/s');
    expect(text).toContain('chunks      3');
    expect(text).toContain('finish      stop');
  });

  it('shows the ported tool tooltip and hides it on axis/leave', () => {
    render(<Timeline />);
    const vp = screen.getByLabelText('Timeline');
    const tip = screen.getByTestId('timeline-tooltip');

    fireEvent.pointerMove(vp, { clientX: 80, clientY: 54, pointerId: 1 });
    const text = tip.textContent ?? '';
    expect(tip.hidden).toBe(false);
    expect(text).toContain('tool calculator');
    expect(text).toContain('start       1.50s');
    expect(text).toContain('duration    300ms');
    expect(text).toContain('status      error');

    // axis band (y < axisH) → hidden
    fireEvent.pointerMove(vp, { clientX: 80, clientY: 10, pointerId: 1 });
    expect(tip.hidden).toBe(true);

    // leave the viewport → hidden
    fireEvent.pointerMove(vp, { clientX: 80, clientY: 30, pointerId: 1 });
    expect(tip.hidden).toBe(false);
    fireEvent.pointerLeave(vp);
    expect(tip.hidden).toBe(true);
  });

  it('navigates with the keyboard: arrows select+announce, Enter activates', () => {
    const onActivate = vi.fn();
    render(<Timeline onActivate={onActivate} />);
    const vp = screen.getByLabelText('Timeline');
    const live = screen.getByTestId('timeline-live');

    fireEvent.keyDown(vp, { key: 'ArrowDown' });
    expect(live.textContent).toContain('LLM #1');
    fireEvent.keyDown(vp, { key: 'Enter' });
    expect(onActivate).toHaveBeenLastCalledWith('llm', '1');

    fireEvent.keyDown(vp, { key: 'ArrowDown' });
    expect(live.textContent).toContain('calculator');
    fireEvent.keyDown(vp, { key: ' ' });
    expect(onActivate).toHaveBeenLastCalledWith('tool', '1:a');

    fireEvent.keyDown(vp, { key: 'End' });
    expect(live.textContent).toContain('calculator');
    fireEvent.keyDown(vp, { key: 'Home' });
    expect(live.textContent).toContain('LLM #1');

    // wrap-free clamp at the top
    fireEvent.keyDown(vp, { key: 'ArrowUp' });
    expect(live.textContent).toContain('LLM #1');
  });

  it('handles wheel zoom, pan keys, zoom keys, 0 and dblclick without throwing', () => {
    render(<Timeline />);
    const vp = screen.getByLabelText('Timeline');
    expect(() => {
      fireEvent.wheel(vp, { deltaY: -120, clientX: 300, clientY: 40 });
      fireEvent.wheel(vp, { deltaY: 240, clientX: 300, clientY: 40 });
      fireEvent.keyDown(vp, { key: 'ArrowLeft' });
      fireEvent.keyDown(vp, { key: 'ArrowRight' });
      fireEvent.keyDown(vp, { key: '+' });
      fireEvent.keyDown(vp, { key: '-' });
      fireEvent.keyDown(vp, { key: '0' });
      fireEvent.dblClick(vp, { clientX: 100, clientY: 40 });
    }).not.toThrow();

    // still interactive after the view gymnastics
    fireEvent.pointerMove(vp, { clientX: 80, clientY: 30, pointerId: 1 });
    expect(screen.getByTestId('timeline-tooltip').textContent).toContain('LLM call #1');
  });
});

describe('view math (clamp/zoom)', () => {
  const fit = { t0: 0, t1: 1000 };

  it('clamps span to [1ms, fitSpan] and t0 to [0, fitT1-span]', () => {
    expect(clampView({ t0: -50, t1: 2000 }, fit)).toEqual({ t0: 0, t1: 1000 });
    // span floor of 1ms lifts {900, 900.5} → {900, 901}
    expect(clampView({ t0: 900, t1: 900.5 }, fit)).toEqual({ t0: 900, t1: 901 });
    const zoomed = clampView({ t0: 100, t1: 300 }, fit);
    expect(zoomed).toEqual({ t0: 100, t1: 300 });
    expect(clampView({ t0: 950, t1: 1050 }, fit)).toEqual({ t0: 900, t1: 1000 });
  });

  it('zoomAt keeps the cursor-anchored time fixed and clamps to fit', () => {
    // frac 0.5 at t=500; k=2 → span 2000 → clamped to fitSpan 1000, t0=0
    const out = zoomAt({ t0: 0, t1: 1000 }, fit, 0.5, 2);
    expect(out.t1 - out.t0).toBeLessThanOrEqual(1000);
    // frac 0.25, k=0.5 → span 500, anchor=250 → t0 = 250 - 0.25*500 = 125
    expect(zoomAt({ t0: 0, t1: 1000 }, fit, 0.25, 0.5)).toEqual({ t0: 125, t1: 625 });
  });
});
