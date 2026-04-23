"""In-memory HITL session store for Phase D correction round-trips.

A session is created when the `/reconcile/card` SSE endpoint enters
Phase D and finds fields needing clinician review. The client receives
`session_id` in the `hitl_required` event and POSTs corrections to
`/reconcile/hitl/{session_id}/corrections`. That POST signals the
session's `corrections_event`, unblocking the SSE generator so it can
merge the corrections and continue to agent reasoning.

# SOVEREIGNTY NOTE: this is a per-process in-memory dict keyed by UUID
# for the hackathon demo. It does NOT survive a server restart or
# horizontal scaling. Production deployment replaces this with a
# durable session backend (on-prem Redis with per-session encryption,
# or a stateless resumable token signed by the server). See
# docs/DEFERRED_DOC_UPDATES.md entry #2.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

HITL_SESSION_TTL_SECONDS = 900  # 15 minutes

_log = logging.getLogger("hathor.hitl")


@dataclass
class HITLSession:
    session_id: str
    auto_committed: Any           # CardExtractionOutput (post-Phase-D gate)
    hitl_queue: list              # list[safety.phase_d.HITLField]
    created_at: datetime
    expires_at: datetime
    corrections: list | None = None
    corrections_event: asyncio.Event = field(default_factory=asyncio.Event)


class SessionStore:
    """In-memory session store. NOT production-grade — see SOVEREIGNTY NOTE."""

    def __init__(self, ttl_seconds: int = HITL_SESSION_TTL_SECONDS) -> None:
        self._sessions: dict[str, HITLSession] = {}
        self.ttl_seconds = ttl_seconds

    def create(self, auto_committed: Any, hitl_queue: list) -> HITLSession:
        sid = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        session = HITLSession(
            session_id=sid,
            auto_committed=auto_committed,
            hitl_queue=hitl_queue,
            created_at=now,
            expires_at=now + timedelta(seconds=self.ttl_seconds),
        )
        self._sessions[sid] = session
        _log.info(
            "HITL session created session_id=%s queue_size=%d ttl_seconds=%d",
            sid,
            len(hitl_queue),
            self.ttl_seconds,
        )
        return session

    def get(self, session_id: str) -> HITLSession | None:
        """Return the session if its ID is known. Expired sessions are
        still returned here — callers must check is_expired() to decide
        between 410 and 404. Use drop() to remove."""
        return self._sessions.get(session_id)

    def is_expired(self, session: HITLSession) -> bool:
        expired = datetime.now(timezone.utc) >= session.expires_at
        if expired:
            _log.info("HITL session expired session_id=%s", session.session_id)
        return expired

    def resume(self, session_id: str, corrections: list) -> HITLSession | None:
        """Record corrections and wake the waiting SSE generator.
        Returns None if the session does not exist or is already resumed."""
        session = self.get(session_id)
        if session is None:
            return None
        session.corrections = corrections
        session.corrections_event.set()
        _log.info(
            "HITL session resumed session_id=%s corrections=%d",
            session_id,
            len(corrections),
        )
        return session

    def drop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


SESSIONS = SessionStore()
