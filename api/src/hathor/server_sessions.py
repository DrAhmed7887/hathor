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


# ─────────────────────────────────────────────────────────────────────────────
# Phase E — post-reasoning override session store.
#
# Survives past Phase D: created when the agent emits recommendations via
# emit_recommendations; retained until TTL so clinicians can submit overrides
# against `override_required` or `fail` verdicts. Shares the same in-memory,
# per-process SOVEREIGNTY posture as SessionStore above — see docs/DEFERRED_DOC_UPDATES.md.
# ─────────────────────────────────────────────────────────────────────────────

RECONCILE_SESSION_TTL_SECONDS = 3600  # 1 hour — override review window


@dataclass
class OverrideRecord:
    """One clinician override submitted against a Phase E ValidationResult."""

    recommendation_id: str
    rule_id: str
    justification_code: str | None          # None when severity was "fail" (free-text only)
    clinical_reason_text: str | None        # free text; required for fail, optional for override_required
    timestamp: datetime
    clinician_id: str                       # DEMO-CLINICIAN PLACEHOLDER — see ReconcileSession below


@dataclass
class ReconcileSession:
    session_id: str
    # NOTE: clinician_id is a placeholder for the hackathon demo. The server has
    # no authentication today; a durable build will bind this to the authenticated
    # identity of the physician reviewing the case. See docs/DEFERRED_DOC_UPDATES.md
    # and the equivalent comment in api/src/hathor/fhir/provenance.py where this
    # value is written into FHIR Provenance.agent[0].who.display.
    clinician_id: str
    recommendations: list[dict]             # active + superseded results snapshot from emit_recommendations
    overrides: list[OverrideRecord] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
        + timedelta(seconds=RECONCILE_SESSION_TTL_SECONDS)
    )


class ReconcileSessionStore:
    """In-memory reconcile-session store. NOT production-grade — see comment above."""

    def __init__(self, ttl_seconds: int = RECONCILE_SESSION_TTL_SECONDS) -> None:
        self._sessions: dict[str, ReconcileSession] = {}
        self.ttl_seconds = ttl_seconds

    def create(self, recommendations: list[dict], clinician_id: str = "demo-clinician") -> ReconcileSession:
        sid = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        session = ReconcileSession(
            session_id=sid,
            clinician_id=clinician_id,
            recommendations=recommendations,
            created_at=now,
            expires_at=now + timedelta(seconds=self.ttl_seconds),
        )
        self._sessions[sid] = session
        _log.info(
            "Reconcile session created session_id=%s recommendations=%d ttl_seconds=%d",
            sid, len(recommendations), self.ttl_seconds,
        )
        return session

    def get(self, session_id: str) -> ReconcileSession | None:
        return self._sessions.get(session_id)

    def is_expired(self, session: ReconcileSession) -> bool:
        return datetime.now(timezone.utc) >= session.expires_at

    def append_override(self, session_id: str, record: OverrideRecord) -> ReconcileSession | None:
        session = self.get(session_id)
        if session is None:
            return None
        session.overrides.append(record)
        _log.info(
            "Override recorded session_id=%s recommendation_id=%s rule_id=%s code=%s",
            session_id, record.recommendation_id, record.rule_id, record.justification_code,
        )
        return session

    def drop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


RECONCILE_SESSIONS = ReconcileSessionStore()
