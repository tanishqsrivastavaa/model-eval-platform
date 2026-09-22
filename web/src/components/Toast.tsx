import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from './cn';
import { CircleAlert, CircleCheck, X } from './Icons';

export type ToastVariant = 'success' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends Required<Omit<ToastOptions, 'description'>> {
  id: number;
  description?: string;
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  success: (title: string, description?: string) => number;
  error: (title: string, description?: string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        variant: options.variant ?? 'success',
      };
      setItems((current) => [...current, item]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: 'success' }),
      error: (title, description) => toast({ title, description, variant: 'error' }),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[calc(100vw-32px)] max-w-sm flex-col gap-2"
        aria-label="Notifications"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.variant === 'error' ? 'alert' : 'status'}
            aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
            className={cn(
              'toast-in pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius)] border',
              'bg-raised p-3 shadow-[var(--shadow-md)]',
              item.variant === 'error' ? 'border-fail/35' : 'border-hair',
            )}
          >
            {item.variant === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-fail" aria-hidden />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-tool" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12.5px] font-medium text-fg">{item.title}</div>
              {item.description != null ? (
                <div className="mt-0.5 text-[12px] leading-snug text-fg-2">{item.description}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
              className="rounded-[4px] p-0.5 text-muted transition-colors duration-150 hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
