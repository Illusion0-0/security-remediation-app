"""Persistent run storage backed by SQLite.

Async writes — DB operations never block the orchestrator.
Loads all runs from DB on startup.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .models import RunEvent, RunRecord, RunStatus


def _get_db_path() -> str:
    data_dir = os.getenv("DATA_DIR", os.path.join(os.getcwd(), "data"))
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    return os.path.join(data_dir, "runs.db")


class PersistentRunStore:
    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}
        self._db_url = os.getenv("DATABASE_URL", "").strip()
        self._sqlite_path = _get_db_path()
        self._init_db()
        self._load_all()

    def _get_conn(self):
        if self._db_url:
            try:
                import psycopg2
                return psycopg2.connect(self._db_url)
            except ImportError:
                pass
        return sqlite3.connect(self._sqlite_path)

    def _init_db(self) -> None:
        try:
            conn = self._get_conn()
            conn.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)")
            conn.commit()
            conn.close()
        except Exception:
            pass

    def _load_all(self) -> None:
        try:
            conn = self._get_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT id, data FROM runs ORDER BY updated_at DESC")
            for row in cursor:
                try:
                    run = RunRecord.model_validate_json(row["data"])
                    self._runs[run.id] = run
                except Exception:
                    pass
            conn.close()
        except Exception:
            pass

    def _persist_bg(self, run: RunRecord) -> None:
        """Background persistence — never blocks the caller."""
        def _write():
            try:
                data = run.model_dump_json(mode="json")
                updated = datetime.now(timezone.utc).isoformat()
                conn = self._get_conn()
                conn.execute("INSERT OR REPLACE INTO runs (id, data, updated_at) VALUES (?, ?, ?)", (run.id, data, updated))
                conn.commit()
                conn.close()
            except Exception:
                pass
        threading.Thread(target=_write, daemon=True).start()

    def create(self, run: RunRecord) -> RunRecord:
        self._runs[run.id] = run
        self._persist_bg(run)
        return run

    def get(self, run_id: str) -> RunRecord | None:
        return self._runs.get(run_id)

    def list(self) -> list[RunRecord]:
        return sorted(self._runs.values(), key=lambda item: item.created_at, reverse=True)

    def update(self, run_id: str, **changes) -> RunRecord:
        run = self._runs[run_id]
        for key, value in changes.items():
            setattr(run, key, value)
        run.updated_at = datetime.now(timezone.utc)
        self._persist_bg(run)
        return run

    def add_event(self, run_id: str, message: str, level: str = "info") -> RunRecord:
        run = self._runs[run_id]
        run.events.append(RunEvent(level=level, message=message))
        run.updated_at = datetime.now(timezone.utc)
        self._persist_bg(run)
        return run

    def replace(self, run: RunRecord) -> RunRecord:
        run.updated_at = datetime.now(timezone.utc)
        self._runs[run.id] = run
        self._persist_bg(run)
        return run

    def ids_by_status(self, statuses: Iterable[RunStatus]) -> list[str]:
        allowed = set(statuses)
        return [run.id for run in self._runs.values() if run.status in allowed]