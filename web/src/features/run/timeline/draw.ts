/**
 * Canvas renderer — one full repaint per frame, ordered per spec:
 * clear → hover band → axis (niceStep(span/6) ticks + fmtMs labels) →
 * clip track → visible rows (culled by scrollTop) → selection → now-line
 * (live only, x from metrics.gutter) → gutter repaint (restores the
 * hover/selection gutter bands the repaint erased, plus the accent
 * selection marker).
 *
 * Bars: LLM = per-seg fills (share = w*(segEnd-from)/dur, clamped ≥ 0,
 * colors from stream tokens); tool = tool/fail fill; every open
 * (state==='running') bar gets a 1px accent stroke — the legacy .bar.live
 * box-shadow (style.css:119). No alpha pulse (reduced-motion safe by
 * construction). Documented deviation: zero-duration rows paint the
 * minimum 2px bar (spec allows).
 */
import { fmtMs } from '@/lib/fmt';
import { niceStep, type TimelineRow } from '../selectors';
import type { Metrics } from './layout';
import type { TimelineColors } from './theme';
import type { View } from './view';

const FONT = '11px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export interface DrawState {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  metrics: Metrics;
  colors: TimelineColors;
  view: View;
  rows: readonly TimelineRow[];
  scrollTop: number;
  hoverRow: number;
  selectedRow: number;
  live: boolean;
  nowMs: number;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(Math.min(r, w / 2, h / 2), 0);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
): void {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeLive(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(w - 1, 1), Math.max(h - 1, 1));
}

function drawLlmBar(
  ctx: CanvasRenderingContext2D,
  row: TimelineRow,
  x0: number,
  bw: number,
  y: number,
  m: Metrics,
  colors: TimelineColors,
): void {
  const dur = row.end - row.start;
  ctx.save();
  roundRectPath(ctx, x0, y, bw, m.barH, m.radius);
  ctx.clip();
  if (dur > 0) {
    for (const seg of row.segs) {
      const segW = (bw * (seg.end - seg.from)) / dur;
      const segX = x0 + (bw * (seg.from - row.start)) / dur;
      if (!(segW > 0)) continue;
      ctx.fillStyle = colors[seg.kind];
      ctx.fillRect(segX, y, segW, m.barH);
    }
  } else {
    // Zero-duration call: paint the min-width wait bar (documented deviation).
    ctx.fillStyle = colors.wait;
    ctx.fillRect(x0, y, bw, m.barH);
  }
  ctx.restore();
  if (row.state === 'running') strokeLive(ctx, x0, y, bw, m.barH, colors.accent);
}

function drawToolBar(
  ctx: CanvasRenderingContext2D,
  row: TimelineRow,
  x0: number,
  bw: number,
  y: number,
  m: Metrics,
  colors: TimelineColors,
): void {
  const fill = row.state === 'fail' ? colors.fail : colors.tool;
  fillRoundRect(ctx, x0, y, bw, m.barH, m.radius, fill);
  if (row.state === 'running') strokeLive(ctx, x0, y, bw, m.barH, colors.accent);
}

function drawAxis(
  ctx: CanvasRenderingContext2D,
  w: number,
  m: Metrics,
  colors: TimelineColors,
  view: View,
  xOf: (t: number) => number,
): void {
  const span = Math.max(view.t1 - view.t0, 1e-9);
  const step = niceStep(span / 6);

  ctx.font = FONT;
  ctx.fillStyle = colors.fg3;
  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const first = Math.ceil(view.t0 / step) * step;
  for (let t = first; t <= view.t1 + step * 1e-6; t += step) {
    const x = Math.round(xOf(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, m.axisH - 5);
    ctx.lineTo(x, m.axisH - 1);
    ctx.stroke();
    const label = fmtMs(t);
    const tw = ctx.measureText(label).width;
    if (x - tw / 2 >= m.gutter && x + tw / 2 <= w) ctx.fillText(label, x, m.axisH - 8);
  }

  ctx.beginPath();
  ctx.moveTo(0, m.axisH - 0.5);
  ctx.lineTo(w, m.axisH - 0.5);
  ctx.stroke();
}

function bandY(index: number, m: Metrics, scrollTop: number): number {
  return m.axisH + index * m.rowH - scrollTop;
}

export function drawTimeline(st: DrawState): void {
  const { ctx, width: w, height: h, metrics: m, colors, view, rows, scrollTop } = st;
  const span = Math.max(view.t1 - view.t0, 1e-9);
  const trackW = Math.max(w - m.gutter, 1);
  const xOf = (t: number): number => m.gutter + ((t - view.t0) / span) * trackW;

  // 1. clear — panel background across the whole viewport box
  ctx.fillStyle = colors.panel;
  ctx.fillRect(0, 0, w, h);

  // 2. hover band (full width; gutter half re-applied after the repaint)
  if (st.hoverRow >= 0 && st.hoverRow < rows.length) {
    const y = bandY(st.hoverRow, m, scrollTop);
    if (y < h && y + m.rowH > 0) {
      ctx.fillStyle = colors.raised;
      ctx.fillRect(0, y, w, m.rowH);
    }
  }

  // 3. axis
  drawAxis(ctx, w, m, colors, view, xOf);

  // 4. clip to the track, draw visible rows (culled by scrollTop)
  ctx.save();
  ctx.beginPath();
  ctx.rect(m.gutter, m.axisH, trackW, Math.max(h - m.axisH, 0));
  ctx.clip();

  const first = Math.max(0, Math.floor((scrollTop - m.rowH) / m.rowH));
  const last = Math.min(rows.length - 1, Math.floor((scrollTop - m.axisH + h) / m.rowH) + 1);
  for (let i = first; i <= last; i++) {
    const row = rows[i];
    if (!row) continue;
    const y = bandY(i, m, scrollTop) + m.barTop;
    const x0 = xOf(row.start);
    const bw = Math.max(xOf(row.end) - x0, m.minBarW);
    if (row.kind === 'llm') drawLlmBar(ctx, row, x0, bw, y, m, colors);
    else drawToolBar(ctx, row, x0, bw, y, m, colors);
  }
  ctx.restore();

  // 5. selection band (track + full width; gutter restored below)
  if (st.selectedRow >= 0 && st.selectedRow < rows.length) {
    const y = bandY(st.selectedRow, m, scrollTop);
    if (y + m.rowH > m.axisH && y < h) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = colors.accent;
      ctx.fillRect(0, y, w, m.rowH);
      ctx.globalAlpha = 1;
    }
  }

  // 6. now-line while live — x originates at metrics.gutter (never a literal 150)
  if (st.live) {
    const x = Math.round(xOf(st.nowMs)) + 0.5;
    if (x >= m.gutter && x <= w) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  // 7. gutter repaint + restore gutter bands/selection marker
  ctx.fillStyle = colors.panel;
  ctx.fillRect(0, 0, m.gutter, h);
  ctx.strokeStyle = colors.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, m.axisH - 0.5);
  ctx.lineTo(m.gutter, m.axisH - 0.5);
  ctx.stroke();

  if (st.hoverRow >= 0 && st.hoverRow < rows.length) {
    const y = bandY(st.hoverRow, m, scrollTop);
    if (y < h && y + m.rowH > 0) {
      ctx.fillStyle = colors.raised;
      ctx.fillRect(0, y, m.gutter, m.rowH);
    }
  }
  if (st.selectedRow >= 0 && st.selectedRow < rows.length) {
    const y = bandY(st.selectedRow, m, scrollTop);
    if (y < h && y + m.rowH > 0) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = colors.accent;
      ctx.fillRect(0, y, m.gutter, m.rowH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.accent;
      ctx.fillRect(0, y, 3, m.rowH);
    }
  }
}
