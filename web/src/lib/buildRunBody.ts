/**
 * SidebarValues → POST /api/runs body — port of static/app.js:497-504.
 * Number coercion, ''→null optionals, defaults max_turns 10 /
 * tool_delay_ms 0 / tool_failure_rate 0, model.trim(),
 * reasoning_effort ''→null, tools from values.tools or all.
 */
import type { SidebarValues } from '@/app/Sidebar';
import type { RunConfigPayload } from '@/types/events';

export function buildRunBody(
  values: SidebarValues,
  allTools: readonly string[] = [],
): RunConfigPayload {
  const num = (k: keyof SidebarValues): number | null => {
    const raw = values[k];
    return raw === '' || raw == null ? null : Number(raw);
  };
  return {
    provider: values.provider,
    model: values.model.trim(),
    prompt: values.prompt,
    system: values.system,
    tools: values.tools.length > 0 ? [...values.tools] : [...allTools],
    max_turns: num('max_turns') ?? 10,
    temperature: num('temperature'),
    max_tokens: num('max_tokens'),
    reasoning_effort: values.reasoning_effort || null,
    tool_delay_ms: num('tool_delay_ms') ?? 0,
    tool_failure_rate: num('tool_failure_rate') ?? 0,
  };
}
