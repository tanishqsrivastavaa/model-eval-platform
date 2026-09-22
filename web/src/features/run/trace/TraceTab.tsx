/**
 * Trace tab — ordered LLM/tool cards + error cards + final card
 * (port of renderTrace, app.js:351-396) with follow-live scroll
 * (app.js:392-395): when the trace grew while live and follow is on,
 * scroll the nearest overflow parent (AppShell's <main>) to the bottom.
 */
import { memo, useEffect, useRef } from 'react';
import { cn } from '@/components/cn';
import { fmtMs } from '@/lib/fmt';
import type { RunFinishedData } from '@/types/events';
import { useOrder, useRunSnapshot } from '../hooks';
import { blockPre, cardBase, cardBody, cardHead, cardMeta, cardTitle } from './cardStyles';
import { LlmCard } from './LlmCard';
import { MetaItem } from './parts';
import { ToolCard } from './ToolCard';

function findScrollParent(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start.parentElement;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    if (
      node.classList.contains('overflow-y-auto') ||
      node.classList.contains('overflow-y-scroll')
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return document.querySelector('main');
}

function ErrorCard({ index, message }: { index: number; message: string }) {
  return (
    <div id={`err-${index}`} className={`${cardBase} border-l-fail`}>
      <div className={cardHead}>
        <span className={cardTitle}>error</span>
      </div>
      <div className={cardBody}>
        <pre className={blockPre}>{message}</pre>
      </div>
    </div>
  );
}

const FINAL_FALLBACK: Record<string, string> = {
  max_turns: 'Stopped: hit the max-turns limit.',
  cancelled: 'Cancelled.',
  error: 'Run failed; see error above.',
};

function FinalCard({ finished }: { finished: RunFinishedData }) {
  return (
    <div id="card-final" className={`${cardBase} border-l-accent`}>
      <div className={cardHead}>
        <span className={cardTitle}>final answer</span>
        <span className={cardMeta}>
          <MetaItem label="status" value={finished.status} />
          <MetaItem label="wall" value={fmtMs(finished.totals.wall_ms)} />
        </span>
      </div>
      <div className={cardBody}>
        {finished.final_answer ? (
          <div className="text-[13px] whitespace-pre-wrap break-words text-fg">
            {finished.final_answer}
          </div>
        ) : (
          <div className="text-muted">{FINAL_FALLBACK[finished.status] ?? finished.status}</div>
        )}
      </div>
    </div>
  );
}

export interface TraceTabProps {
  follow: boolean;
}

export const TraceTab = memo(function TraceTab({ follow }: TraceTabProps) {
  const order = useOrder();
  const snapshot = useRunSnapshot();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!follow || !snapshot.live || !snapshot.grew) return;
    const root = rootRef.current;
    if (!root) return;
    const scroller = findScrollParent(root);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [snapshot, follow]);

  return (
    <div ref={rootRef} data-testid="trace">
      {order.map((item) =>
        item.kind === 'llm' ? (
          <LlmCard key={`llm-${item.key}`} n={item.key} />
        ) : (
          <ToolCard key={`tool-${item.key}`} toolKey={item.key} />
        ),
      )}
      {snapshot.errors.map((message, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: error messages are append-only
        <ErrorCard key={`err-${index}`} index={index} message={message} />
      ))}
      {snapshot.finished ? <FinalCard finished={snapshot.finished} /> : null}
      {order.length === 0 && !snapshot.finished && snapshot.errors.length === 0 ? (
        <p className={cn('py-6 text-center text-[13px] text-muted')}>Waiting for events…</p>
      ) : null}
    </div>
  );
});
