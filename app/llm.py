"""Raw streaming client for OpenAI-compatible /chat/completions.

Deliberately no SDK: we want to see every SSE chunk exactly when it arrives.
"""

import json
from collections.abc import AsyncIterator

import httpx

from .config import Provider


class LLMError(Exception):
    pass


def auth_headers(provider: Provider) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if provider.api_key:
        headers["Authorization"] = f"Bearer {provider.api_key}"
    if provider.id == "openrouter":
        headers["HTTP-Referer"] = "http://localhost/agent-xray"
        headers["X-Title"] = "agent-xray"
    return headers


async def stream_chat(client: httpx.AsyncClient, provider: Provider, body: dict) -> AsyncIterator[dict]:
    """Yield each parsed JSON chunk of a streaming chat completion."""
    url = provider.base_url.rstrip("/") + "/chat/completions"
    timeout = httpx.Timeout(connect=15, read=300, write=30, pool=15)
    async with client.stream("POST", url, json=body, headers=auth_headers(provider), timeout=timeout) as resp:
        if resp.status_code >= 400:
            text = (await resp.aread()).decode(errors="replace")
            raise LLMError(f"HTTP {resp.status_code} from {provider.label}: {text[:2000]}")
        yield {"__headers__": True}  # lets the caller time "server accepted" separately from first token
        async for line in resp.aiter_lines():
            # Blank lines separate events; lines starting with ':' are SSE comments
            # (OpenRouter sends ": OPENROUTER PROCESSING" keep-alives).
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            if chunk.get("error"):
                raise LLMError(f"{provider.label} stream error: {json.dumps(chunk['error'])[:2000]}")
            yield chunk


async def list_models(client: httpx.AsyncClient, provider: Provider) -> list[str]:
    url = provider.base_url.rstrip("/") + "/models"
    resp = await client.get(url, headers=auth_headers(provider), timeout=15)
    resp.raise_for_status()
    models = resp.json().get("data", [])
    if provider.id == "openrouter":
        # Only models that accept tool definitions are useful for agent runs.
        models = [m for m in models if "tools" in (m.get("supported_parameters") or [])]
    return sorted(m["id"] for m in models)
