/**
 * Canvas palette — read once from the design-token custom properties
 * (styles/tokens.css) via getComputedStyle, cached in a ref, and re-read
 * only when the theme changes (prefers-color-scheme media or the
 * documentElement data-theme attribute). Fallbacks are the dark-theme
 * token values so drawing still works if computed styles are unavailable.
 */

export interface TimelineColors {
  wait: string;
  think: string;
  text: string;
  args: string;
  tool: string;
  fail: string;
  accent: string;
  fg: string;
  fg2: string;
  fg3: string;
  panel: string;
  hairline: string;
  raised: string;
  inset: string;
}

const PROPS: Record<keyof TimelineColors, string> = {
  wait: '--stream-wait',
  think: '--stream-think',
  text: '--stream-text',
  args: '--stream-args',
  tool: '--stream-tool',
  fail: '--stream-fail',
  accent: '--accent',
  fg: '--fg',
  fg2: '--fg-2',
  fg3: '--fg-3',
  panel: '--panel',
  hairline: '--hairline',
  raised: '--raised',
  inset: '--inset',
};

const FALLBACK: TimelineColors = {
  wait: '#3f3f46',
  think: '#a78bfa',
  text: '#60a5fa',
  args: '#f5b544',
  tool: '#34d399',
  fail: '#f87171',
  accent: '#7dd3fc',
  fg: '#f4f4f5',
  fg2: '#a1a1aa',
  fg3: '#71717a',
  panel: '#111113',
  hairline: 'rgb(255 255 255 / 8%)',
  raised: '#18181b',
  inset: '#0c0c0e',
};

export function readColors(target?: Element): TimelineColors {
  const el = target ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || typeof getComputedStyle !== 'function') return { ...FALLBACK };
  let cs: CSSStyleDeclaration;
  try {
    cs = getComputedStyle(el);
  } catch {
    return { ...FALLBACK };
  }
  const out = {} as TimelineColors;
  for (const key of Object.keys(PROPS) as (keyof TimelineColors)[]) {
    const value = cs.getPropertyValue(PROPS[key]).trim();
    out[key] = value || FALLBACK[key];
  }
  return out;
}

/** Reduced-motion flag — the live-bar pulse stays off when this is set. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
