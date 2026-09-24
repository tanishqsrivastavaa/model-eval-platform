# agent-xray

Watch LLM agents think, call tools, and burn time — live.

A self-hosted observability harness for LLM agents: configure a run, and every token,
tool call and millisecond streams into a live waterfall timeline as it happens.

## Status

Under active rebuild: FastAPI + React SPA. See roadmap below.

## Quickstart

```bash
cp .env.example .env   # add at least one provider key
make dev               # uvicorn :8000 + Vite :5173
```

## Tests

```bash
make test-py    # pytest e2e (fake model server, no API key needed)
make test       # vitest unit
make test-e2e   # playwright browser
```

## Roadmap

- [ ] React SPA + design system (dark precision-instrument aesthetic)
- [ ] Canvas waterfall timeline with zoom/pan
- [ ] Command palette, shortcuts, searchable history
- [ ] Run comparison, evals, auth, hosted deploy (future)

