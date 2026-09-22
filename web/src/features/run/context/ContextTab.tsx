/**
 * Context-sent tab — port of renderContext (app.js:398-432).
 * The tree is built only when selectContextKey changes (call count or
 * finished flag) — delta commits never re-render it. First request has no
 * "new" role highlights (improvement over legacy, which marked all of them).
 */
import { memo, type ReactNode, useRef } from 'react';
import { cn } from '@/components/cn';
import { fmtNum } from '@/lib/fmt';
import type { ChatMessage } from '@/types/events';
import { useContextKey } from '../hooks';
import { type CallSnapshot, type RunSnapshot, runStore } from '../streamStore';
import {
  blockPre,
  cardBase,
  cardBody,
  cardHead,
  cardMeta,
  cardTitle,
  summaryRow,
} from '../trace/cardStyles';
import { MetaItem } from '../trace/parts';

function buildRequests(snap: RunSnapshot): ReactNode[] {
  const calls = Object.values(snap.calls).sort((a, b) => a.n - b.n);
  let prevLen: number | null = null;

  return calls.map((c: CallSnapshot) => {
    const { messages = [], ...rest } = c.request ?? {};
    const toolsList = (rest.tools ?? []) as { function?: { name?: string } }[];
    const toolNames = toolsList.map((t) => t.function?.name);
    delete rest.tools;

    const rows = messages.map((m: ChatMessage, i: number) => {
      let body = m.content ?? '';
      if (m.tool_calls) {
        const lines = m.tool_calls
          .map((tc) => `→ ${tc.function.name}(${tc.function.arguments})`)
          .join('\n');
        body += (body ? '\n' : '') + lines;
      }
      const role = m.role + (m.tool_call_id ? `\n${m.tool_call_id}` : '');
      const isNew = prevLen !== null && i >= prevLen;
      return (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: request messages are immutable once sent
          key={i}
          data-testid="ctx-msg"
          className="grid grid-cols-[90px_1fr] gap-2.5 border-t border-hair py-1.5 first:border-t-0"
        >
          <div
            data-testid="ctx-role"
            className={cn(
              'font-mono text-[11.5px] whitespace-pre-wrap text-muted',
              isNew && 'text-accent',
            )}
          >
            {role}
          </div>
          <pre className="m-0 max-h-[240px] overflow-auto font-mono text-[12.5px] whitespace-pre-wrap break-words">
            {body}
          </pre>
        </div>
      );
    });
    prevLen = messages.length;

    const chars = JSON.stringify(messages).length;
    const tokIn = c.done?.usage?.prompt_tokens;

    return (
      <div key={c.n} className={`${cardBase} border-l-textstream`}>
        <div className={cardHead}>
          <span className={cardTitle}>{`Request #${c.n}`}</span>
          <span className={cardMeta}>
            <MetaItem label="messages" value={String(messages.length)} />
            <MetaItem label="size" value={`${fmtNum(chars)} chars`} />
            {tokIn != null ? <MetaItem label="prompt tokens" value={fmtNum(tokIn)} /> : null}
            <MetaItem label="tools" value={String(toolNames.length)} />
          </span>
        </div>
        <div className={cardBody}>
          <details>
            <summary className={summaryRow}>request parameters</summary>
            <pre className={blockPre}>{JSON.stringify(rest, null, 2)}</pre>
          </details>
          <div>{rows}</div>
        </div>
      </div>
    );
  });
}

export const ContextTab = memo(function ContextTab() {
  const contextKey = useContextKey();
  const cache = useRef<{ key: number; node: ReactNode[] } | null>(null);

  if (!cache.current || cache.current.key !== contextKey) {
    cache.current = { key: contextKey, node: buildRequests(runStore.getSnapshot()) };
  }

  return (
    <div data-testid="context-tab">
      <p className="mb-3 text-[12.5px] text-muted">
        Every turn re-sends the entire conversation. Highlighted roles are new since the previous
        request.
      </p>
      {cache.current.node}
    </div>
  );
});
