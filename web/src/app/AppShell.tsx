import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { cn } from '@/components/cn';
import { Moon, Sun } from '@/components/Icons';
import { Logo } from '@/components/Logo';
import { ToastProvider } from '@/components/Toast';
import { Tooltip } from '@/components/Tooltip';
import { ThemeProvider, useTheme } from './ThemeProvider';

export interface AppShellProps {
  sidebar?: ReactNode;
  children: ReactNode;
  className?: string;
}

function ThemeToggle() {
  const { resolvedTheme, toggle } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip content={`Switch to ${next} theme`}>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-label={`Switch to ${next} theme`}
        className="shrink-0 px-1.5"
      >
        {resolvedTheme === 'dark' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      </Button>
    </Tooltip>
  );
}

export function AppShell({ sidebar, children, className }: AppShellProps) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <div
          data-testid="app-shell"
          className={cn(
            'grid h-dvh grid-cols-[340px_1fr] overflow-hidden',
            'max-[859px]:h-auto max-[859px]:grid-cols-1 max-[859px]:overflow-visible',
            className,
          )}
        >
          <aside
            data-testid="sidebar-slot"
            className={cn(
              'flex min-h-0 flex-col gap-3.5 overflow-y-auto border-hair bg-page p-3.5',
              'min-[860px]:border-r max-[859px]:border-b',
            )}
          >
            <div className="flex items-center gap-2">
              <Logo size={18} className="text-accent" />
              <span className="font-mono text-[15px] font-semibold tracking-[0.02em] text-fg">
                agent-xray
              </span>
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3.5">{sidebar}</div>
          </aside>
          <main className="min-w-0 overflow-y-auto px-6 pt-5 pb-[60px] max-[859px]:px-4 max-[859px]:pt-4 max-[859px]:pb-10">
            {children}
          </main>
        </div>
      </ToastProvider>
    </ThemeProvider>
  );
}
