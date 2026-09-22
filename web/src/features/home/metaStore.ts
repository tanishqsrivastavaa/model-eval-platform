/**
 * Cached GET /api/meta — single fetch shared by ConnectedSidebar (form setup)
 * and HomePage (no-providers hint). loadMeta never rejects; on failure it
 * clears the cache so the next caller can retry.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getMeta, type MetaResponse } from '@/lib/api';

let meta: MetaResponse | null = null;
let pending: Promise<MetaResponse | null> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function loadMeta(): Promise<MetaResponse | null> {
  if (meta) return Promise.resolve(meta);
  if (!pending) {
    pending = getMeta()
      .then((loaded) => {
        meta = loaded;
        notify();
        return loaded;
      })
      .catch(() => {
        pending = null;
        return null;
      });
  }
  return pending;
}

export function getMetaSnapshot(): MetaResponse | null {
  return meta;
}

export function subscribeMeta(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMeta(): MetaResponse | null {
  const subscribe = useCallback((listener: () => void) => subscribeMeta(listener), []);
  const snapshot = useSyncExternalStore(subscribe, getMetaSnapshot, getMetaSnapshot);
  useEffect(() => {
    void loadMeta();
  }, []);
  return snapshot;
}

export function __resetMetaForTests(): void {
  meta = null;
  pending = null;
}
