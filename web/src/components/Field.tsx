import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label != null ? (
        <label htmlFor={htmlFor} className="text-[12px] leading-tight text-fg-2">
          {label}
        </label>
      ) : null}
      {children}
      {hint != null && error == null ? (
        <span className="text-[11px] text-muted">{hint}</span>
      ) : null}
      {error != null ? <span className="text-[11px] text-fail">{error}</span> : null}
    </div>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-[var(--radius-sm)] border border-hair bg-inset px-2.5',
        'font-mono text-[12.5px] text-fg placeholder:text-muted',
        'transition-colors duration-150 disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full resize-y rounded-[var(--radius-sm)] border border-hair bg-inset px-2.5 py-2',
        'font-mono text-[12.5px] leading-[1.5] text-fg placeholder:text-muted',
        'transition-colors duration-150 disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-8 w-full rounded-[var(--radius-sm)] border border-hair bg-inset px-2',
        'font-mono text-[12.5px] text-fg',
        'transition-colors duration-150 disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export type CheckboxProps = InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, type = 'checkbox', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'size-3.5 shrink-0 rounded-[3px] border border-hair bg-inset accent-[var(--accent)]',
        className,
      )}
      {...rest}
    />
  );
});
