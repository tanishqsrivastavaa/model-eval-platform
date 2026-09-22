"""SQLite persistence for runs and their event streams, plus in-memory live fan-out."""

import asyncio
import json
import sqlite3
import threading
import time
from collections import defaultdict

from .config import DATA_DIR, DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    created_at  REAL NOT NULL,
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    config      TEXT NOT NULL,
    status      TEXT NOT NULL,
    summary     TEXT
);
CREATE TABLE IF NOT EXISTS events (
    run_id  TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    t_ms    REAL NOT NULL,
    type    TEXT NOT NULL,
    data    TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
);
"""


class Store:
    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;" + SCHEMA)
        # Runs that were live when the server died can never finish.
        self.db.execute("UPDATE runs SET status='interrupted' WHERE status='running'")
        self.db.commit()
        self.subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self.lock = threading.Lock()

    def create_run(self, run_id: str, provider: str, model: str, prompt: str, config: dict) -> None:
        with self.lock:
            self.db.execute(
                "INSERT INTO runs (id, created_at, provider, model, prompt, config, status) VALUES (?,?,?,?,?,?,?)",
                (run_id, time.time(), provider, model, prompt, json.dumps(config), "running"),
            )
            self.db.commit()

    def finish_run(self, run_id: str, status: str, summary: dict) -> None:
        with self.lock:
            self.db.execute("UPDATE runs SET status=?, summary=? WHERE id=?", (status, json.dumps(summary), run_id))
            self.db.commit()

    def add_event(self, run_id: str, event: dict) -> None:
        with self.lock:
            self.db.execute(
                "INSERT INTO events (run_id, seq, t_ms, type, data) VALUES (?,?,?,?,?)",
                (run_id, event["seq"], event["t_ms"], event["type"], json.dumps(event["data"])),
            )
            self.db.commit()
        for q in self.subscribers.get(run_id, ()):
            q.put_nowait(event)

    def events(self, run_id: str) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT seq, t_ms, type, data FROM events WHERE run_id=? ORDER BY seq", (run_id,))
            return [
                {"seq": r["seq"], "t_ms": r["t_ms"], "type": r["type"], "data": json.loads(r["data"])}
                for r in rows
            ]

    def get_run(self, run_id: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        return self._run_dict(row) if row else None

    def list_runs(self, q: str | None = None, status: str | None = None, limit: int = 100, offset: int = 0) -> list[dict]:
        where, params = [], []
        if q:
            pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where.append("(prompt LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')")
            params.extend([pattern, pattern])
        if status:
            where.append("status = ?")
            params.append(status)
        sql = "SELECT * FROM runs"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self.lock:
            rows = self.db.execute(sql, params)
            return [self._run_dict(r) for r in rows]

    def delete_run(self, run_id: str) -> None:
        with self.lock:
            self.db.execute("DELETE FROM events WHERE run_id=?", (run_id,))
            self.db.execute("DELETE FROM runs WHERE id=?", (run_id,))
            self.db.commit()

    @staticmethod
    def _run_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["config"] = json.loads(d["config"])
        d["summary"] = json.loads(d["summary"]) if d["summary"] else None
        return d

    def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.subscribers[run_id].add(q)
        return q

    def unsubscribe(self, run_id: str, q: asyncio.Queue) -> None:
        self.subscribers[run_id].discard(q)
        if not self.subscribers[run_id]:
            del self.subscribers[run_id]
