/**
 * Shared run-history list — subscribe/refresh/get via useSyncExternalStore.
 * Both HomePage and RunPage refresh it (mount, after create, on run_finished)
 * so the sidebar history stays current across navigation.
 */
import { useSyncExternalStore } from 'react';
import type { SidebarRunItem } from '@/app/Sidebar';
import { listRuns } from '@/lib/api';
import { ago, fmtMs } from '@/lib/fmt';
import type { RunMeta } from '@/types/events';

let items: SidebarRunItem[] = [];
let started = 0;
let applied = 0;
const listeners = new Set<() => void>();

function toItem(run: RunMeta): SidebarRunItem {
  return {
    id: run.id,
    model: run.model,
    prompt: run.prompt,
    status: run.status,
    time: run.summary ? fmtMs(run.summary.wall_ms) : ago(run.created_at),
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function getHistorySnapshot(): SidebarRunItem[] {
  return items;
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Refetch /api/runs. Overlapping refreshes: only the newest response applies. */
export async function refreshHistory(): Promise<void> {
  const token = ++started;
  let runs: RunMeta[];
  try {
    runs = await listRuns();
  } catch {
    return; // keep the previous list
  }
  if (token <= applied) return;
  applied = token;
  items = runs.map(toItem);
  notify();
}

export function useHistory(): SidebarRunItem[] {
  return useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);
}
