"""Persistent run storage backed by SQLite.

On startup, loads all runs from the database into memory.
On every mutation (create/update/add_event/replace), persists to SQLite.
If DATABASE_URL is set, uses PostgreSQL (psycopg2); otherwise uses SQLite file.

Env vars:
    DATABASE_URL - PostgreSQL connection string (e.g., postgresql://user:pass@host:port/db)
    DATA_DIR - Directory for SQLite file (default: ./data)

Usage:
    store = PersistentRunStore()  # auto-detects SQLite or PostgreSQL
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .models import RunEvent, RunRecord, RunStatus


def _get_db_path() -> str:
    """Resolve SQLite database file path."""
    data_dir = os.getenv("DATA_DIR", os.path.join(os.getcwd(), "data"))
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    return os.path.join(data_dir, "runs.db")


class PersistentRunStore:
    """Run store with SQLite/PostgreSQL persistence.

    Keeps an in-memory cache for speed, persists to DB on every write.
    Loads all runs from DB on startup.
    """

    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}
        self._lock = threading.Lock()
        self._db_url = os.getenv("DATABASE_URL", "").strip()
        self._sqlite_path = _get_db_path()
        self._init_db()
        self._load_all()

    def _get_conn(self):
        """Get a database connection (SQLite or PostgreSQL)."""
        if self._db_url:
            try:
                import psycopg2
                return psycopg2.connect(self._db_url)
            except ImportError:
                pass  # Fall back to SQLite if psycopg2 not installed
        return sqlite3.connect(self._sqlite_path)

    def _init_db(self) -> None:
        """Create the runs table if it doesn't exist."""
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.commit()

    def _serialize(self, run: RunRecord) -> str:
        """Serialize a RunRecord to JSON string."""
        return run.model_dump_json(mode="json")

    def _deserialize(self, data: str) -> RunRecord:
        """Deserialize JSON string to RunRecord."""
        return RunRecord.model_validate_json(data)

    def _load_all(self) -> None:
        """Load all runs from DB into memory cache."""
        try:
            with self._get_conn() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("SELECT id, data FROM runs ORDER BY updated_at DESC")
                for row in cursor:
                    try:
                        run = self._deserialize(row["data"])
                        self._runs[run.id] = run
                    except Exception:
                        pass  # Skip corrupted records
        except Exception:
            pass  # If DB read fails, start empty

    def _persist(self, run: RunRecord) -> None:
        """Save a single run to the database."""
        data = self._serialize(run)
        updated = datetime.now(timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO runs (id, data, updated_at) VALUES (?, ?, ?)",
                (run.id, data, updated),
            )
            conn.commit()

    # ===== Public API (same as RunStore) =====

    def create(self, run: RunRecord) -> RunRecord:
        with self._lock:
            self._runs[run.id] = run
            self._persist(run)
        return run

    def get(self, run_id: str) -> RunRecord | None:
        return self._runs.get(run_id)

    def list(self) -> list[RunRecord]:
        return sorted(self._runs.values(), key=lambda item: item.created_at, reverse=True)

    def update(self, run_id: str, **changes) -> RunRecord:
        with self._lock:
            run = self._runs[run_id]
            for key, value in changes.items():
                setattr(run, key, value)
            run.updated_at = datetime.now(timezone.utc)
            self._persist(run)
        return run

    def add_event(self, run_id: str, message: str, level: str = "info") -> RunRecord:
        with self._lock:
            run = self._runs[run_id]
            run.events.append(RunEvent(level=level, message=message))
            run.updated_at = datetime.now(timezone.utc)
            self._persist(run)
        return run

    def replace(self, run: RunRecord) -> RunRecord:
        with self._lock:
            run.updated_at = datetime.now(timezone.utc)
            self._runs[run.id] = run
            self._persist(run)
        return run

    def ids_by_status(self, statuses: Iterable[RunStatus]) -> list[str]:
        allowed = set(statuses)
        return [run.id for run in self._runs.values() if run.status in allowed]