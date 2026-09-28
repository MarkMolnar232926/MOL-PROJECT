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

from recon import AppConfig
from recon.errors import StepOrderError
from recon.intake import SourceUpload
from recon.matching import Matching

DEFAULT_IDLE_TTL = dt.timedelta(hours=2)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


@dataclass
class Session:
    """One reconciliation: the original inventory, then the incoming list, then decisions.

    The steps build on each other: uploading a new original inventory forgets the incoming
    list and every decision; uploading a new incoming list forgets the decisions. Matching
    runs once, when the incoming list arrives; decisions are laid over that result.
    """

    session_id: str
    cfg: AppConfig
    original: SourceUpload | None = None
    incoming: SourceUpload | None = None
    matching: Matching | None = None
    created_at: dt.datetime = field(default_factory=_now)
    last_access: dt.datetime = field(default_factory=_now)

    @property
    def matched(self) -> bool:
        return self.matching is not None

    def set_original(self, upload: SourceUpload) -> bool:
        """Replace the original inventory. Returns True if later steps were discarded."""
        had_later = self.incoming is not None
        self.original = upload
        self.incoming = None
        self.matching = None
        return had_later

    def set_incoming(self, upload: SourceUpload) -> bool:
        """Replace the incoming list and run matching. Returns True if decisions were dropped."""
        if self.original is None:
            raise StepOrderError(
                "Upload the original inventory first; the incoming list is matched against it."
            )
        had_decisions = bool(self.matching and self.matching.log)
        self.incoming = upload
        self.matching = Matching(self.original, upload, self.cfg)
        return had_decisions

    def require_matching(self) -> Matching:
        if self.matching is None:
            raise StepOrderError(
                "Matching has not run yet: upload the original inventory and the incoming list."
            )
        return self.matching


class SessionStore(Protocol):
    def create(self, cfg: AppConfig) -> Session: ...
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

    def create(self, cfg: AppConfig) -> Session:
        """A new, empty session (nothing uploaded yet)."""
        now = self._clock()
        session = Session(str(uuid.uuid4()), cfg, created_at=now, last_access=now)
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
