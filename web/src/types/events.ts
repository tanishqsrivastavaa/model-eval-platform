/**
 * Server event schema — port of static/app.js reduce() cases and
 * app/agent.py's documented emit payloads.
 *
 * Every stored event is {seq, t_ms, type, data}; the SSE stream also emits a
 * bare {type:'stream_end'} sentinel with no seq when a run ended without a
 * run_finished event (server restart).
 */
import type { RunStatus } from '@/components/Pill';

export type { RunStatus };

export interface Usage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  cost?: number | null;
  [key: string]: unknown;
}

export interface Totals {
  wall_ms: number;
  llm_ms: number;
  tool_ms: number;
  overhead_ms: number;
  llm_calls: number;
  tool_calls: number;
  tool_errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cost: number | null;
  first_ttft_ms: number | null;
}

export interface ChatToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  [key: string]: unknown;
}

/** Exact request body sent to the LLM (minus auth), as recorded by agent.py. */
export interface LlmRequestBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: unknown[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: string;
  reasoning?: { effort: string };
  [key: string]: unknown;
}

/** RunConfig asdict — POST /api/runs body and run.config. */
export interface RunConfigPayload {
  provider: string;
  model: string;
  prompt: string;
  system: string;
  tools: string[];
  max_turns: number;
  temperature: number | null;
  max_tokens: number | null;
  reasoning_effort: string | null;
  tool_delay_ms: number;
  tool_failure_rate: number;
}

/** Row shape from GET /api/runs and GET /api/runs/{id}. */
export interface RunMeta {
  id: string;
  created_at: number;
  provider: string;
  model: string;
  prompt: string;
  config: RunConfigPayload;
  status: RunStatus;
  summary: Totals | null;
}

export interface RunStartedData {
  provider: string;
  model: string;
  prompt: string;
  system: string;
  tools: string[];
  config: RunConfigPayload;
}

export interface LlmCallStartedData {
  call: number;
  request: LlmRequestBody;
}

export interface LlmHeadersData {
  call: number;
  ms: number;
}

export interface LlmFirstTokenData {
  call: number;
  ttft_ms: number;
}

export interface ReasoningDeltaData {
  call: number;
  text: string;
}

export interface ContentDeltaData {
  call: number;
  text: string;
}

export interface ToolCallDetectedData {
  call: number;
  index: number;
  id: string | null;
  name: string;
}

export interface ToolArgsDeltaData {
  call: number;
  index: number;
  text: string;
}

export interface FinishedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmCallFinishedData {
  call: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  ttft_ms: number | null;
  marks: Record<string, number>;
  chunks: number;
  finish_reason: string | null;
  usage: Usage;
  tokens_per_s: number | null;
  content: string;
  reasoning: string;
  tool_calls: FinishedToolCall[];
}

export interface ToolStartedData {
  call: number;
  id: string;
  name: string;
  args: Record<string, unknown> | null;
  raw_args: string;
}

export interface ToolFinishedData {
  call: number;
  id: string;
  name: string;
  ok: boolean;
  result: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
}

export interface ErrorData {
  message: string;
}

export interface RunFinishedData {
  status: RunStatus;
  final_answer: string | null;
  totals: Totals;
}

type Ev<T extends string, D> = { seq: number; t_ms: number; type: T; data: D };

/** All 13 server event types, enveloped. */
export type RunEvent =
  | Ev<'run_started', RunStartedData>
  | Ev<'llm_call_started', LlmCallStartedData>
  | Ev<'llm_headers', LlmHeadersData>
  | Ev<'llm_first_token', LlmFirstTokenData>
  | Ev<'reasoning_delta', ReasoningDeltaData>
  | Ev<'content_delta', ContentDeltaData>
  | Ev<'tool_call_detected', ToolCallDetectedData>
  | Ev<'tool_args_delta', ToolArgsDeltaData>
  | Ev<'llm_call_finished', LlmCallFinishedData>
  | Ev<'tool_started', ToolStartedData>
  | Ev<'tool_finished', ToolFinishedData>
  | Ev<'error', ErrorData>
  | Ev<'run_finished', RunFinishedData>;

export type RunEventType = RunEvent['type'];

/** Bare sentinel — no seq, no data, not recorded in the events list. */
export interface StreamEndEvent {
  type: 'stream_end';
}

export type InboundMessage = RunEvent | StreamEndEvent;
