"""The agent loop, instrumented. Every step emits a timestamped event.

Event types (data fields in brackets):
  run_started        [provider, model, prompt, system, tools, config]
  llm_call_started   [call, request]             exact request body sent (minus auth)
  llm_headers        [call, ms]                  HTTP response headers arrived
  llm_first_token    [call, ttft_ms]             first chunk carrying real output
  reasoning_delta    [call, text]                visible thinking tokens (if the model exposes them)
  content_delta      [call, text]
  tool_call_detected [call, index, id, name]     model committed to a tool mid-stream
  tool_args_delta    [call, index, text]
  llm_call_finished  [call, ...timings, usage, content, reasoning, tool_calls, finish_reason]
  tool_started       [call, id, name, args]
  tool_finished      [call, id, name, ok, result, duration_ms]
  error              [message]
  run_finished       [status, final_answer, totals]
"""

import asyncio
import json
import random
import time
from dataclasses import asdict, dataclass, field

import httpx

from .config import WORKSPACES_DIR, Provider
from .llm import stream_chat
from .store import Store
from .tools import TOOLS, ToolContext, ToolError

DEFAULT_SYSTEM = (
    "You are a capable agent. Use the provided tools whenever they help you answer accurately. "
    "Your workspace directory starts empty. When you are done, reply with your final answer."
)


@dataclass
class RunConfig:
    provider: str
    model: str
    prompt: str
    system: str = DEFAULT_SYSTEM
    tools: list[str] = field(default_factory=lambda: list(TOOLS))
    max_turns: int = 10
    temperature: float | None = None
    max_tokens: int | None = None
    reasoning_effort: str | None = None  # low | medium | high
    tool_delay_ms: int = 0               # experiment knob: slow every tool down
    tool_failure_rate: float = 0.0       # experiment knob: make tools fail randomly


class ThinkSplitter:
    """Split inline <think>...</think> blocks (DeepSeek-R1, Qwen3 on Ollama) out of content deltas."""

    def __init__(self) -> None:
        self.buf = ""
        self.inside = False

    def feed(self, text: str) -> list[tuple[str, str]]:
        self.buf += text
        out: list[tuple[str, str]] = []
        while True:
            tag = "</think>" if self.inside else "<think>"
            kind = "reasoning" if self.inside else "content"
            i = self.buf.find(tag)
            if i >= 0:
                if i:
                    out.append((kind, self.buf[:i]))
                self.buf = self.buf[i + len(tag):]
                self.inside = not self.inside
                continue
            # Hold back a suffix that could be the start of a tag split across chunks.
            keep = next((k for k in range(min(len(tag) - 1, len(self.buf)), 0, -1) if tag.startswith(self.buf[-k:])), 0)
            if len(self.buf) > keep:
                out.append((kind, self.buf[:len(self.buf) - keep]))
                self.buf = self.buf[len(self.buf) - keep:]
            return out

    def flush(self) -> list[tuple[str, str]]:
        out = [("reasoning" if self.inside else "content", self.buf)] if self.buf else []
        self.buf = ""
        return out


class Recorder:
    def __init__(self, store: Store, run_id: str) -> None:
        self.store = store
        self.run_id = run_id
        self.t0 = time.perf_counter()
        self.seq = 0

    def now(self) -> float:
        return round((time.perf_counter() - self.t0) * 1000, 2)

    def emit(self, type_: str, **data) -> None:
        self.seq += 1
        self.store.add_event(self.run_id, {"seq": self.seq, "t_ms": self.now(), "type": type_, "data": data})


def build_body(provider: Provider, cfg: RunConfig, messages: list[dict], tool_schemas: list[dict]) -> dict:
    body: dict = {"model": cfg.model, "messages": messages, "stream": True}
    if provider.id != "ollama":
        body["stream_options"] = {"include_usage": True}
    if tool_schemas:
        body["tools"] = tool_schemas
        body["tool_choice"] = "auto"
    if cfg.temperature is not None:
        body["temperature"] = cfg.temperature
    if cfg.max_tokens:
        body["max_completion_tokens" if provider.id == "openai" else "max_tokens"] = cfg.max_tokens
    if cfg.reasoning_effort:
        if provider.id == "openrouter":
            body["reasoning"] = {"effort": cfg.reasoning_effort}
        else:
            body["reasoning_effort"] = cfg.reasoning_effort
    return body


async def llm_call(rec: Recorder, http: httpx.AsyncClient, provider: Provider, body: dict, call: int) -> dict:
    """Stream one completion, emitting deltas. Returns the assembled result with timings."""
    rec.emit("llm_call_started", call=call, request=body)
    start = rec.now()
    marks: dict[str, float] = {}
    content, reasoning = [], []
    tool_calls: dict[int, dict] = {}
    usage: dict = {}
    finish_reason = None
    chunks = 0
    splitter = ThinkSplitter()

    def mark(name: str) -> None:
        if name not in marks:
            marks[name] = rec.now()

    def output(kind: str, text: str) -> None:
        if not text:
            return
        if "first_token" not in marks:
            mark("first_token")
            rec.emit("llm_first_token", call=call, ttft_ms=round(marks["first_token"] - start, 2))
        mark(f"first_{kind}")
        marks[f"last_{kind}"] = rec.now()
        (reasoning if kind == "reasoning" else content).append(text)
        rec.emit(f"{kind}_delta", call=call, text=text)

    async for chunk in stream_chat(http, provider, body):
        if chunk.get("__headers__"):
            rec.emit("llm_headers", call=call, ms=round(rec.now() - start, 2))
            continue
        chunks += 1
        usage = chunk.get("usage") or (chunk.get("x_groq") or {}).get("usage") or usage
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            finish_reason = choice.get("finish_reason") or finish_reason
            output("reasoning", delta.get("reasoning") or delta.get("reasoning_content") or "")
            for kind, text in splitter.feed(delta.get("content") or ""):
                output(kind, text)
            for tc in delta.get("tool_calls") or []:
                idx = tc.get("index", len(tool_calls))
                fn = tc.get("function") or {}
                slot = tool_calls.setdefault(idx, {"id": None, "name": "", "arguments": ""})
                if tc.get("id"):
                    slot["id"] = tc["id"]
                if fn.get("name") and not slot["name"]:
                    slot["name"] = fn["name"]
                    if "first_token" not in marks:
                        mark("first_token")
                        rec.emit("llm_first_token", call=call, ttft_ms=round(marks["first_token"] - start, 2))
                    mark("first_tool")
                    rec.emit("tool_call_detected", call=call, index=idx, id=slot["id"], name=slot["name"])
                if fn.get("arguments"):
                    slot["arguments"] += fn["arguments"]
                    marks["last_tool"] = rec.now()
                    rec.emit("tool_args_delta", call=call, index=idx, text=fn["arguments"])
    for kind, text in splitter.flush():
        output(kind, text)

    end = rec.now()
    calls = []
    for idx in sorted(tool_calls):
        slot = tool_calls[idx]
        calls.append({"id": slot["id"] or f"call_{call}_{idx}", "name": slot["name"], "arguments": slot["arguments"]})

    completion = usage.get("completion_tokens")
    gen_ms = end - marks["first_token"] if "first_token" in marks else None
    result = {
        "call": call,
        "start_ms": start,
        "end_ms": end,
        "duration_ms": round(end - start, 2),
        "ttft_ms": round(marks["first_token"] - start, 2) if "first_token" in marks else None,
        "marks": marks,
        "chunks": chunks,
        "finish_reason": finish_reason,
        "usage": usage,
        "tokens_per_s": round(completion / (gen_ms / 1000), 1) if completion and gen_ms else None,
        "content": "".join(content),
        "reasoning": "".join(reasoning),
        "tool_calls": calls,
    }
    rec.emit("llm_call_finished", **result)
    return result


async def run_tool(rec: Recorder, ctx: ToolContext, cfg: RunConfig, call: int, tc: dict) -> str:
    parse_error = ""
    try:
        args = json.loads(tc["arguments"] or "{}")
    except json.JSONDecodeError as e:
        args = None
        parse_error = f"invalid JSON arguments: {e}"
    rec.emit("tool_started", call=call, id=tc["id"], name=tc["name"], args=args, raw_args=tc["arguments"])
    start = rec.now()
    ok = False
    try:
        if args is None:
            raise ToolError(parse_error)
        if not isinstance(args, dict):
            raise ToolError("arguments must be a JSON object")
        if tc["name"] not in cfg.tools:
            raise ToolError(f"unknown tool: {tc['name']}")
        if cfg.tool_delay_ms:
            await asyncio.sleep(cfg.tool_delay_ms / 1000)
        if cfg.tool_failure_rate and random.random() < cfg.tool_failure_rate:
            raise ToolError("injected failure (tool_failure_rate)")
        result = await TOOLS[tc["name"]].fn(ctx, args)
        ok = True
    except KeyError as e:
        result = f"ERROR: missing required argument {e}"
    except (ToolError, httpx.HTTPError, OSError, ValueError) as e:
        result = f"ERROR: {type(e).__name__}: {e}"
    end = rec.now()
    rec.emit("tool_finished", call=call, id=tc["id"], name=tc["name"], ok=ok, result=result,
             start_ms=start, end_ms=end, duration_ms=round(end - start, 2))
    return result


async def run_agent(store: Store, provider: Provider, cfg: RunConfig, run_id: str) -> None:
    rec = Recorder(store, run_id)
    workspace = WORKSPACES_DIR / run_id
    workspace.mkdir(parents=True, exist_ok=True)
    tool_schemas = [TOOLS[n].schema() for n in cfg.tools if n in TOOLS]
    messages: list[dict] = []
    if cfg.system:
        messages.append({"role": "system", "content": cfg.system})
    messages.append({"role": "user", "content": cfg.prompt})

    rec.emit("run_started", provider=provider.id, model=cfg.model, prompt=cfg.prompt, system=cfg.system,
             tools=[t["function"]["name"] for t in tool_schemas], config=asdict(cfg))
    llm_results: list[dict] = []
    tool_ms = 0.0
    tool_count = tool_errors = 0
    status, final_answer = "max_turns", None

    try:
        async with httpx.AsyncClient() as http:
            ctx = ToolContext(workspace=workspace, http=http)
            for call in range(1, cfg.max_turns + 1):
                res = await llm_call(rec, http, provider, build_body(provider, cfg, messages, tool_schemas), call)
                llm_results.append(res)
                assistant: dict = {"role": "assistant", "content": res["content"] or None}
                if res["tool_calls"]:
                    assistant["tool_calls"] = [
                        {"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                        for tc in res["tool_calls"]
                    ]
                messages.append(assistant)
                if not res["tool_calls"]:
                    status, final_answer = "completed", res["content"]
                    break
                # Parallel tool calls really run in parallel, so overlap shows on the timeline.
                t_before = rec.now()
                results = await asyncio.gather(*(run_tool(rec, ctx, cfg, call, tc) for tc in res["tool_calls"]))
                tool_ms += rec.now() - t_before
                tool_count += len(results)
                tool_errors += sum(r.startswith("ERROR:") for r in results)
                for tc, result in zip(res["tool_calls"], results):
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
    except asyncio.CancelledError:
        status = "cancelled"
    except Exception as e:  # surface anything to the UI rather than dying silently
        status = "error"
        rec.emit("error", message=f"{type(e).__name__}: {e}")

    wall = rec.now()
    llm_ms = sum(r["duration_ms"] for r in llm_results)
    usages = [r["usage"] for r in llm_results]

    def total(key: str, sub: str | None = None) -> int:
        return sum(((u.get(sub) or {}).get(key) if sub else u.get(key)) or 0 for u in usages)

    totals = {
        "wall_ms": wall,
        "llm_ms": round(llm_ms, 2),
        "tool_ms": round(tool_ms, 2),
        "overhead_ms": round(wall - llm_ms - tool_ms, 2),
        "llm_calls": len(llm_results),
        "tool_calls": tool_count,
        "tool_errors": tool_errors,
        "prompt_tokens": total("prompt_tokens"),
        "completion_tokens": total("completion_tokens"),
        "reasoning_tokens": total("reasoning_tokens", "completion_tokens_details"),
        "cached_tokens": total("cached_tokens", "prompt_tokens_details"),
        "cost": round(sum(u.get("cost") or 0 for u in usages), 6) or None,
        "first_ttft_ms": llm_results[0]["ttft_ms"] if llm_results else None,
    }
    rec.emit("run_finished", status=status, final_answer=final_answer, totals=totals)
    store.finish_run(run_id, status, totals)
