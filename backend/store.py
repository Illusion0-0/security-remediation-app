from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from .models import RunEvent, RunRecord, RunStatus


class RunStore:
    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}

    def create(self, run: RunRecord) -> RunRecord:
        self._runs[run.id] = run
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
        return run

    def add_event(self, run_id: str, message: str, level: str = "info") -> RunRecord:
        run = self._runs[run_id]
        run.events.append(RunEvent(level=level, message=message))
        run.updated_at = datetime.now(timezone.utc)
        return run

    def replace(self, run: RunRecord) -> RunRecord:
        run.updated_at = datetime.now(timezone.utc)
        self._runs[run.id] = run
        return run

    def ids_by_status(self, statuses: Iterable[RunStatus]) -> list[str]:
        allowed = set(statuses)
        return [run.id for run in self._runs.values() if run.status in allowed]