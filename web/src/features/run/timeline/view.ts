/**
 * Time-window math for the timeline viewport. The view {t0,t1} lives in a
 * ref (never React state): pointer/wheel handlers mutate it and request a
 * redraw, so interaction causes zero re-renders. fitView (selectors.ts:164)
 * defines the canonical window; everything here clamps back into it.
 *
 * Clamps (spec): span ∈ [1ms, fitSpan], t0 ∈ [0, fitT1 - span].
 */

export interface View {
  t0: number;
  t1: number;
}

export function spanOf(v: View): number {
  return v.t1 - v.t0;
}

export function clampView(v: View, fit: View): View {
  const fitT1 = fit.t1;
  const fitSpan = fitT1 - fit.t0;
  const minSpan = Math.min(1, Math.max(fitSpan, 0.001));
  const maxSpan = Math.max(fitSpan, minSpan);
  let span = spanOf(v);
  if (span > maxSpan) span = maxSpan;
  if (span < minSpan) span = minSpan;
  let t0 = v.t0;
  const maxT0 = fitT1 - span;
  if (t0 > maxT0) t0 = maxT0;
  if (t0 < 0) t0 = 0;
  return { t0, t1: t0 + span };
}

/** Zoom by factor k (>1 zooms out) keeping the time under cursor frac fixed. */
export function zoomAt(v: View, fit: View, frac: number, k: number): View {
  const span = spanOf(v);
  const anchor = v.t0 + frac * span;
  const next = span * k;
  const t0 = anchor - frac * next;
  return clampView({ t0, t1: t0 + next }, fit);
}

/** Shift the window by dtMs (negative pans left). */
export function panBy(v: View, fit: View, dtMs: number): View {
  return clampView({ t0: v.t0 + dtMs, t1: v.t1 + dtMs }, fit);
}

/**
 * Live follow: while following, the right edge tracks fit.t1 each frame
 * (t1 = max(t1, fit.t1)); clamp keeps t0 at 0 when span is the full fit.
 * When not following the view is merely clamped into the fit bounds.
 */
export function followView(v: View, fit: View, follow: boolean): View {
  if (!follow) return clampView(v, fit);
  return clampView({ t0: v.t0, t1: Math.max(v.t1, fit.t1) }, fit);
}
