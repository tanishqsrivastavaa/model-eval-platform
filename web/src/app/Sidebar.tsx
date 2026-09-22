/**
 * Presentational sidebar — new-run form + history list.
 *
 * Contract for the features layer:
 *   import { Sidebar, type SidebarProps, type SidebarValues } from '@/app/Sidebar';
 *   Pass `providers`/`models`/`presets`/`tools`/`runs` from your store.
 *   Form fields are controlled via `values` + `onChange` (or uncontrolled with
 *   `defaultValues`). Wire `onSubmit(values)` to POST /api/runs and
 *   `onOpenRun(id)` to navigate. `busy` disables submit; `formError` renders
 *   under the button. Field `name` attributes match API body keys exactly.
 */
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/Button';
import { cn } from '@/components/cn';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/Field';
import { Panel } from '@/components/Panel';
import { type RunStatus, statusDotClass } from '@/components/Pill';

export interface SidebarOption {
  value: string;
  label: string;
}

export interface SidebarRunItem {
  id: string;
  model: string;
  prompt: string;
  status: RunStatus;
  time?: string;
}

export interface SidebarValues {
  provider: string;
  model: string;
  prompt: string;
  system: string;
  preset: string;
  tools: string[];
  max_turns: string;
  temperature: string;
  max_tokens: string;
  reasoning_effort: string;
  tool_delay_ms: string;
  tool_failure_rate: string;
}

export interface SidebarProps {
  providers?: SidebarOption[];
  models?: string[];
  presets?: SidebarOption[];
  tools?: SidebarOption[];
  modelHint?: string;
  runs?: SidebarRunItem[];
  activeId?: string | null;
  values?: SidebarValues;
  defaultValues?: Partial<SidebarValues>;
  onChange?: (values: SidebarValues) => void;
  onSubmit?: (values: SidebarValues) => void;
  onOpenRun?: (id: string) => void;
  formError?: string | null;
  busy?: boolean;
}

const DEFAULT_VALUES: SidebarValues = {
  provider: '',
  model: '',
  prompt: '',
  system: '',
  preset: '',
  tools: [],
  max_turns: '10',
  temperature: '',
  max_tokens: '',
  reasoning_effort: '',
  tool_delay_ms: '0',
  tool_failure_rate: '0',
};

function mergeValues(base: SidebarValues, patch: Partial<SidebarValues>): SidebarValues {
  return { ...base, ...patch };
}

export function Sidebar({
  providers = [],
  models = [],
  presets = [],
  tools = [],
  modelHint,
  runs = [],
  activeId = null,
  values: controlledValues,
  defaultValues,
  onChange,
  onSubmit,
  onOpenRun,
  formError,
  busy = false,
}: SidebarProps) {
  const [internalValues, setInternalValues] = useState<SidebarValues>(() =>
    mergeValues(DEFAULT_VALUES, defaultValues ?? {}),
  );

  const isControlled = controlledValues !== undefined;
  const current = isControlled ? mergeValues(DEFAULT_VALUES, controlledValues) : internalValues;

  const patch = (partial: Partial<SidebarValues>) => {
    const next = mergeValues(current, partial);
    if (!isControlled) setInternalValues(next);
    onChange?.(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (onSubmit) {
      onSubmit(current);
    } else if (import.meta.env.DEV) {
      console.warn('[Sidebar] onSubmit not wired — features layer must supply behavior');
    }
  };

  const toggleTool = (toolValue: string) => {
    const toolsSet = new Set(current.tools);
    if (toolsSet.has(toolValue)) toolsSet.delete(toolValue);
    else toolsSet.add(toolValue);
    patch({ tools: [...toolsSet] });
  };

  return (
    <div className="flex flex-1 flex-col gap-3.5" data-testid="sidebar">
      <Panel title="New run">
        <form onSubmit={handleSubmit} className="flex flex-col" data-testid="new-run-form">
          <Field label="Provider" htmlFor="provider" className="mb-2.5">
            <Select
              id="provider"
              name="provider"
              value={current.provider}
              onChange={(event) => patch({ provider: event.target.value })}
              required
            >
              <option value="">Select provider…</option>
              {providers.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Model"
            htmlFor="model"
            hint={modelHint ?? (models.length === 0 ? 'Waiting for provider meta…' : undefined)}
            className="mb-2.5"
          >
            <Input
              id="model"
              name="model"
              list="model-list"
              value={current.model}
              onChange={(event) => patch({ model: event.target.value })}
              placeholder="e.g. openai/gpt-4.1-mini"
              autoComplete="off"
              required
            />
            <datalist id="model-list">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </Field>

          <Field label="Preset" htmlFor="preset" className="mb-2.5">
            <Select
              id="preset"
              name="preset"
              value={current.preset}
              onChange={(event) => patch({ preset: event.target.value })}
            >
              <option value="">— custom —</option>
              {presets.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Prompt" htmlFor="prompt" className="mb-2.5">
            <Textarea
              id="prompt"
              name="prompt"
              rows={5}
              value={current.prompt}
              onChange={(event) => patch({ prompt: event.target.value })}
              placeholder="What should the agent do?"
              required
            />
          </Field>

          <details className="mb-2.5">
            <summary className="cursor-pointer py-0.5 text-[12px] text-fg-2 select-none hover:text-fg">
              Tools
            </summary>
            {tools.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-1">
                {tools.map((tool) => (
                  <label
                    key={tool.value}
                    htmlFor={`tool-${tool.value}`}
                    className="flex items-center gap-1.5 font-mono text-[12px] text-fg"
                  >
                    <Checkbox
                      id={`tool-${tool.value}`}
                      name="tools"
                      value={tool.value}
                      checked={current.tools.includes(tool.value)}
                      onChange={() => toggleTool(tool.value)}
                    />
                    {tool.label}
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted">No tools advertised yet.</p>
            )}
          </details>

          <details className="mb-2.5">
            <summary className="cursor-pointer py-0.5 text-[12px] text-fg-2 select-none hover:text-fg">
              System prompt
            </summary>
            <Textarea
              className="mt-2"
              id="system"
              name="system"
              rows={5}
              value={current.system}
              onChange={(event) => patch({ system: event.target.value })}
              placeholder="Optional system message"
            />
          </details>

          <details className="mb-3">
            <summary className="cursor-pointer py-0.5 text-[12px] text-fg-2 select-none hover:text-fg">
              Parameters &amp; experiments
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-2.5">
              <Field label="Max turns" htmlFor="max_turns" className="mb-2.5">
                <Input
                  id="max_turns"
                  name="max_turns"
                  type="number"
                  min={1}
                  max={50}
                  value={current.max_turns}
                  onChange={(event) => patch({ max_turns: event.target.value })}
                />
              </Field>
              <Field label="Temperature" htmlFor="temperature" className="mb-2.5">
                <Input
                  id="temperature"
                  name="temperature"
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  placeholder="default"
                  value={current.temperature}
                  onChange={(event) => patch({ temperature: event.target.value })}
                />
              </Field>
              <Field label="Max tokens" htmlFor="max_tokens" className="mb-2.5">
                <Input
                  id="max_tokens"
                  name="max_tokens"
                  type="number"
                  min={1}
                  placeholder="default"
                  value={current.max_tokens}
                  onChange={(event) => patch({ max_tokens: event.target.value })}
                />
              </Field>
              <Field label="Reasoning" htmlFor="reasoning_effort" className="mb-2.5">
                <Select
                  id="reasoning_effort"
                  name="reasoning_effort"
                  value={current.reasoning_effort}
                  onChange={(event) => patch({ reasoning_effort: event.target.value })}
                >
                  <option value="">default</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </Select>
              </Field>
              <Field label="Tool delay ms" htmlFor="tool_delay_ms" className="mb-2.5">
                <Input
                  id="tool_delay_ms"
                  name="tool_delay_ms"
                  type="number"
                  min={0}
                  value={current.tool_delay_ms}
                  onChange={(event) => patch({ tool_delay_ms: event.target.value })}
                />
              </Field>
              <Field label="Tool fail rate" htmlFor="tool_failure_rate" className="mb-2.5">
                <Input
                  id="tool_failure_rate"
                  name="tool_failure_rate"
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={current.tool_failure_rate}
                  onChange={(event) => patch({ tool_failure_rate: event.target.value })}
                />
              </Field>
            </div>
          </details>

          <Button type="submit" variant="primary" loading={busy} className="w-full">
            Run agent
          </Button>

          {formError ? (
            <div
              role="alert"
              className="mt-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-fail"
            >
              {formError}
            </div>
          ) : null}
        </form>
      </Panel>

      <Panel title="History" className="min-h-[120px] flex-1">
        {runs.length === 0 ? (
          <p className="py-1 text-[12px] text-muted">No runs yet.</p>
        ) : (
          <ul className="flex list-none flex-col gap-0.5 p-0" data-testid="history-list">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onOpenRun?.(run.id)}
                  aria-current={run.id === activeId ? 'true' : undefined}
                  className={cn(
                    'grid w-full grid-cols-[8px_1fr_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-[7px]',
                    'text-left transition-colors duration-150 hover:bg-raised',
                    run.id === activeId && 'bg-raised ring-1 ring-hair-strong',
                  )}
                >
                  <i
                    aria-hidden
                    className={cn(
                      'size-2 rounded-full',
                      statusDotClass[run.status],
                      run.status === 'running' && 'pulse-live',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12px] text-fg">
                      {run.model}
                    </span>
                    <span className="block truncate text-[12px] text-muted">{run.prompt}</span>
                  </span>
                  <span className="font-mono text-[11px] whitespace-nowrap text-muted">
                    {run.time ?? run.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
