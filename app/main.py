"""HTTP API + SSE live stream + static UI."""

import asyncio
import json
import shutil
import uuid
from dataclasses import asdict, fields

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .agent import DEFAULT_SYSTEM, RunConfig, run_agent
from .config import ROOT, WORKSPACES_DIR, load_providers
from .llm import list_models
from .store import Store
from .tools import TOOLS

app = FastAPI(title="agent-xray")
store = Store()
providers = load_providers()
tasks: dict[str, asyncio.Task] = {}


@app.get("/api/meta")
def meta() -> dict:
    return {
        "providers": [{"id": p.id, "label": p.label} for p in providers.values() if p.enabled],
        "tools": [{"name": t.name, "description": t.description} for t in TOOLS.values()],
        "default_system": DEFAULT_SYSTEM,
    }


@app.get("/api/models")
async def models(provider: str) -> list[str]:
    p = providers.get(provider)
    if not p or not p.enabled:
        raise HTTPException(404, "unknown or unconfigured provider")
    try:
        async with httpx.AsyncClient() as http:
            return await list_models(http, p)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"could not list models: {e}")


@app.post("/api/runs")
async def create_run(body: dict) -> dict:
    allowed = {f.name for f in fields(RunConfig)}
    try:
        cfg = RunConfig(**{k: v for k, v in body.items() if k in allowed})
    except TypeError as e:
        raise HTTPException(422, str(e))
    p = providers.get(cfg.provider)
    if not p or not p.enabled:
        raise HTTPException(400, f"provider '{cfg.provider}' is not configured (set its key in .env)")
    if not cfg.model.strip() or not cfg.prompt.strip():
        raise HTTPException(422, "model and prompt are required")
    if unknown := set(cfg.tools) - set(TOOLS):
        raise HTTPException(422, f"unknown tools: {sorted(unknown)}")
    cfg.max_turns = max(1, min(int(cfg.max_turns), 50))

    run_id = uuid.uuid4().hex[:12]
    store.create_run(run_id, cfg.provider, cfg.model, cfg.prompt, asdict(cfg))
    task = asyncio.create_task(run_agent(store, p, cfg, run_id))
    tasks[run_id] = task
    task.add_done_callback(lambda _: tasks.pop(run_id, None))
    return {"id": run_id}


@app.get("/api/runs")
def runs(q: str | None = None, status: str | None = None, limit: int = 100, offset: int = 0) -> list[dict]:
    limit = max(0, min(limit, 500))
    offset = max(0, offset)
    return store.list_runs(q=q, status=status, limit=limit, offset=offset)


@app.get("/api/runs/{run_id}")
def run(run_id: str) -> dict:
    r = store.get_run(run_id)
    if not r:
        raise HTTPException(404)
    return r


@app.get("/api/runs/{run_id}/events")
def run_events(run_id: str) -> list[dict]:
    if not store.get_run(run_id):
        raise HTTPException(404)
    return store.events(run_id)


@app.post("/api/runs/{run_id}/cancel")
async def cancel(run_id: str) -> dict:
    task = tasks.get(run_id)
    if task:
        task.cancel()
    return {"cancelled": bool(task)}


@app.delete("/api/runs/{run_id}")
def delete(run_id: str) -> dict:
    if run_id in tasks:
        raise HTTPException(409, "run is still live; cancel it first")
    if not store.get_run(run_id):
        raise HTTPException(404)
    store.delete_run(run_id)
    shutil.rmtree(WORKSPACES_DIR / run_id, ignore_errors=True)
    return {"deleted": run_id}


@app.get("/api/runs/{run_id}/stream")
async def stream(run_id: str) -> StreamingResponse:
    """Replay stored events, then tail live ones. Same stream for live and historic runs."""
    if not store.get_run(run_id):
        raise HTTPException(404)

    async def gen():
        # Subscribe before reading history so nothing falls in the gap; dedupe by seq.
        q = store.subscribe(run_id)
        try:
            last = 0
            for ev in store.events(run_id):
                last = ev["seq"]
                yield f"data: {json.dumps(ev)}\n\n"
                if ev["type"] == "run_finished":
                    return
            if run_id not in tasks:  # finished without a run_finished event (server restart)
                yield 'data: {"type": "stream_end"}\n\n'
                return
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if ev["seq"] <= last:
                    continue
                yield f"data: {json.dumps(ev)}\n\n"
                if ev["type"] == "run_finished":
                    return
        finally:
            store.unsubscribe(run_id, q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# Legacy static assets stay reachable at /static/* during the SPA migration.
if (ROOT / "static").is_dir():
    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

DIST = ROOT / "web" / "dist"
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{full_path:path}")
def spa(full_path: str) -> FileResponse:
    """SPA fallback. Registered last so every /api route wins."""
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(404)
    if full_path:
        for base in (DIST, ROOT / "static"):
            candidate = base / full_path
            try:
                candidate.resolve().relative_to(base.resolve())
            except ValueError:
                continue
            if candidate.is_file():
                return FileResponse(candidate)
    if (DIST / "index.html").is_file():
        return FileResponse(DIST / "index.html")
    return FileResponse(ROOT / "static" / "index.html")
