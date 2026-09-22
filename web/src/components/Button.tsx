import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn';
import { Loader2 } from './Icons';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95',
  ghost:
    'border border-hair bg-transparent text-fg-2 hover:bg-raised hover:text-fg active:bg-inset',
  danger: 'bg-fail text-on-fail hover:brightness-110 active:brightness-95',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1 px-2.5 text-[12px]',
  md: 'h-8 gap-1.5 px-3.5 text-[13px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', loading = false, disabled, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-[var(--radius-sm)] font-medium',
        'transition-[background-color,color,filter,transform] duration-150 ease-[var(--ease)]',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
