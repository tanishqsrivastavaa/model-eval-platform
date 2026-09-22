/**
 * Run detail page — header, stats strip, timeline panel + legend, and the
 * Trace / Context sent / Raw events tabs with follow-live scroll.
 * Opens the SSE stream via openRunStream; GET failures surface as a toast
 * plus an error panel (E3).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { AppShell } from '@/app/AppShell';
import { Button } from '@/components/Button';
import { cn } from '@/components/cn';
import { Checkbox } from '@/components/Field';
import { Panel } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import { type TabItem, Tabs } from '@/components/Tabs';
import { useToast } from '@/components/Toast';
import { refreshHistory } from '@/features/history/historyStore';
import { ConnectedSidebar } from '@/features/home/ConnectedSidebar';
import { cancelRun } from '@/lib/api';
import { ContextTab } from './context/ContextTab';
import { EventsTab } from './events/EventsTab';
import { useLive, useRunSnapshot, useStatus } from './hooks';
import { StatsStrip } from './stats/StatsStrip';
import { Timeline } from './timeline/Timeline';
import { TraceTab } from './trace/TraceTab';
import { openRunStream, type RunStreamHandle } from './useRunStream';

const LEGEND = [
  { cls: 'bg-wait', label: 'waiting' },
  { cls: 'bg-think', label: 'thinking' },
  { cls: 'bg-textstream', label: 'text' },
  { cls: 'bg-args', label: 'tool args' },
  { cls: 'bg-tool', label: 'tool exec' },
  { cls: 'bg-fail', label: 'tool error' },
] as const;

function TimelineLegend() {
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
      {LEGEND.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1">
          <i aria-hidden className={cn('size-2.5 rounded-[2px]', item.cls)} />
          {item.label}
        </span>
      ))}
    </span>
  );
}

function RunView({ id }: { id: string }) {
  const { error: showError } = useToast();
  const snapshot = useRunSnapshot();
  const status = useStatus();
  const live = useLive();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState('trace');
  const [follow, setFollow] = useState(true);
  const [flashNonce, setFlashNonce] = useState(0);
  const pendingActivate = useRef<{ kind: string; key: string | number } | null>(null);

  useEffect(() => {
    if (!id) return undefined;
    let disposed = false;
    let handle: RunStreamHandle | null = null;
    setLoadError(null);
    void openRunStream(id, {
      onFinished: () => {
        void refreshHistory();
      },
    })
      .then((h) => {
        if (disposed) {
          h.close();
          return;
        }
        if (h.error) {
          setLoadError(h.error);
          showError('Failed to open run', h.error);
        } else {
          handle = h;
          void refreshHistory();
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      handle?.close();
    };
  }, [id, showError]);

  const scrollToCard = useCallback((kind: string, key: string | number) => {
    pendingActivate.current = { kind, key };
    setTab('trace');
    setFlashNonce((n) => n + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tab/flashNonce re-run the pending card activation after switch/paint
  useEffect(() => {
    const target = pendingActivate.current;
    if (!target) return;
    pendingActivate.current = null;
    const el = document.getElementById(`card-${target.kind}-${target.key}`);
    if (!el) return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
    if (typeof el.animate === 'function') {
      el.animate([{ backgroundColor: 'var(--raised)' }, { backgroundColor: 'var(--panel)' }], {
        duration: 1000,
        easing: 'ease-out',
      });
    }
  }, [tab, flashNonce]);

  const run = snapshot.run;
  const loaded = run?.id === id;

  const tabs = useMemo<TabItem[]>(
    () => [
      { id: 'trace', label: 'Trace', content: <TraceTab follow={follow} /> },
      { id: 'context', label: 'Context sent', content: <ContextTab /> },
      { id: 'events', label: 'Raw events', content: <EventsTab /> },
    ],
    [follow],
  );

  if (loadError) {
    return (
      <Panel title="Run unavailable" data-testid="run-load-error">
        <p className="text-[13px] whitespace-pre-wrap text-fg-2">{loadError}</p>
        <p className="mt-2 text-[12.5px] text-muted">
          The run could not be loaded. Check that the server is running and the id is correct.
        </p>
      </Panel>
    );
  }

  if (!loaded) {
    return (
      <Panel title="Run" data-testid="run-loading">
        <p className="py-4 text-center text-[13px] text-muted">Loading run…</p>
      </Panel>
    );
  }

  return (
    <>
      <header className="mb-3.5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[16px] font-medium text-fg">
            {run?.model} <span className="text-muted">via {run?.provider}</span>
          </div>
          <div className="mt-1 max-h-[4.5em] overflow-hidden text-[13px] whitespace-pre-wrap text-fg-2">
            {run?.prompt}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill status={status} />
          {live ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void cancelRun(id).catch(() => undefined);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </header>

      <StatsStrip />

      <Panel title="Timeline" actions={<TimelineLegend />}>
        <Timeline onActivate={(kind, key) => scrollToCard(kind, key)} />
      </Panel>

      <div className="relative mt-[18px] mb-2.5">
        <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Run views" />
        <label
          htmlFor="follow-live"
          className="absolute top-2 right-0 z-10 flex cursor-pointer items-center gap-1.5 text-[12px] text-muted select-none"
        >
          <Checkbox
            id="follow-live"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          follow live
        </label>
      </div>
    </>
  );
}

export default function RunPage() {
  const { id } = useParams();
  const runId = id ?? '';

  return (
    <AppShell sidebar={<ConnectedSidebar activeId={id ?? null} />}>
      <RunView id={runId} />
    </AppShell>
  );
}
