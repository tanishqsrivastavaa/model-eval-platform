/**
 * React bindings — every hook is useSyncExternalStore(runStore.subscribe,
 * stableSelector, stableSelector). Selector identity is fixed via
 * useCallback so React never re-subscribes.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { RunStatus } from '@/components/Pill';
import type { RunFinishedData } from '@/types/events';
import {
  type StatsView,
  selectCallView,
  selectContextKey,
  selectEventsTable,
  selectFinished,
  selectLive,
  selectOrder,
  selectStats,
  selectStatus,
  selectTimelineModel,
  selectToolView,
  type TimelineModel,
} from './selectors';
import { type RunSnapshot, runStore } from './streamStore';

export function useRunSnapshot(): RunSnapshot {
  return useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, runStore.getServerSnapshot);
}

export function useStatus(): RunStatus {
  const get = useCallback(() => selectStatus(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectStatus(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useLive(): boolean {
  const get = useCallback(() => selectLive(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectLive(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useCallCard(n: number): ReturnType<typeof selectCallView> {
  const get = useCallback(() => selectCallView(runStore.getSnapshot(), n), [n]);
  const getServer = useCallback(() => selectCallView(runStore.getServerSnapshot(), n), [n]);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useToolCard(key: string): ReturnType<typeof selectToolView> {
  const get = useCallback(() => selectToolView(runStore.getSnapshot(), key), [key]);
  const getServer = useCallback(() => selectToolView(runStore.getServerSnapshot(), key), [key]);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useStats(): StatsView {
  const get = useCallback(() => selectStats(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectStats(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useTimelineModel(): TimelineModel {
  const get = useCallback(() => selectTimelineModel(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectTimelineModel(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useOrder(): RunSnapshot['order'] {
  const get = useCallback(() => selectOrder(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectOrder(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useFinished(): RunFinishedData | null {
  const get = useCallback(() => selectFinished(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectFinished(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useEventsTable(): ReturnType<typeof selectEventsTable> {
  const get = useCallback(() => selectEventsTable(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectEventsTable(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}

export function useContextKey(): number {
  const get = useCallback(() => selectContextKey(runStore.getSnapshot()), []);
  const getServer = useCallback(() => selectContextKey(runStore.getServerSnapshot()), []);
  return useSyncExternalStore(runStore.subscribe, get, getServer);
}
