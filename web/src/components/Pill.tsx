import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type RunStatus =
  | 'running'
  | 'completed'
  | 'error'
  | 'interrupted'
  | 'cancelled'
  | 'max_turns';

export const statusTextClass: Record<RunStatus, string> = {
  running: 'text-accent border-accent/30 bg-accent-soft',
  completed: 'text-tool border-tool/30 bg-tool/10',
  error: 'text-fail border-fail/30 bg-fail/10',
  interrupted: 'text-fail border-fail/30 bg-fail/10',
  cancelled: 'text-args border-args/30 bg-args/10',
  max_turns: 'text-args border-args/30 bg-args/10',
};

export const statusDotClass: Record<RunStatus, string> = {
  running: 'bg-accent',
  completed: 'bg-tool',
  error: 'bg-fail',
  interrupted: 'bg-fail',
  cancelled: 'bg-args',
  max_turns: 'bg-args',
};

export interface PillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: RunStatus;
}

export function Pill({ status, className, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5',
        'font-mono text-[11.5px] font-medium',
        statusTextClass[status],
        className,
      )}
      {...rest}
    >
      <i
        aria-hidden
        className={cn('size-1.5 rounded-full bg-current', status === 'running' && 'pulse-live')}
      />
      {status}
    </span>
  );
}
