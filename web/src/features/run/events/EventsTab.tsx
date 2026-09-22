/**
 * Raw-events tab — port of renderEvents (app.js:434-442): append-only rows
 * from the store's event list, sticky header, 240-char data previews.
 */
import { memo, useMemo } from 'react';
import { cn } from '@/components/cn';
import type { RunEvent } from '@/types/events';
import { useEventsTable } from '../hooks';

function buildRows(events: readonly RunEvent[], len: number) {
  const rows = [];
  for (let i = 0; i < len; i++) {
    const ev = events[i];
    if (!ev) continue;
    let preview = JSON.stringify(ev.data);
    if (preview.length > 240) preview = `${preview.slice(0, 240)}…`;
    const typeClass =
      ev.type === 'error' ? 'text-fail' : ev.type === 'run_finished' ? 'text-accent' : 'text-fg';
    rows.push(
      <tr key={ev.seq}>
        <td className="px-2 py-[3px] align-top text-muted">{ev.seq}</td>
        <td className="px-2 py-[3px] text-right align-top whitespace-nowrap text-muted">
          {ev.t_ms.toFixed(1)}
        </td>
        <td className={cn('px-2 py-[3px] align-top', typeClass)}>{ev.type}</td>
        <td className="px-2 py-[3px] break-all align-top text-fg-2">{preview}</td>
      </tr>,
    );
  }
  return rows;
}

export const EventsTab = memo(function EventsTab() {
  const { eventsRef, eventsLen } = useEventsTable();
  const rows = useMemo(() => buildRows(eventsRef, eventsLen), [eventsRef, eventsLen]);

  return (
    <div data-testid="events-tab">
      <table className="w-full border-collapse font-mono text-[11.5px]">
        <thead>
          <tr>
            <th className="sticky top-0 z-[1] border-b border-hair bg-page px-2 py-1 text-left font-medium text-muted">
              #
            </th>
            <th className="sticky top-0 z-[1] border-b border-hair bg-page px-2 py-1 text-right font-medium text-muted">
              t (ms)
            </th>
            <th className="sticky top-0 z-[1] border-b border-hair bg-page px-2 py-1 text-left font-medium text-muted">
              type
            </th>
            <th className="sticky top-0 z-[1] border-b border-hair bg-page px-2 py-1 text-left font-medium text-muted">
              data
            </th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
});
