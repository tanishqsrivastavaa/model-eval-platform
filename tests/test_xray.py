import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from app.agent import ThinkSplitter
from app.tools import ToolContext, ToolError, calculator, read_file

ROOT = Path(__file__).resolve().parent.parent


# ---------- unit ----------

def split_all(chunks: list[str]) -> list[tuple[str, str]]:
    s = ThinkSplitter()
    out = [p for c in chunks for p in s.feed(c)] + s.flush()
    merged: list[tuple[str, str]] = []
    for kind, text in out:
        if merged and merged[-1][0] == kind:
            merged[-1] = (kind, merged[-1][1] + text)
        else:
            merged.append((kind, text))
    return merged


def test_think_splitter_handles_tags_split_across_chunks():
    assert split_all(["<thi", "nk>plan</th", "ink>answer"]) == [("reasoning", "plan"), ("content", "answer")]


def test_think_splitter_passes_plain_text_and_lone_angle_brackets():
    assert split_all(["a < b", " and c <", "d"]) == [("content", "a < b and c <d")]


def test_calculator_rejects_code_and_huge_exponents():
    ctx = ToolContext(workspace=Path("."), http=None)  # type: ignore[arg-type]
    assert asyncio.run(calculator(ctx, {"expression": "2**10 + 1"})) == "1025"
    with pytest.raises(ToolError):
        asyncio.run(calculator(ctx, {"expression": "__import__('os')"}))
    with pytest.raises(ToolError):
        asyncio.run(calculator(ctx, {"expression": "9**99999999"}))


def test_file_tools_cannot_escape_workspace(tmp_path):
    ctx = ToolContext(workspace=tmp_path, http=None)  # type: ignore[arg-type]
    with pytest.raises(ToolError):
        asyncio.run(read_file(ctx, {"path": "../../etc/passwd"}))


# ---------- end-to-end through the real server and a fake model ----------

def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_up(url: str) -> None:
    for _ in range(100):
        try:
            httpx.get(url, timeout=1)
            return
        except httpx.HTTPError:
            time.sleep(0.1)
    raise RuntimeError(f"{url} never came up")


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    fake_port, app_port = free_port(), free_port()
    data = tmp_path_factory.mktemp("data")
    env = {**os.environ, "XRAY_FAKE_BASE_URL": f"http://127.0.0.1:{fake_port}/v1", "XRAY_DATA_DIR": str(data)}
    procs = [
        subprocess.Popen([sys.executable, "-m", "uvicorn", "tests.fake_llm:app", "--port", str(fake_port)], cwd=ROOT, env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
        subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(app_port)], cwd=ROOT, env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    ]
    try:
        wait_up(f"http://127.0.0.1:{fake_port}/v1/models")
        wait_up(f"http://127.0.0.1:{app_port}/api/meta")
        yield f"http://127.0.0.1:{app_port}"
    finally:
        for p in procs:
            p.terminate()
            p.wait()


def read_stream(base: str, run_id: str) -> list[dict]:
    events = []
    with httpx.stream("GET", f"{base}/api/runs/{run_id}/stream", timeout=30) as r:
        for line in r.iter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[5:]))
    return events


def test_full_run_emits_ordered_timed_trace(server):
    run_id = httpx.post(f"{server}/api/runs", json={"provider": "fake", "model": "fake-agent", "prompt": "go"}).json()["id"]
    events = read_stream(server, run_id)
    types = [e["type"] for e in events]

    assert types[0] == "run_started" and types[-1] == "run_finished"
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert all(a["t_ms"] <= b["t_ms"] for a, b in zip(events, events[1:]))
    for t in ["llm_headers", "llm_first_token", "reasoning_delta", "content_delta", "tool_call_detected",
              "tool_args_delta", "tool_started", "tool_finished"]:
        assert t in types, t

    finished = [e["data"] for e in events if e["type"] == "llm_call_finished"]
    assert len(finished) == 2
    first = finished[0]
    assert [tc["name"] for tc in first["tool_calls"]] == ["calculator", "run_python"]
    assert json.loads(first["tool_calls"][0]["arguments"]) == {"expression": "2**64"}
    assert first["reasoning"] == "I need to compute two things. I'll call tools in parallel."
    assert first["ttft_ms"] >= 250  # fake server sleeps 300ms before the first token
    assert first["tokens_per_s"] and first["usage"]["completion_tokens"] == 48
    # The inline <think> block must land in reasoning, not the answer.
    assert finished[1]["reasoning"] == "Both tools returned."
    assert finished[1]["content"].startswith("Results: ")

    tools = {e["data"]["name"]: e["data"] for e in events if e["type"] == "tool_finished"}
    assert tools["calculator"]["ok"] and tools["calculator"]["result"] == "18446744073709551616"
    assert tools["run_python"]["ok"] and tools["run_python"]["result"].strip().endswith("45")
    assert tools["run_python"]["duration_ms"] >= 200
    # Parallel: calculator finishes while run_python is still sleeping.
    assert tools["calculator"]["end_ms"] < tools["run_python"]["end_ms"]
    started = {e["data"]["name"]: e["t_ms"] for e in events if e["type"] == "tool_started"}
    assert abs(started["calculator"] - started["run_python"]) < 50

    end = events[-1]["data"]
    assert end["status"] == "completed"
    assert "18446744073709551616" in end["final_answer"] and "45" in end["final_answer"]
    tot = end["totals"]
    assert tot["llm_calls"] == 2 and tot["tool_calls"] == 2 and tot["tool_errors"] == 0
    assert tot["prompt_tokens"] == 530 and tot["reasoning_tokens"] == 12 and tot["cost"] == 0.00072

    # Replay of a finished run returns the identical stream.
    assert read_stream(server, run_id) == events
    assert httpx.get(f"{server}/api/runs/{run_id}").json()["status"] == "completed"


def test_injected_failures_reach_the_model_as_errors(server):
    run_id = httpx.post(f"{server}/api/runs", json={
        "provider": "fake", "model": "fake-agent", "prompt": "go", "tool_failure_rate": 1.0, "tool_delay_ms": 100,
    }).json()["id"]
    events = read_stream(server, run_id)
    results = [e["data"] for e in events if e["type"] == "tool_finished"]
    assert results and all(not r["ok"] and "injected failure" in r["result"] for r in results)
    assert all(r["duration_ms"] >= 100 for r in results)
    assert events[-1]["data"]["totals"]["tool_errors"] == 2


def test_rejects_unconfigured_provider(server):
    r = httpx.post(f"{server}/api/runs", json={"provider": "nope", "model": "x", "prompt": "hi"})
    assert r.status_code == 400
