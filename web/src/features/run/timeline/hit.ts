/**
 * Pointer → timeline row resolution and key canonicalization. Shared by
 * hover/tooltip and drag-click activation. Port of the legacy
 * e.target.closest('.tl-row') hit (app.js:540-541) for the virtualized
 * canvas: y is viewport-local, rows sit at axisH + i*rowH under scrollTop.
 * x is intentionally unconstrained so gutter clicks hit too (spec §5).
 */
import type { TimelineRow } from '../selectors';
import type { Metrics } from './layout';
import { rowFromPoint } from './layout';

export function hitRow(y: number, scrollTop: number, rowCount: number, m: Metrics): number | null {
  return rowFromPoint(y, scrollTop, rowCount, m);
}

/** Activation key: llm → String(n), tool → `${call}:${id}` (card ids). */
export function rowKeyString(row: TimelineRow): string {
  return String(row.key);
}
