/**
 * Timeline — canvas waterfall of LLM/tool rows (port of renderTimeline
 * app.js:209-247 plus the tooltip/click handlers app.js:529-550) with a
 * DOM label gutter, wheel/pointer pan-zoom, keyboard navigation and a
 * <details> text fallback.
 *
 * Perf contract: view {t0,t1}, hover, drag and selection live in refs;
 * pointer, wheel and scroll only mutate refs and set drawPending — React
 * re-renders solely on model change (store commits) or selection change.
 * Painting runs on a private rAF loop that redraws when pending or the
 * run is live. The view window never touches React state (spec §3/§9).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtMs } from '@/lib/fmt';
import { useTimelineModel } from '../hooks';
import { fitView } from '../selectors';
import { runStore } from '../streamStore';
import { drawTimeline } from './draw';
import { hitRow, rowKeyString } from './hit';
import {
  AXIS_H,
  MAX_VIEWPORT_H,
  type Metrics,
  makeMetrics,
  NARROW_MQ,
  ROW_H,
  readGutter,
  TOOL_INDENT,
} from './layout';
import { readColors, type TimelineColors } from './theme';
import { tooltipText } from './tooltip';
import { followView, panBy, spanOf, type View, zoomAt } from './view';

export interface TimelineProps {
  onActivate?: (kind: 'llm' | 'tool', key: string) => void;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  moved: boolean;
  followWas: boolean;
  px: number;
  py: number;
  pt0: number;
  pt1: number;
  ps: number;
}

export function Timeline({ onActivate }: TimelineProps) {
  const model = useTimelineModel();
  const [selected, setSelected] = useState<number | null>(null);
  const [gutter, setGutter] = useState(() => readGutter());

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef(new Map<number, HTMLDivElement>());
  const viewRef = useRef<View>(fitView(model));
  const followRef = useRef(true);
  const hoverRef = useRef(-1);
  const tipRowRef = useRef(-1);
  const selectedRef = useRef(-1);
  const drawPendingRef = useRef(true);
  const dragRef = useRef<Drag | null>(null);
  const colorsRef = useRef<TimelineColors | null>(null);
  const metricsRef = useRef<Metrics>(makeMetrics(gutter));
  const modelRef = useRef(model);

  /** Reposition the ±2 visible label window (imperative — zero re-render). */
  const updateLabels = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const m = metricsRef.current;
    const st = vp.scrollTop;
    const from = Math.floor(st / m.rowH) - 2;
    const to = Math.ceil((st + vp.clientHeight - m.axisH) / m.rowH) + 2;
    for (const [i, el] of labelsRef.current) {
      const visible = i >= from && i <= to;
      el.style.display = visible ? 'block' : 'none';
      if (visible) el.style.top = `${i * m.rowH - st}px`;
    }
  }, []);

  const selectRow = useCallback((index: number | null) => {
    selectedRef.current = index ?? -1;
    setSelected(index);
    drawPendingRef.current = true;
    if (index != null) {
      const vp = viewportRef.current;
      const m = metricsRef.current;
      if (vp) {
        const rowTop = m.axisH + index * m.rowH;
        const rowBot = rowTop + m.rowH;
        const viewTop = vp.scrollTop + m.axisH;
        const viewBot = vp.scrollTop + vp.clientHeight;
        if (rowTop < viewTop) vp.scrollTop = Math.max(0, rowTop - m.axisH);
        else if (rowBot > viewBot) vp.scrollTop = Math.max(0, rowBot - vp.clientHeight);
      }
    }
  }, []);

  // Model identity → refs + redraw (the only model-driven render path).
  // Layout effect so label repositioning happens pre-paint.
  useLayoutEffect(() => {
    modelRef.current = model;
    drawPendingRef.current = true;
    updateLabels();
    if (selectedRef.current >= model.rows.length) {
      selectedRef.current = -1;
      setSelected(null);
    }
  }, [model, updateLabels]);

  // Narrow-viewport gutter swap → metrics + redraw.
  useLayoutEffect(() => {
    metricsRef.current = makeMetrics(gutter);
    drawPendingRef.current = true;
    updateLabels();
  }, [gutter, updateLabels]);

  // Mount: rAF paint loop, non-passive wheel zoom, theme/narrow media
  // listeners, label-window scroll sync, ResizeObserver.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return undefined;
    let disposed = false;
    let rafId: number | null = null;
    let colorsDirty = false;

    if (!colorsRef.current) colorsRef.current = readColors();

    const drawFrame = (): void => {
      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (!viewport || !canvas) return;
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      if (w < 1 || h < 1) return;
      const ctx = canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      if (canvas.style.width !== `${w}px`) canvas.style.width = `${w}px`;
      if (canvas.style.height !== `${h}px`) canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (colorsDirty || !colorsRef.current) {
        colorsRef.current = readColors();
        colorsDirty = false;
      }

      const current = modelRef.current;
      const fit = fitView(current);
      viewRef.current = followView(viewRef.current, fit, followRef.current);
      drawTimeline({
        ctx,
        width: w,
        height: h,
        metrics: metricsRef.current,
        colors: colorsRef.current,
        view: viewRef.current,
        rows: current.rows,
        scrollTop: viewport.scrollTop,
        hoverRow: hoverRef.current,
        selectedRow: selectedRef.current,
        live: current.live,
        nowMs: current.live ? current.nowMs : current.lastTMs,
      });
    };

    const loop = (): void => {
      if (disposed) return;
      if (drawPendingRef.current || modelRef.current.live) {
        drawPendingRef.current = false;
        drawFrame();
      }
      rafId = requestAnimationFrame(loop);
    };

    // Wheel: non-passive, zoom-to-cursor, k = exp(deltaY * 0.0018).
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const m = metricsRef.current;
      const rect = viewport.getBoundingClientRect();
      const trackW = Math.max(viewport.clientWidth - m.gutter, 1);
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - m.gutter) / trackW));
      followRef.current = false;
      viewRef.current = zoomAt(
        viewRef.current,
        fitView(modelRef.current),
        frac,
        Math.exp(e.deltaY * 0.0018),
      );
      drawPendingRef.current = true;
    };
    vp.addEventListener('wheel', onWheel, { passive: false });

    const onScroll = (): void => {
      drawPendingRef.current = true;
      updateLabels();
    };
    vp.addEventListener('scroll', onScroll, { passive: true });

    const onThemeMaybeChanged = (): void => {
      colorsDirty = true;
      drawPendingRef.current = true;
    };

    let narrowMq: MediaQueryList | null = null;
    const onNarrow = (): void => setGutter(readGutter());
    let colorMq: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      try {
        narrowMq = window.matchMedia(NARROW_MQ);
        if (typeof narrowMq.addEventListener === 'function') {
          narrowMq.addEventListener('change', onNarrow);
        }
        colorMq = window.matchMedia('(prefers-color-scheme: light)');
        if (typeof colorMq.addEventListener === 'function') {
          colorMq.addEventListener('change', onThemeMaybeChanged);
        }
      } catch {
        /* matchMedia unsupported — defaults already applied */
      }
    }

    let mo: MutationObserver | null = null;
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(onThemeMaybeChanged);
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => {
        drawPendingRef.current = true;
        updateLabels();
      });
      ro.observe(vp);
    }

    drawFrame();
    if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      vp.removeEventListener('wheel', onWheel);
      vp.removeEventListener('scroll', onScroll);
      if (narrowMq && typeof narrowMq.removeEventListener === 'function') {
        narrowMq.removeEventListener('change', onNarrow);
      }
      if (colorMq && typeof colorMq.removeEventListener === 'function') {
        colorMq.removeEventListener('change', onThemeMaybeChanged);
      }
      mo?.disconnect();
      ro?.disconnect();
    };
  }, [updateLabels]);

  function resetView(): void {
    viewRef.current = fitView(modelRef.current);
    followRef.current = true;
    drawPendingRef.current = true;
  }

  function zoomCenter(k: number): void {
    followRef.current = false;
    viewRef.current = zoomAt(viewRef.current, fitView(modelRef.current), 0.5, k);
    drawPendingRef.current = true;
  }

  function activate(index: number): void {
    const row = model.rows[index];
    if (!row) return;
    onActivate?.(row.kind, rowKeyString(row));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
    const vp = viewportRef.current;
    if (!vp) return;
    dragRef.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      followWas: followRef.current,
      px: e.clientX,
      py: e.clientY,
      pt0: viewRef.current.t0,
      pt1: viewRef.current.t1,
      ps: vp.scrollTop,
    };
    followRef.current = false; // freeze live follow while pressed
    if (typeof vp.setPointerCapture === 'function') {
      try {
        vp.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture unsupported */
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const vp = viewportRef.current;
    if (!vp) return;
    const m = metricsRef.current;
    const rect = vp.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rows = model.rows;

    const row = hitRow(y, vp.scrollTop, rows.length, m);
    if (row !== hoverRef.current) {
      hoverRef.current = row ?? -1;
      drawPendingRef.current = true;
    }

    const tip = tipRef.current;
    if (tip) {
      if (row !== tipRowRef.current) {
        tipRowRef.current = row ?? -1;
        if (row == null) {
          tip.hidden = true;
        } else {
          const r = rows[row];
          tip.textContent = tooltipText(runStore.getSnapshot(), r.kind, rowKeyString(r));
          tip.hidden = false;
        }
      }
      if (row != null && !tip.hidden) {
        tip.style.left = `${Math.max(
          0,
          Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8),
        )}px`;
        tip.style.top = `${Math.max(
          0,
          Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8),
        )}px`;
      }
    }

    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      drag.moved = true;
      followRef.current = false;
      drag.px = e.clientX;
      drag.py = e.clientY;
      drag.pt0 = viewRef.current.t0;
      drag.pt1 = viewRef.current.t1;
      drag.ps = vp.scrollTop;
    }
    const trackW = Math.max(vp.clientWidth - m.gutter, 1);
    const span = drag.pt1 - drag.pt0;
    const dt = -((e.clientX - drag.px) * span) / trackW;
    viewRef.current = panBy({ t0: drag.pt0, t1: drag.pt1 }, fitView(modelRef.current), dt);
    vp.scrollTop = drag.ps - (e.clientY - drag.py);
    drawPendingRef.current = true;
  }

  function releaseCapture(e: React.PointerEvent<HTMLDivElement>): void {
    const vp = viewportRef.current;
    if (vp && typeof vp.releasePointerCapture === 'function') {
      try {
        vp.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already released */
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    dragRef.current = null;
    releaseCapture(e);
    if (!drag) return;
    if (drag.moved) return;
    followRef.current = drag.followWas;
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const row = hitRow(e.clientY - rect.top, vp.scrollTop, model.rows.length, metricsRef.current);
    if (row != null) activate(row);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>): void {
    dragRef.current = null;
    releaseCapture(e);
    hideTip();
  }

  function hideTip(): void {
    if (hoverRef.current !== -1) {
      hoverRef.current = -1;
      drawPendingRef.current = true;
    }
    tipRowRef.current = -1;
    const tip = tipRef.current;
    if (tip) tip.hidden = true;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const rows = model.rows;
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length === 0) return;
      const cur = selectedRef.current;
      const next =
        key === 'ArrowDown'
          ? Math.min(cur + 1, rows.length - 1)
          : Math.max(cur < 0 ? rows.length - 1 : cur - 1, 0);
      selectRow(next);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      if (selectedRef.current >= 0) activate(selectedRef.current);
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      followRef.current = false;
      const view = viewRef.current;
      const dt = (key === 'ArrowLeft' ? -0.15 : 0.15) * spanOf(view);
      viewRef.current = panBy(view, fitView(model), dt);
      drawPendingRef.current = true;
      return;
    }
    if (key === '+' || key === '=') {
      e.preventDefault();
      zoomCenter(0.8);
      return;
    }
    if (key === '-' || key === '_') {
      e.preventDefault();
      zoomCenter(1.25);
      return;
    }
    if (key === '0') {
      e.preventDefault();
      resetView();
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      if (rows.length > 0) selectRow(0);
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      if (rows.length > 0) selectRow(rows.length - 1);
    }
  }

  const selRow = selected != null ? (model.rows[selected] ?? null) : null;
  const announce = selRow
    ? `${selRow.label}, ${fmtMs(selRow.start)} to ${fmtMs(selRow.end)}, ${selRow.state}`
    : '';

  return (
    <div data-testid="timeline">
      <div className="relative">
        <div
          ref={viewportRef}
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: custom canvas widget — arrow-key navigation lives on this node (spec §8)
          tabIndex={0}
          aria-label="Timeline"
          className="relative overflow-x-hidden overflow-y-auto rounded-[var(--radius-sm)] outline-hidden select-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]"
          style={{ maxHeight: MAX_VIEWPORT_H, touchAction: 'pan-y' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={hideTip}
          onDoubleClick={resetView}
          onKeyDown={onKeyDown}
        >
          <div
            data-testid="timeline-spacer"
            style={{ height: AXIS_H + model.rows.length * ROW_H }}
          />
        </div>

        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 z-[1]"
        />

        <div
          aria-hidden
          className="pointer-events-none absolute right-0 left-0 z-[2] overflow-hidden"
          style={{ top: AXIS_H, bottom: 0 }}
        >
          {model.rows.map((row, i) => (
            <div
              key={`${row.kind}-${row.key}`}
              ref={(el) => {
                if (el) labelsRef.current.set(i, el);
                else labelsRef.current.delete(i);
              }}
              data-row-index={i}
              className="absolute right-0 left-0 overflow-hidden font-mono text-[11px] text-ellipsis text-fg-2"
              style={{
                top: i * ROW_H,
                height: ROW_H,
                paddingLeft: row.kind === 'tool' ? TOOL_INDENT : 0,
                paddingRight: 8,
                lineHeight: `${ROW_H}px`,
                whiteSpace: 'nowrap',
              }}
            >
              {row.label}
            </div>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="sr-only" data-testid="timeline-live">
        {announce}
      </div>

      <div
        ref={tipRef}
        data-testid="timeline-tooltip"
        hidden
        className="pointer-events-none fixed z-10 rounded-[6px] border border-hair bg-raised px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] whitespace-pre text-fg shadow-[var(--shadow-md)]"
      />

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-fg-2 select-none">
          Timeline as text
        </summary>
        <ol className="mt-1 flex flex-col gap-0.5">
          {model.rows.map((row) => {
            const key = rowKeyString(row);
            return (
              <li key={`${row.kind}-${key}`}>
                <button
                  type="button"
                  className="w-full rounded-[4px] px-1.5 py-0.5 text-left font-mono text-[12px] text-fg-2 hover:bg-raised hover:text-fg"
                  aria-label={`${row.label}, start ${fmtMs(row.start)}, end ${fmtMs(row.end)}`}
                  onClick={() => onActivate?.(row.kind, key)}
                >
                  {row.label} · {fmtMs(row.start)} → {fmtMs(row.end)}
                </button>
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}
