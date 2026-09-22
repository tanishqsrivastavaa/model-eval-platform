import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from './cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  content?: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function Tabs({ tabs, value, onChange, ariaLabel, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);

  const focusTab = (index: number) => {
    const clamped = (index + tabs.length) % tabs.length;
    focusNext.current = true;
    onChange(tabs[clamped]?.id ?? '');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === value);
    if (currentIndex < 0) return;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusTab(currentIndex + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusTab(currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusTab(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  // After keyboard-driven change, move DOM focus to the active tab.
  if (focusNext.current && typeof window !== 'undefined') {
    focusNext.current = false;
    queueMicrotask(() => {
      const active = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      active?.focus();
    });
  }

  const activeTab = tabs.find((tab) => tab.id === value);

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-1 overflow-x-auto border-b border-hair"
      >
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors duration-150',
                selected ? 'border-accent text-fg' : 'border-transparent text-fg-2 hover:text-fg',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {activeTab?.content != null ? (
        <div
          role="tabpanel"
          id={`tabpanel-${activeTab.id}`}
          aria-labelledby={`tab-${activeTab.id}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: APG tabpanels are focusable so keyboard users can reach their content
          tabIndex={0}
          className="pt-3 focus-visible:outline-none"
        >
          {activeTab.content}
        </div>
      ) : null}
    </div>
  );
}
