/**
 * HTTP client — error semantics ported from static/app.js:33-38:
 *   throw Error(body.detail) when detail is a string,
 *   else throw Error(JSON.stringify(body.detail ?? body)).
 * GET/HEAD requests send no Content-Type.
 */
import type { RunEvent, RunMeta } from '@/types/events';

export interface MetaResponse {
  providers: { id: string; label: string }[];
  tools: { name: string; description: string }[];
  default_system: string;
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const baseHeaders: Record<string, string> =
    method === 'GET' || method === 'HEAD' ? {} : { 'Content-Type': 'application/json' };
  const headers = { ...baseHeaders, ...(opts.headers as Record<string, string> | undefined) };
  const res = await fetch(path, { ...opts, headers });
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (!res.ok) {
    throw new Error(
      typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body),
    );
  }
  return body as T;
}

export function getMeta(): Promise<MetaResponse> {
  return api<MetaResponse>('/api/meta');
}

export function listModels(provider: string): Promise<string[]> {
  return api<string[]>(`/api/models?provider=${encodeURIComponent(provider)}`);
}

export function createRun(body: unknown): Promise<{ id: string }> {
  return api<{ id: string }>('/api/runs', { method: 'POST', body: JSON.stringify(body) });
}

export function listRuns(
  q?: string,
  status?: string,
  limit?: number,
  offset?: number,
): Promise<RunMeta[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString();
  return api<RunMeta[]>(`/api/runs${qs ? `?${qs}` : ''}`);
}

export function getRun(runId: string): Promise<RunMeta> {
  return api<RunMeta>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function getRunEvents(runId: string): Promise<RunEvent[]> {
  return api<RunEvent[]>(`/api/runs/${encodeURIComponent(runId)}/events`);
}

export function cancelRun(runId: string): Promise<{ cancelled: boolean }> {
  return api<{ cancelled: boolean }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  });
}

export function deleteRun(runId: string): Promise<{ deleted: string }> {
  return api<{ deleted: string }>(`/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
}
