import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'center' | 'start' | 'end';
  className?: string;
  children: ReactNode;
}

export function Tooltip({
  content,
  side = 'top',
  align = 'center',
  className,
  children,
}: TooltipProps) {
  return (
    <TooltipPrimitive.TooltipProvider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            className={cn(
              'toast-in z-50 max-w-[320px] rounded-[var(--radius-sm)] border border-hair bg-raised',
              'px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] whitespace-pre text-fg',
              'shadow-[var(--shadow-md)]',
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-raised" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.TooltipProvider>
  );
}
