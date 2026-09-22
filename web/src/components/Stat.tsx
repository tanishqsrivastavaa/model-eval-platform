import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from './cn';

export interface StatProps {
  label: ReactNode;
  value: string | number;
  sub?: ReactNode;
  className?: string;
  animate?: boolean;
  format?: (n: number) => string;
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('en-US');

function useCountUp(target: number, animate: boolean, format: (n: number) => string) {
  const [display, setDisplay] = useState(() => (animate ? format(0) : format(target)));
  const frameRef = useRef(0);

  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setDisplay(format(target));
      return;
    }
    const duration = 700;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(format(from + (target - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, animate, format]);

  return display;
}

export function Stat({
  label,
  value,
  sub,
  className,
  animate = true,
  format = defaultFormat,
}: StatProps) {
  const isNumeric = typeof value === 'number' && Number.isFinite(value);
  const countUp = useCountUp(isNumeric ? value : 0, animate && isNumeric, format);
  const text = isNumeric ? countUp : String(value);

  return (
    <div
      className={cn('rounded-[var(--radius)] border border-hair bg-panel px-2.5 py-2.5', className)}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
        {label}
      </div>
      <div className="mt-1 font-mono text-[18px] font-medium leading-none tabular-nums text-fg">
        {text}
      </div>
      {sub != null ? <div className="mt-1.5 font-mono text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
