import type { ReactNode } from 'react';
import { cn } from './cn';

interface TraceRow {
  label: string;
  color: string;
  width: string;
  delay: string;
}

const TRACE_ROWS: TraceRow[] = [
  { label: 'model.think', color: 'bg-think', width: '72%', delay: '0s' },
  { label: 'tool.args', color: 'bg-args', width: '48%', delay: '0.5s' },
  { label: 'tool.exec', color: 'bg-tool', width: '60%', delay: '1s' },
  { label: 'model.text', color: 'bg-textstream', width: '84%', delay: '1.5s' },
];

const CHECKLIST: { title: string; detail: ReactNode }[] = [
  {
    title: 'Add an API key',
    detail: (
      <>
        Put <code className="kbd mx-0.5 h-auto px-1 py-0.5">OPENAI_API_KEY</code> or{' '}
        <code className="kbd mx-0.5 h-auto px-1 py-0.5">OPENROUTER_API_KEY</code> in{' '}
        <code className="kbd mx-0.5 h-auto px-1 py-0.5">.env</code>
      </>
    ),
  },
  { title: 'Pick a provider & model', detail: 'Both dropdowns populate once the API is up.' },
  { title: 'Run the agent', detail: 'Tokens, tool calls and timings stream in live.' },
];

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['⌘', 'K'], label: 'command palette' },
  { keys: ['⌘', '↵'], label: 'new run' },
  { keys: ['↑', '↓'], label: 'browse history' },
];

export interface EmptyStateProps {
  className?: string;
}

export function EmptyState({ className }: EmptyStateProps) {
  return (
    <div className={cn('mx-auto flex w-full max-w-[640px] flex-col gap-8 pt-[7vh]', className)}>
      <header className="anim-enter flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <i aria-hidden className="pulse-live size-1.5 rounded-full bg-accent" />
          <span className="label text-accent">listening</span>
        </div>
        <h1 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-fg">
          Watch a model work.
        </h1>
        <p className="max-w-[48ch] text-[14px] leading-relaxed text-fg-2">
          Pick a provider and model, give it a task, and every token, tool call and millisecond
          streams in here as it happens.
        </p>
      </header>

      <section
        className="anim-enter rounded-[var(--radius)] border border-hair bg-panel p-3"
        style={{ animationDelay: '60ms' }}
        aria-label="Sample trace"
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="label text-fg-2">sample trace</h2>
          <span className="font-mono text-[11px] text-muted">4s loop</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {TRACE_ROWS.map((row) => (
            <div key={row.label} className="grid grid-cols-[96px_1fr] items-center gap-2">
              <span className="truncate font-mono text-[11px] text-muted">{row.label}</span>
              <div className="relative h-4 overflow-hidden rounded-[3px] bg-inset">
                <div
                  className={cn('trace-bar absolute inset-y-1 left-0 rounded-[2px]', row.color)}
                  style={
                    {
                      '--w': row.width,
                      animationDelay: row.delay,
                    } as React.CSSProperties
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="anim-enter flex flex-col gap-3" style={{ animationDelay: '120ms' }}>
        <h2 className="label">get started</h2>
        <ol className="flex flex-col gap-2.5">
          {CHECKLIST.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[28px_1fr] items-baseline gap-2">
              <span className="font-mono text-[12px] tabular-nums text-accent">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <div className="text-[13.5px] font-medium text-fg">{step.title}</div>
                <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{step.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer
        className="anim-enter flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hair pt-4"
        style={{ animationDelay: '160ms' }}
      >
        {SHORTCUTS.map((shortcut) => (
          <span key={shortcut.label} className="flex items-center gap-1.5 text-[12px] text-muted">
            {shortcut.keys.map((key) => (
              <kbd key={key} className="kbd">
                {key}
              </kbd>
            ))}
            {shortcut.label}
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted">planned</span>
      </footer>
    </div>
  );
}
