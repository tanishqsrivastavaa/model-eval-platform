/**
 * Live SSE wiring — open a run, reduce its stream into runStore.
 * Mirrors static/app.js openRun (123-153): GET run, reset state, EventSource,
 * stream_end → markStreamEnd+close, run_finished → close+onFinished,
 * onerror → close if stale/!live else expose reconnecting state.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { getRun } from '@/lib/api';
import type { InboundMessage, RunEvent, RunFinishedData, RunMeta } from '@/types/events';
import { runStore } from './streamStore';

export interface OpenRunStreamOptions {
  onFinished?: (data: RunFinishedData) => void;
  onReconnecting?: (reconnecting: boolean) => void;
}

export interface RunStreamHandle {
  error?: string;
  close: () => void;
}

export interface RunConnection {
  runId: string | null;
  reconnecting: boolean;
}

let connection: RunConnection = { runId: null, reconnecting: false };
const connListeners = new Set<() => void>();

function setConnection(next: RunConnection): void {
  if (next.runId === connection.runId && next.reconnecting === connection.reconnecting) return;
  connection = next;
  for (const l of [...connListeners]) l();
}

export function getRunConnection(): RunConnection {
  return connection;
}

export function subscribeRunConnection(listener: () => void): () => void {
  connListeners.add(listener);
  return () => {
    connListeners.delete(listener);
  };
}

export function useRunConnection(): RunConnection {
  const subscribe = useCallback((listener: () => void) => subscribeRunConnection(listener), []);
  return useSyncExternalStore(subscribe, getRunConnection, getRunConnection);
}

let currentEs: EventSource | null = null;
let currentRunId: string | null = null;

function closeCurrent(): void {
  currentEs?.close();
  currentEs = null;
  currentRunId = null;
  setConnection({ runId: null, reconnecting: false });
}

export async function openRunStream(
  runId: string,
  opts: OpenRunStreamOptions = {},
): Promise<RunStreamHandle> {
  let run: RunMeta;
  try {
    run = await getRun(runId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), close: () => {} };
  }

  closeCurrent();
  runStore.reset(run);
  history.replaceState?.(null, '', `#${runId}`);

  const es = new EventSource(`/api/runs/${runId}/stream`);
  currentEs = es;
  currentRunId = runId;
  setConnection({ runId, reconnecting: false });

  const stale = (): boolean => currentRunId !== runId || currentEs !== es;

  es.onopen = () => {
    if (!stale()) setConnection({ runId, reconnecting: false });
  };

  es.onmessage = (msg: MessageEvent<string>) => {
    if (stale()) return;
    let ev: InboundMessage;
    try {
      ev = JSON.parse(msg.data) as InboundMessage;
    } catch {
      return;
    }
    if (ev.type === 'stream_end') {
      runStore.markStreamEnd();
      closeCurrent();
      return;
    }
    runStore.applyEvent(ev as RunEvent);
    if (ev.type === 'run_finished') {
      closeCurrent();
      opts.onFinished?.(ev.data);
    }
  };

  es.onerror = () => {
    if (stale() || !runStore.getSnapshot().live) {
      es.close();
      if (currentEs === es) closeCurrent();
      return;
    }
    setConnection({ runId, reconnecting: true });
    opts.onReconnecting?.(true);
  };

  const close = (): void => {
    es.close();
    if (currentEs === es) closeCurrent();
  };

  return { close };
}
