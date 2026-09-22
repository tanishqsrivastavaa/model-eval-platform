/**
 * Tool execution card — port of toolCard/patchToolCard (app.js:325-349).
 * Memoized; re-renders only via its own useToolCard view.
 */
import { memo } from 'react';
import { fmtMs } from '@/lib/fmt';
import { useToolCard } from '../hooks';
import { runStore, type ToolSnapshot } from '../streamStore';
import {
  blockPre,
  cardBase,
  cardBody,
  cardHead,
  cardMeta,
  cardTitle,
  sectLabel,
} from './cardStyles';
import { Cursor, MetaItem } from './parts';

function unwrap(view: ReturnType<typeof useToolCard>): { tool: ToolSnapshot; now: number } | null {
  if (!view) return null;
  // ToolSnapshot has its own `call` field, so discriminate on the wrapper's `now`.
  if ('now' in view) return { tool: view.call, now: view.now };
  return { tool: view, now: view.end ?? runStore.getSnapshot().lastT };
}

export const ToolCard = memo(function ToolCard({ toolKey }: { toolKey: string }) {
  const view = useToolCard(toolKey);
  const unwrapped = unwrap(view);
  if (!unwrapped) return null;

  const { tool: x, now: t } = unwrapped;
  const running = x.end == null;
  const failed = !running && x.ok === false;
  const argsText = x.args != null ? JSON.stringify(x.args, null, 2) : x.raw_args;

  return (
    <div
      id={`card-tool-${x.key}`}
      className={`${cardBase} ml-6 ${failed ? 'border-l-fail' : 'border-l-tool'}`}
    >
      <div className={cardHead}>
        <span className={cardTitle}>{`⚙ ${x.name}`}</span>
        <span className={cardMeta}>
          <MetaItem label="took" value={fmtMs((x.end ?? t) - x.start)} />
          <MetaItem label="status" value={running ? 'running…' : x.ok ? 'ok' : 'error'} />
          <MetaItem label="at" value={fmtMs(x.start)} />
        </span>
      </div>
      <div className={cardBody}>
        <div>
          <div className={sectLabel}>arguments</div>
          <pre className={blockPre}>{argsText}</pre>
        </div>
        <div>
          <div className={sectLabel}>result</div>
          <pre className={blockPre}>
            {x.result ?? ''}
            {running ? <Cursor /> : null}
          </pre>
        </div>
      </div>
    </div>
  );
});
