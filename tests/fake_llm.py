"""A scripted OpenAI-compatible streaming server, for exercising the harness without an API key.

Turn 1: streams reasoning, a little text, then two *parallel* tool calls whose JSON
arguments arrive in fragments. Turn 2 (after tool results): streams an answer with an
inline <think> block whose tags are split across chunks.

Run: uv run uvicorn tests.fake_llm:app --port 8765
"""

import asyncio
import json

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


def chunk(delta: dict | None = None, finish: str | None = None, usage: dict | None = None) -> str:
    body: dict = {"id": "fake", "object": "chat.completion.chunk", "model": "fake-agent",
                  "choices": [] if delta is None else [{"index": 0, "delta": delta, "finish_reason": finish}]}
    if usage:
        body["usage"] = usage
    return f"data: {json.dumps(body)}\n\n"


@app.get("/v1/models")
def models() -> dict:
    return {"data": [{"id": "fake-agent"}]}


@app.post("/v1/chat/completions")
async def completions(req: Request) -> StreamingResponse:
    body = await req.json()
    tool_results = [m for m in body["messages"] if m["role"] == "tool"]

    async def turn1():
        await asyncio.sleep(0.30)  # "prefill"
        yield ": OPENROUTER PROCESSING\n\n"
        yield chunk({"role": "assistant", "content": ""})
        for w in ["I need ", "to compute ", "two things. ", "I'll call tools ", "in parallel."]:
            await asyncio.sleep(0.04)
            yield chunk({"reasoning": w})
        for w in ["Let me ", "check."]:
            await asyncio.sleep(0.03)
            yield chunk({"content": w})
        calls = [("call_a", "calculator", ['{"expre', 'ssion": "2**', '64"}']),
                 ("call_b", "run_python", ['{"code": "import time; ', 'time.sleep(0.2); ', 'print(sum(range(10)))"}'])]
        for i, (cid, name, frags) in enumerate(calls):
            await asyncio.sleep(0.05)
            yield chunk({"tool_calls": [{"index": i, "id": cid, "type": "function", "function": {"name": name, "arguments": ""}}]})
            for f in frags:
                await asyncio.sleep(0.03)
                yield chunk({"tool_calls": [{"index": i, "function": {"arguments": f}}]})
        yield chunk({}, finish="tool_calls")
        yield chunk(None, usage={"prompt_tokens": 210, "completion_tokens": 48,
                                 "completion_tokens_details": {"reasoning_tokens": 12}, "cost": 0.00042})
        yield "data: [DONE]\n\n"

    async def turn2():
        await asyncio.sleep(0.25)
        summary = " and ".join(m["content"].splitlines()[-1] for m in tool_results)
        for w in ["<thi", "nk>Both tools ", "returned.</th", "ink>", "Results: ", summary, "."]:
            await asyncio.sleep(0.04)
            yield chunk({"content": w})
        yield chunk({}, finish="stop")
        yield chunk(None, usage={"prompt_tokens": 320, "completion_tokens": 20, "cost": 0.0003})
        yield "data: [DONE]\n\n"

    return StreamingResponse(turn2() if tool_results else turn1(), media_type="text/event-stream")
