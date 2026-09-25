"""Reconciliation sessions and where they are kept.

v1 keeps sessions in memory. ``SessionStore`` is the seam for a Redis/DB-backed store later:
anything with ``create/get/save/delete`` works.
"""

from __future__ import annotations

import datetime as dt
import threading
import uuid
from dataclasses import dataclass, field
from typing import Protocol

from recon import AppConfig, NormalizedInput, reconcile
from recon.models import ManualDecision, ReconResult

DEFAULT_IDLE_TTL = dt.timedelta(hours=2)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


@dataclass
class Session:
    session_id: str
    data: NormalizedInput
    cfg: AppConfig
    decisions: list[ManualDecision] = field(default_factory=list)
    result: ReconResult | None = None
    created_at: dt.datetime = field(default_factory=_now)
    last_access: dt.datetime = field(default_factory=_now)

    def rerun(self) -> ReconResult:
        """Re-run matching with the current decisions; keep only those that still apply."""
        self.result = reconcile(self.data, self.cfg, decisions=self.decisions)
        self.decisions = list(self.result.decisions)
        return self.result


class SessionStore(Protocol):
    def create(self, data: NormalizedInput, cfg: AppConfig) -> Session: ...
    def get(self, session_id: str) -> Session | None: ...
    def save(self, session: Session) -> None: ...
    def delete(self, session_id: str) -> None: ...


class InMemorySessionStore:
    """Thread-safe dict of sessions that expire after ``idle_ttl`` without access."""

    def __init__(self, idle_ttl: dt.timedelta = DEFAULT_IDLE_TTL, clock=_now):
        self.idle_ttl = idle_ttl
        self._clock = clock
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}

    def _purge(self) -> None:
        cutoff = self._clock() - self.idle_ttl
        for sid in [s for s, v in self._sessions.items() if v.last_access < cutoff]:
            del self._sessions[sid]

    def create(self, data: NormalizedInput, cfg: AppConfig) -> Session:
        now = self._clock()
        session = Session(str(uuid.uuid4()), data, cfg, created_at=now, last_access=now)
        session.rerun()
        with self._lock:
            self._purge()
            self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            self._purge()
            session = self._sessions.get(session_id)
            if session is not None:
                session.last_access = self._clock()
            return session

    def save(self, session: Session) -> None:
        with self._lock:
            session.last_access = self._clock()
            self._sessions[session.session_id] = session

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def __len__(self) -> int:
        with self._lock:
            self._purge()
            return len(self._sessions)
