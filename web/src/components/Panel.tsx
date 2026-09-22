import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
}

export function Panel({ title, actions, className, children, ...rest }: PanelProps) {
  const hasHeader = title != null || actions != null;
  return (
    <div
      className={cn('rounded-[var(--radius)] border border-hair bg-panel p-3', className)}
      {...rest}
    >
      {hasHeader ? (
        <div className={cn('mb-2.5 flex items-center justify-between gap-2 flex-wrap')}>
          {title != null ? (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-2">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
