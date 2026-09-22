import { cn } from './cn';

export interface LogoProps {
  size?: number;
  className?: string;
  title?: string;
}

export function Logo({ size = 20, className, title }: LogoProps) {
  const label = title ?? 'agent-xray';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      role="img"
      aria-hidden={title ? undefined : true}
    >
      <title>{label}</title>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4" />
      <path d="M7 12h1.9l1.35-3 2 5.8 1.4-3.2.9 1.5H17" stroke="var(--accent)" strokeWidth={1.5} />
    </svg>
  );
}
