import { describe, expect, it } from 'vitest';
import type { SidebarValues } from '@/app/Sidebar';
import { buildRunBody } from './buildRunBody';

const base: SidebarValues = {
  provider: 'openai',
  model: '  gpt-4.1-mini  ',
  prompt: 'do the thing',
  system: 'you are cool',
  preset: '2',
  tools: ['calc', 'run_python'],
  max_turns: '15',
  temperature: '0.7',
  max_tokens: '2048',
  reasoning_effort: 'high',
  tool_delay_ms: '250',
  tool_failure_rate: '0.25',
};

describe('buildRunBody', () => {
  it('24. coerces numbers, trims model, passes tools, drops preset', () => {
    const body = buildRunBody(base, ['calc', 'run_python', 'fetch']);
    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      prompt: 'do the thing',
      system: 'you are cool',
      tools: ['calc', 'run_python'],
      max_turns: 15,
      temperature: 0.7,
      max_tokens: 2048,
      reasoning_effort: 'high',
      tool_delay_ms: 250,
      tool_failure_rate: 0.25,
    });
    expect('preset' in body).toBe(false);
  });

  it("24b. '' optionals → null, defaults max_turns 10 / delay 0 / failure 0", () => {
    const body = buildRunBody(
      {
        ...base,
        temperature: '',
        max_tokens: '',
        max_turns: '',
        reasoning_effort: '',
        tool_delay_ms: '',
        tool_failure_rate: '',
      },
      ['calc'],
    );
    expect(body.temperature).toBeNull();
    expect(body.max_tokens).toBeNull();
    expect(body.max_turns).toBe(10);
    expect(body.reasoning_effort).toBeNull();
    expect(body.tool_delay_ms).toBe(0);
    expect(body.tool_failure_rate).toBe(0);
  });

  it('24c. empty tools falls back to all', () => {
    const body = buildRunBody({ ...base, tools: [] }, ['a', 'b']);
    expect(body.tools).toEqual(['a', 'b']);
    const none = buildRunBody({ ...base, tools: [] });
    expect(none.tools).toEqual([]);
  });
});
