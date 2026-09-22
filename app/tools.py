"""Built-in tools. Each run gets its own workspace directory; file tools are confined to it."""

import ast
import asyncio
import html
import operator
import os
import re
import resource
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

MAX_RESULT_CHARS = 8000


class ToolError(Exception):
    pass


@dataclass
class ToolContext:
    workspace: Path
    http: httpx.AsyncClient


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict
    fn: Callable[[ToolContext, dict], Awaitable[str]]

    def schema(self) -> dict:
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": self.parameters},
        }


def _resolve(ctx: ToolContext, rel: str) -> Path:
    path = (ctx.workspace / rel).resolve()
    if not path.is_relative_to(ctx.workspace.resolve()):
        raise ToolError(f"path escapes the workspace: {rel}")
    return path


def _truncate(text: str) -> str:
    if len(text) <= MAX_RESULT_CHARS:
        return text
    return text[:MAX_RESULT_CHARS] + f"\n...[truncated {len(text) - MAX_RESULT_CHARS} chars]"


async def list_files(ctx: ToolContext, args: dict) -> str:
    root = _resolve(ctx, args.get("path", "."))
    if not root.is_dir():
        raise ToolError(f"not a directory: {args.get('path', '.')}")
    entries = sorted(p.relative_to(ctx.workspace.resolve()).as_posix() + ("/" if p.is_dir() else "")
                     for p in root.rglob("*"))
    return "\n".join(entries) or "(empty)"


async def read_file(ctx: ToolContext, args: dict) -> str:
    path = _resolve(ctx, args["path"])
    if not path.is_file():
        raise ToolError(f"no such file: {args['path']}")
    return _truncate(path.read_text(errors="replace"))


async def write_file(ctx: ToolContext, args: dict) -> str:
    path = _resolve(ctx, args["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    content = args.get("content", "")
    path.write_text(content)
    return f"wrote {len(content)} chars to {args['path']}"


def _limit_child() -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))


async def run_python(ctx: ToolContext, args: dict) -> str:
    # Minimal env so the child never sees API keys from our process.
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(ctx.workspace), "PYTHONIOENCODING": "utf-8"}
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-I", "-c", args["code"],
        cwd=ctx.workspace, env=env, preexec_fn=_limit_child,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=20)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise ToolError("timed out after 20s")
    text = out.decode(errors="replace")
    if err:
        text += "\n[stderr]\n" + err.decode(errors="replace")
    return _truncate(f"[exit {proc.returncode}]\n{text}")


async def fetch_url(ctx: ToolContext, args: dict) -> str:
    url = args["url"]
    if not url.startswith(("http://", "https://")):
        raise ToolError("url must start with http:// or https://")
    resp = await ctx.http.get(url, timeout=15, follow_redirects=True, headers={"User-Agent": "agent-xray/0.1"})
    body = resp.text
    if "html" in resp.headers.get("content-type", ""):
        body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", body)
        body = html.unescape(re.sub(r"<[^>]+>", " ", body))
        body = re.sub(r"\s+", " ", body).strip()
    return _truncate(f"[HTTP {resp.status_code}]\n{body}")


_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
    ast.USub: operator.neg, ast.UAdd: operator.pos,
}


def _eval(node: ast.AST) -> float:
    match node:
        case ast.Expression(body=b):
            return _eval(b)
        case ast.Constant(value=v) if isinstance(v, int | float):
            return v
        case ast.BinOp(left=l, op=op, right=r) if type(op) in _OPS:
            if isinstance(op, ast.Pow) and abs(_eval(r)) > 1000:
                raise ToolError("exponent too large")
            return _OPS[type(op)](_eval(l), _eval(r))
        case ast.UnaryOp(op=op, operand=o) if type(op) in _OPS:
            return _OPS[type(op)](_eval(o))
    raise ToolError(f"unsupported expression: {ast.dump(node)[:80]}")


async def calculator(ctx: ToolContext, args: dict) -> str:
    try:
        return str(_eval(ast.parse(args["expression"], mode="eval")))
    except (SyntaxError, ZeroDivisionError, OverflowError) as e:
        raise ToolError(str(e))


def _obj(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required}


TOOLS: dict[str, Tool] = {t.name: t for t in [
    Tool("list_files", "List all files in the workspace (or a subdirectory of it).",
         _obj({"path": {"type": "string", "description": "Directory relative to workspace root. Default '.'"}}, []),
         list_files),
    Tool("read_file", "Read a text file from the workspace.",
         _obj({"path": {"type": "string"}}, ["path"]), read_file),
    Tool("write_file", "Create or overwrite a text file in the workspace.",
         _obj({"path": {"type": "string"}, "content": {"type": "string"}}, ["path", "content"]), write_file),
    Tool("run_python", "Run a Python 3 script in the workspace directory and return stdout/stderr. "
         "Print anything you want to see. 20s timeout.",
         _obj({"code": {"type": "string"}}, ["code"]), run_python),
    Tool("fetch_url", "HTTP GET a URL and return the response body (HTML is converted to plain text).",
         _obj({"url": {"type": "string"}}, ["url"]), fetch_url),
    Tool("calculator", "Evaluate an arithmetic expression: + - * / // % ** and parentheses.",
         _obj({"expression": {"type": "string"}}, ["expression"]), calculator),
]}
