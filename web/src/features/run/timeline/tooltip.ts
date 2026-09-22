/**
 * Tooltip text — exact port of tooltipText (app.js:249-271), reading the
 * RunSnapshot directly (calls/tools maps, s.now for open ends) instead of
 * the legacy module-level S. Line shapes, padEnd(10) segment rows and the
 * '—' fallbacks are byte-compatible with the legacy output.
 */
import { fmtMs } from '@/lib/fmt';
import type { RunSnapshot, SegKind } from '../streamStore';

export function tooltipText(s: RunSnapshot, kind: string, key: string): string {
  if (kind === 'llm') {
    const c = s.calls[Number(key)];
    if (!c) return '';
    const d = c.done;
    const end = c.end ?? s.now;
    const lines = [
      `LLM call #${c.n}`,
      `start       ${fmtMs(c.start)}`,
      `duration    ${fmtMs(end - c.start)}`,
      `headers     ${fmtMs(c.headers)}`,
      `TTFT        ${fmtMs(c.ttft)}`,
    ];
    const spans: Partial<Record<SegKind, number>> = {};
    c.segs.forEach((seg, i) => {
      spans[seg.kind] = (spans[seg.kind] ?? 0) + ((c.segs[i + 1]?.from ?? end) - seg.from);
    });
    for (const [k, v] of Object.entries(spans)) lines.push(`  ${k.padEnd(10)}${fmtMs(v)}`);
    if (d) {
      lines.push(
        `tokens      ${d.usage?.prompt_tokens ?? '?'} in / ${d.usage?.completion_tokens ?? '?'} out`,
      );
      if (d.tokens_per_s) lines.push(`speed       ${d.tokens_per_s} tok/s`);
      lines.push(`chunks      ${d.chunks}`, `finish      ${d.finish_reason ?? '—'}`);
    }
    return lines.join('\n');
  }
  const x = s.tools[key];
  if (!x) return '';
  return [
    `tool ${x.name}`,
    `start       ${fmtMs(x.start)}`,
    `duration    ${fmtMs((x.end ?? s.now) - x.start)}`,
    `status      ${x.end == null ? 'running' : x.ok ? 'ok' : 'error'}`,
  ].join('\n');
}
