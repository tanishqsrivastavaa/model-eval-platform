/**
 * LLM call card — port of llmCard/patchLlmCard (app.js:276-323).
 * Memoized; only re-renders when its own useCallCard view changes.
 * The thinking <details> is uncontrolled (static `open` applied once at
 * mount) so user closes are never fought by re-renders.
 */
import { memo } from 'react';
import { fmtMs, pretty } from '@/lib/fmt';
import { useCallCard } from '../hooks';
import { type CallSnapshot, runStore } from '../streamStore';
import {
  blockPre,
  callChip,
  cardBase,
  cardBody,
  cardHead,
  cardMeta,
  cardTitle,
  sectLabel,
  summaryRow,
} from './cardStyles';
import { Cursor, MetaItem } from './parts';

function unwrap(view: ReturnType<typeof useCallCard>): { call: CallSnapshot; now: number } | null {
  if (!view) return null;
  if ('now' in view) return { call: view.call, now: view.now };
  return { call: view, now: view.end ?? runStore.getSnapshot().lastT };
}

export const LlmCard = memo(function LlmCard({ n }: { n: number }) {
  const view = useCallCard(n);
  const unwrapped = unwrap(view);
  if (!unwrapped) return null;

  const { call: c, now: t } = unwrapped;
  const d = c.done;
  const streaming = d == null;
  const lastSeg = c.segs[c.segs.length - 1]?.kind;

  let waiting: string | null = null;
  if (c.ttft == null) waiting = streaming ? 'waiting for first token…' : '(empty response)';

  return (
    <div id={`card-llm-${c.n}`} className={`${cardBase} border-l-textstream`}>
      <div className={cardHead}>
        <span className={cardTitle}>{`LLM call #${c.n}`}</span>
        <span className={cardMeta}>
          <MetaItem label="took" value={fmtMs((c.end ?? t) - c.start)} />
          <MetaItem label="TTFT" value={fmtMs(c.ttft)} />
          {d?.tokens_per_s ? <MetaItem label="speed" value={`${d.tokens_per_s} tok/s`} /> : null}
          {d?.usage?.prompt_tokens != null ? (
            <MetaItem
              label="tokens"
              value={`${d.usage.prompt_tokens}→${d.usage.completion_tokens}`}
            />
          ) : null}
          {d ? (
            <MetaItem label="finish" value={d.finish_reason ?? '—'} />
          ) : (
            <MetaItem label="" value="streaming…" />
          )}
        </span>
      </div>
      <div className={cardBody}>
        {waiting ? <div className="font-mono text-[12.5px] text-muted">{waiting}</div> : null}

        {c.reasoning ? (
          <details open>
            <summary className={summaryRow}>thinking</summary>
            <pre
              className={`${blockPre} italic text-[color-mix(in_srgb,var(--stream-think)_70%,var(--fg))]`}
            >
              {c.reasoning}
              {streaming && lastSeg === 'think' ? <Cursor /> : null}
            </pre>
          </details>
        ) : null}

        {c.content ? (
          <div>
            <div className={sectLabel}>text output</div>
            <div className="text-[13px] whitespace-pre-wrap break-words text-fg">
              {c.content}
              {streaming && lastSeg === 'text' ? <Cursor /> : null}
            </div>
          </div>
        ) : null}

        {c.tcs.length > 0 ? (
          <div>
            <div className={sectLabel}>tool calls requested</div>
            <div className="flex flex-col gap-1.5">
              {c.tcs.map((tc) => (
                <div key={tc.index} className={callChip}>
                  {`${tc.name}(${streaming ? tc.args : pretty(tc.args)})`}
                  {streaming ? <Cursor /> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
