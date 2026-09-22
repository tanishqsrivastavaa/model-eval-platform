/**
 * Timeline geometry — port of the legacy CSS metrics (style.css:112-124)
 * and the 860px gutter swap (style.css:168): 150px gutter normally, 96px
 * on narrow viewports. All canvas math and DOM label placement derives
 * from these constants so the two never drift apart.
 */

export const AXIS_H = 23;
export const ROW_H = 24;
export const BAR_TOP = 5;
export const BAR_H = 14;
export const RADIUS = 3;
export const MIN_BAR_W = 2;
export const TOOL_INDENT = 14;
export const GUTTER_WIDE = 150;
export const GUTTER_NARROW = 96;
export const MAX_VIEWPORT_H = 360;
export const NARROW_MQ = '(max-width: 860px)';

export interface Metrics {
  gutter: number;
  axisH: number;
  rowH: number;
  barTop: number;
  barH: number;
  radius: number;
  minBarW: number;
  toolIndent: number;
}

export function makeMetrics(gutter: number): Metrics {
  return {
    gutter,
    axisH: AXIS_H,
    rowH: ROW_H,
    barTop: BAR_TOP,
    barH: BAR_H,
    radius: RADIUS,
    minBarW: MIN_BAR_W,
    toolIndent: TOOL_INDENT,
  };
}

/** Narrow-viewport gutter (96 when innerWidth ≤ 860, else 150). */
export function readGutter(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return GUTTER_WIDE;
  }
  try {
    return window.matchMedia(NARROW_MQ).matches ? GUTTER_NARROW : GUTTER_WIDE;
  } catch {
    return GUTTER_WIDE;
  }
}

/**
 * Row under a viewport-local pointer y (legacy closest('.tl-row') hit at
 * app.js:540-541, recomputed for the virtualized canvas: rows live at
 * axisH + i*rowH - scrollTop). y ≥ axisH required; x is unconstrained so
 * gutter clicks hit too.
 */
export function rowFromPoint(
  y: number,
  scrollTop: number,
  rowCount: number,
  m: Metrics,
): number | null {
  if (y < m.axisH) return null;
  const i = Math.floor((y - m.axisH + scrollTop) / m.rowH);
  if (i < 0 || i >= rowCount) return null;
  return i;
}
