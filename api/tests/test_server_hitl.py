"""Tests for the /reconcile/card HITL round-trip (Commit 5).

Combines unit-level tests (session store, path validation, correction
apply) with integration tests (httpx.AsyncClient driving the SSE
endpoint + companion correction POST).

The real agent call is monkey-patched to yield canned events so tests
run fast and don't hit the Anthropic API.

SSE integration tests use httpx.AsyncClient rather than FastAPI's
TestClient — TestClient runs the ASGI app on a single anyio portal and
deadlocks when a request that is *holding* a response tries to share
the portal with a concurrent request on the same client. AsyncClient
multiplexes requests as independent tasks.
"""

import asyncio
import datetime as dt
import json
import time
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from hathor import server as server_mod
from hathor.safety.phase_d import HITLField
from hathor.schemas.extraction import (
    CardExtractionOutput,
    CardMetadata,
    ExtractedDose,
    FieldExtraction,
)
from hathor.server import (
    HITLCorrection,
    _apply_corrections,
    _card_reconciliation_stream,
    _validate_image_path,
    app,
)
from hathor.server_sessions import SESSIONS, SessionStore


# -----------------------------------------------------------------------------
# Canned agent stub so tests don't hit the real API.
# -----------------------------------------------------------------------------

async def _fake_stream_agent(req):  # matches _stream_agent's signature
    yield server_mod._sse("agent_start", {"model": "test-stub", "tools": 0})
    yield server_mod._sse("final_plan", {"markdown": "## Test plan\n\nmocked."})
    yield server_mod._sse("run_complete", {"tool_call_count": 0})


def setUpModule():  # noqa: N802 — unittest hook name
    server_mod._stream_agent = _fake_stream_agent  # type: ignore[assignment]


def tearDownModule():  # noqa: N802
    # Best-effort cleanup — import the real module attribute back. The real
    # _stream_agent remains defined in the module; we just restore the name.
    import importlib
    importlib.reload(server_mod)


# -----------------------------------------------------------------------------
# Fixture helpers
# -----------------------------------------------------------------------------

def _hi(value: str) -> FieldExtraction:
    return FieldExtraction(value=value, confidence=1.0)


def _lo(value: str, reason: str) -> FieldExtraction:
    return FieldExtraction(
        value=value, confidence=0.6, needs_review=True, ambiguity_reason=reason
    )


def _extraction_with_smudged_date() -> CardExtractionOutput:
    return CardExtractionOutput(
        card_metadata=CardMetadata(
            detected_language=_hi("English"),
            overall_legibility=_hi("Medium"),
            patient_dob=_hi("2024-06-15"),
        ),
        extracted_doses=[
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_lo("2024-08-1?", "Day digit smudged"),
            ),
        ],
        extraction_method="test-fixture",
    )


# -----------------------------------------------------------------------------
# Unit tests: path validation
# -----------------------------------------------------------------------------

class TestImagePathValidation(unittest.TestCase):
    def test_accepts_cards_subpath(self):
        resolved = _validate_image_path("cards/nigeria_happy.jpg")
        self.assertTrue(str(resolved).endswith("cards/nigeria_happy.jpg"))

    def test_accepts_bare_filename_prefixed_with_cards(self):
        resolved = _validate_image_path("cards/phase_d_demo.jpg")
        self.assertIn("cards", str(resolved))

    def test_rejects_absolute_outside_allowlist(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as cm:
            _validate_image_path("/etc/passwd")
        self.assertEqual(cm.exception.status_code, 400)

    def test_rejects_path_traversal(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as cm:
            _validate_image_path("cards/../../../etc/passwd")
        self.assertEqual(cm.exception.status_code, 400)

    def test_rejects_paths_outside_cards_dir(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as cm:
            _validate_image_path("data/schedules/egypt.json")
        self.assertEqual(cm.exception.status_code, 400)

    def test_rejects_empty(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as cm:
            _validate_image_path("")
        self.assertEqual(cm.exception.status_code, 400)


# -----------------------------------------------------------------------------
# Unit tests: SessionStore
# -----------------------------------------------------------------------------

class TestSessionStore(unittest.TestCase):
    def test_create_returns_session_with_uuid_and_ttl(self):
        store = SessionStore(ttl_seconds=60)
        session = store.create(auto_committed="x", hitl_queue=[1, 2, 3])
        self.assertEqual(len(session.session_id), 36)  # UUID4
        self.assertEqual(session.hitl_queue, [1, 2, 3])
        self.assertGreater(
            session.expires_at, dt.datetime.now(dt.timezone.utc)
        )

    def test_get_unknown_returns_none(self):
        store = SessionStore()
        self.assertIsNone(store.get("no-such-id"))

    def test_is_expired_for_past_expires_at(self):
        store = SessionStore(ttl_seconds=60)
        s = store.create(auto_committed=None, hitl_queue=[])
        s.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        self.assertTrue(store.is_expired(s))

    def test_resume_sets_event_and_records_corrections(self):
        store = SessionStore()
        s = store.create(auto_committed=None, hitl_queue=[])
        store.resume(s.session_id, corrections=["a", "b"])
        self.assertTrue(s.corrections_event.is_set())
        self.assertEqual(s.corrections, ["a", "b"])

    def test_drop_removes_session(self):
        store = SessionStore()
        s = store.create(auto_committed=None, hitl_queue=[])
        store.drop(s.session_id)
        self.assertIsNone(store.get(s.session_id))


# -----------------------------------------------------------------------------
# Unit tests: _apply_corrections
# -----------------------------------------------------------------------------

class TestApplyCorrections(unittest.TestCase):
    def _setup(self) -> tuple[CardExtractionOutput, list[HITLField]]:
        extraction = _extraction_with_smudged_date()
        # Phase D would have nulled the low-confidence field in auto_committed;
        # simulate that here.
        auto = extraction.model_copy(deep=True)
        auto.extracted_doses[0].date_administered = None
        hitl = [HITLField(
            dose_index=0,
            field_path="extracted_doses[0].date_administered",
            extracted=extraction.extracted_doses[0].date_administered,
            reason="Day digit smudged",
        )]
        return auto, hitl

    def test_edit_action_sets_value_with_confidence_one(self):
        auto, hitl = self._setup()
        corrections = [HITLCorrection(
            field_path="extracted_doses[0].date_administered",
            action="edit",
            corrected_value="2024-08-15",
        )]
        confirmed = _apply_corrections(auto, hitl, corrections)
        f = confirmed.extracted_doses[0].date_administered
        self.assertEqual(f.value, "2024-08-15")
        self.assertEqual(f.confidence, 1.0)
        self.assertFalse(f.needs_review)

    def test_keep_action_restores_original_value_with_confidence_one(self):
        auto, hitl = self._setup()
        corrections = [HITLCorrection(
            field_path="extracted_doses[0].date_administered",
            action="keep",
        )]
        confirmed = _apply_corrections(auto, hitl, corrections)
        f = confirmed.extracted_doses[0].date_administered
        self.assertEqual(f.value, "2024-08-1?")  # original extracted value
        self.assertEqual(f.confidence, 1.0)

    def test_skip_action_leaves_field_none(self):
        auto, hitl = self._setup()
        corrections = [HITLCorrection(
            field_path="extracted_doses[0].date_administered",
            action="skip",
        )]
        confirmed = _apply_corrections(auto, hitl, corrections)
        self.assertIsNone(confirmed.extracted_doses[0].date_administered)


# -----------------------------------------------------------------------------
# Endpoint tests: /reconcile/card path validation
# -----------------------------------------------------------------------------

class TestReconcileCardEndpoint(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_rejects_absolute_path(self):
        r = self.client.post("/reconcile/card", json={
            "image_path": "/etc/passwd",
            "child_dob": "2024-06-15",
            "target_country": "Egypt",
        })
        self.assertEqual(r.status_code, 400)

    def test_rejects_path_traversal(self):
        r = self.client.post("/reconcile/card", json={
            "image_path": "cards/../../../etc/passwd",
            "child_dob": "2024-06-15",
            "target_country": "Egypt",
        })
        self.assertEqual(r.status_code, 400)


class TestDemoFastReconcileMode(unittest.IsolatedAsyncioTestCase):
    async def test_fast_mode_emits_phase_e_without_live_agent(self):
        validated = _validate_image_path("cards/demo.jpg")
        req = server_mod.ReconcileCardRequest(
            image_path="cards/demo.jpg",
            child_dob="2025-12-09",
            target_country="Egypt",
        )

        started = time.perf_counter()
        events: list[tuple[str, dict]] = []
        with patch.dict("os.environ", {"DEMO_FAST_RECONCILE": "true"}):
            async for chunk in _card_reconciliation_stream(validated, req):
                raw = chunk.decode()
                event_type = raw.split("\n", 1)[0].replace("event: ", "")
                data_line = next(
                    line for line in raw.splitlines() if line.startswith("data: ")
                )
                events.append((event_type, json.loads(data_line[6:])))
        elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 5.0)
        self.assertIn("phase_e_complete", [event for event, _ in events])
        self.assertIn("run_complete", [event for event, _ in events])

        phase_e = next(data for event, data in events if event == "phase_e_complete")
        self.assertTrue(phase_e["has_override_required"])
        self.assertIn("fast-rotavirus-review", phase_e["recommendations"])
        self.assertTrue(
            any(
                r["rule_slug"] == "rotavirus_age_cutoff"
                and r["severity"] == "override_required"
                for r in phase_e["active_results"]
            )
        )

        run_complete = next(data for event, data in events if event == "run_complete")
        self.assertEqual(run_complete["tool_call_count"], 0)
        self.assertTrue(run_complete["demo_fast"])

    async def test_fast_mode_emits_no_live_tool_or_thinking_events(self):
        """CrossBeam-style: the deterministic fast path must NOT push raw
        agent reasoning (Thinking, ToolSearch, parallel-call counts) into the
        clinician-facing stream. Those belong only in the optional, collapsed
        audit trail of the agent path."""
        confirmed_doses = [
            {"antigen": "BCG", "date_administered": "2024-06-16", "dose_number": 1},
            {"antigen": "Pentavalent", "date_administered": "2024-07-27", "dose_number": 1},
        ]
        events: list[tuple[str, dict]] = []
        with patch.dict("os.environ", {"DEMO_FAST_RECONCILE": "true"}):
            async for chunk in server_mod._stream_demo_fast_phase_e_from_doses(
                confirmed_doses=confirmed_doses,
                child_dob="2024-06-15",
                target_country="Egypt",
            ):
                raw = chunk.decode()
                event_type = raw.split("\n", 1)[0].replace("event: ", "")
                data_line = next(
                    line for line in raw.splitlines() if line.startswith("data: ")
                )
                events.append((event_type, json.loads(data_line[6:])))

        types = [t for t, _ in events]
        # No noisy debug-trace events should reach the main UI.
        for forbidden in ("thinking", "tool_use", "tool_result"):
            self.assertNotIn(
                forbidden,
                types,
                f"fast path leaked {forbidden!r} into clinician-facing stream",
            )
        # But the deliverable IS still present.
        self.assertIn("phase_e_complete", types)
        self.assertIn("final_plan", types)
        self.assertIn("run_complete", types)

    async def test_fast_mode_structured_doses_skips_live_agent(self):
        req = server_mod.ReconcileRequest(
            child_dob="2024-06-15",
            target_country="Egypt",
            given_doses=[
                server_mod.DoseRecord(
                    vaccine_trade_name="BCG",
                    date_given="2024-06-16",
                ),
                server_mod.DoseRecord(
                    vaccine_trade_name="Pentavalent (DPT-HepB-Hib)",
                    date_given="2024-07-27",
                ),
                server_mod.DoseRecord(
                    vaccine_trade_name="Rotavirus",
                    date_given="2024-07-27",
                ),
            ],
        )

        started = time.perf_counter()
        events: list[tuple[str, dict]] = []
        with patch.dict("os.environ", {"DEMO_FAST_RECONCILE": "true"}):
            async for chunk in server_mod._stream_demo_fast_phase_e_from_doses(
                confirmed_doses=server_mod._dose_records_to_phase_e_context_doses(
                    req.given_doses
                ),
                child_dob=req.child_dob,
                target_country=req.target_country,
            ):
                raw = chunk.decode()
                event_type = raw.split("\n", 1)[0].replace("event: ", "")
                data_line = next(
                    line for line in raw.splitlines() if line.startswith("data: ")
                )
                events.append((event_type, json.loads(data_line[6:])))
        elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 5.0)
        self.assertIn("phase_e_complete", [event for event, _ in events])
        phase_e = next(data for event, data in events if event == "phase_e_complete")
        self.assertGreater(len(phase_e["active_results"]), 0)
        self.assertIn("recommendations", phase_e)


# -----------------------------------------------------------------------------
# Endpoint tests: /reconcile/hitl/{id}/corrections
# -----------------------------------------------------------------------------

def _seed_session_with_one_hitl_field() -> str:
    """Seed SESSIONS with a pending HITL session and return its id."""
    extraction = _extraction_with_smudged_date()
    auto = extraction.model_copy(deep=True)
    auto.extracted_doses[0].date_administered = None
    hitl = [HITLField(
        dose_index=0,
        field_path="extracted_doses[0].date_administered",
        extracted=extraction.extracted_doses[0].date_administered,
        reason="Day digit smudged",
    )]
    session = SESSIONS.create(auto, hitl)
    return session.session_id


class TestHITLCorrectionsEndpoint(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_unknown_session_returns_404(self):
        r = self.client.post(
            "/reconcile/hitl/not-a-real-uuid/corrections",
            json={"corrections": []},
        )
        self.assertEqual(r.status_code, 404)

    def test_expired_session_returns_410(self):
        sid = _seed_session_with_one_hitl_field()
        session = SESSIONS.get(sid)
        session.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        r = self.client.post(
            f"/reconcile/hitl/{sid}/corrections",
            json={"corrections": [{
                "field_path": "extracted_doses[0].date_administered",
                "action": "edit",
                "corrected_value": "2024-08-15",
            }]},
        )
        self.assertEqual(r.status_code, 410)
        SESSIONS.drop(sid)

    def test_unexpected_field_path_returns_400(self):
        sid = _seed_session_with_one_hitl_field()
        r = self.client.post(
            f"/reconcile/hitl/{sid}/corrections",
            json={"corrections": [{
                "field_path": "extracted_doses[99].transcribed_antigen",
                "action": "skip",
            }]},
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("unexpected fields", r.json()["detail"])
        SESSIONS.drop(sid)

    def test_missing_field_path_returns_400(self):
        sid = _seed_session_with_one_hitl_field()
        r = self.client.post(
            f"/reconcile/hitl/{sid}/corrections",
            json={"corrections": []},
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("missing fields", r.json()["detail"])
        SESSIONS.drop(sid)

    def test_edit_without_corrected_value_returns_400(self):
        sid = _seed_session_with_one_hitl_field()
        r = self.client.post(
            f"/reconcile/hitl/{sid}/corrections",
            json={"corrections": [{
                "field_path": "extracted_doses[0].date_administered",
                "action": "edit",
                # no corrected_value
            }]},
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("corrected_value", r.json()["detail"])
        SESSIONS.drop(sid)

    def test_edit_with_empty_corrected_value_returns_400(self):
        sid = _seed_session_with_one_hitl_field()
        r = self.client.post(
            f"/reconcile/hitl/{sid}/corrections",
            json={"corrections": [{
                "field_path": "extracted_doses[0].date_administered",
                "action": "edit",
                "corrected_value": "   ",
            }]},
        )
        self.assertEqual(r.status_code, 400)
        SESSIONS.drop(sid)

    def test_keep_with_corrected_value_returns_400(self):
        sid = _seed_session_with_one_hitl_field()
        r = self.client.post(
            f"/reconcile/hitl/{sid}/corrections",
            json={"corrections": [{
                "field_path": "extracted_doses[0].date_administered",
                "action": "keep",
                "corrected_value": "shouldnt be here",
            }]},
        )
        self.assertEqual(r.status_code, 400)
        SESSIONS.drop(sid)

    def test_valid_corrections_succeed_and_wake_session(self):
        sid = _seed_session_with_one_hitl_field()
        r = self.client.post(
            f"/reconcile/hitl/{sid}/corrections",
            json={"corrections": [{
                "field_path": "extracted_doses[0].date_administered",
                "action": "edit",
                "corrected_value": "2024-08-15",
            }]},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["session_id"], sid)
        # Session's corrections_event should be set so a waiting SSE generator
        # would now unblock.
        session = SESSIONS.get(sid)
        self.assertTrue(session.corrections_event.is_set())
        self.assertEqual(len(session.corrections), 1)
        SESSIONS.drop(sid)


# -----------------------------------------------------------------------------
# Integration tests: SSE endpoint emits hitl_required, round-trip completes
# -----------------------------------------------------------------------------

def _parse_sse_event_block(block: str) -> tuple[str, dict]:
    """Return (event_type, data_dict) from one SSE event block."""
    event_type = ""
    data_text = ""
    for line in block.splitlines():
        if line.startswith("event:"):
            event_type = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_text = line.split(":", 1)[1].strip()
    return event_type, (json.loads(data_text) if data_text else {})


def _collect_events(response_iter, stop_on: str | None = None, max_events: int = 50):
    """Consume an SSE response iterator into (event_type, data) tuples.
    Stops when stop_on event type is seen, or max_events hit, or stream ends."""
    events: list[tuple[str, dict]] = []
    buf: list[str] = []
    for raw in response_iter:
        if raw == "":
            if buf:
                ev = _parse_sse_event_block("\n".join(buf))
                events.append(ev)
                buf = []
                if stop_on and ev[0] == stop_on:
                    break
                if len(events) >= max_events:
                    break
        else:
            buf.append(raw)
    if buf:
        events.append(_parse_sse_event_block("\n".join(buf)))
    return events


def _parse_sse_chunk(chunk: bytes) -> tuple[str, dict]:
    """Parse one SSE event chunk (emitted by _sse) into (event_type, data)."""
    text = chunk.decode("utf-8").strip()
    return _parse_sse_event_block(text)


class TestSSEIntegration(unittest.IsolatedAsyncioTestCase):
    """Drives the async generator directly. We bypass httpx.AsyncClient +
    ASGITransport for streaming cases because ASGITransport does not flush
    intermediate chunks before the generator completes — which prevents us
    from observing `hitl_required` while the server is still holding the
    stream. Endpoint HTTP semantics (404, 410, 400) are covered by
    TestHITLCorrectionsEndpoint above; TestReconcileCardEndpoint covers
    path-validation semantics at the HTTP boundary."""

    async def test_happy_path_no_hitl_required(self):
        from hathor.server import (
            ReconcileCardRequest,
            _card_reconciliation_stream,
            _validate_image_path,
        )

        req = ReconcileCardRequest(
            image_path="cards/happy.jpg",
            child_dob="2024-06-15",
            target_country="Egypt",
        )
        path = _validate_image_path(req.image_path)

        events: list[tuple[str, dict]] = []
        async for chunk in _card_reconciliation_stream(path, req):
            events.append(_parse_sse_chunk(chunk))
            if events[-1][0] == "run_complete":
                break

        types = [e[0] for e in events]
        self.assertNotIn("hitl_required", types)
        self.assertIn("agent_start", types)
        self.assertIn("final_plan", types)
        self.assertIn("run_complete", types)

    async def test_phase_d_demo_variant_emits_hitl_required(self):
        from hathor.server import (
            ReconcileCardRequest,
            _card_reconciliation_stream,
            _validate_image_path,
        )

        req = ReconcileCardRequest(
            image_path="cards/phase_d_demo.jpg",
            child_dob="2024-06-15",
            target_country="Egypt",
        )
        path = _validate_image_path(req.image_path)

        gen = _card_reconciliation_stream(path, req)
        events: list[tuple[str, dict]] = []
        async for chunk in gen:
            ev = _parse_sse_chunk(chunk)
            events.append(ev)
            if ev[0] == "hitl_required":
                break

        # Close the generator cleanly so the pending SESSION.wait() is
        # cancelled and cleaned up before the next test.
        await gen.aclose()

        types = [e[0] for e in events]
        self.assertEqual(types[-1], "hitl_required")
        data = events[-1][1]
        self.assertIn("session_id", data)
        self.assertEqual(
            data["resume_endpoint"],
            f"/reconcile/hitl/{data['session_id']}/corrections",
        )
        self.assertIn("expires_at", data)
        self.assertEqual(len(data["hitl_queue"]), 1)
        # Pentavalent dose 3 is at index 5 in the flagship dose ordering:
        # BCG=0, Penta1=1, OPV1=2, Penta2=3, OPV2=4, Penta3=5, OPV3=6
        self.assertEqual(
            data["hitl_queue"][0]["field_path"],
            "extracted_doses[5].date_administered",
        )
        SESSIONS.drop(data["session_id"])

    async def test_full_hitl_roundtrip_resumes_stream(self):
        """Phase D variant → hitl_required → corrections delivered via
        the POST endpoint (through httpx.AsyncClient, because that tests
        the real HTTP handler) → generator resumes and emits run_complete."""
        from hathor.server import (
            ReconcileCardRequest,
            _card_reconciliation_stream,
            _validate_image_path,
        )

        req = ReconcileCardRequest(
            image_path="cards/phase_d_demo.jpg",
            child_dob="2024-06-15",
            target_country="Egypt",
        )
        path = _validate_image_path(req.image_path)
        gen = _card_reconciliation_stream(path, req)

        all_events: list[tuple[str, dict]] = []

        async def consume():
            async for chunk in gen:
                all_events.append(_parse_sse_chunk(chunk))
                if all_events[-1][0] == "run_complete":
                    return

        async def post_corrections():
            # Wait until the hitl_required event is emitted.
            for _ in range(100):
                hit = next(
                    (e[1] for e in all_events if e[0] == "hitl_required"), None
                )
                if hit is not None:
                    break
                await asyncio.sleep(0.02)
            else:
                self.fail("hitl_required never emitted")

            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as client:
                r = await client.post(
                    f"/reconcile/hitl/{hit['session_id']}/corrections",
                    json={"corrections": [{
                        "field_path": "extracted_doses[5].date_administered",
                        "action": "edit",
                        "corrected_value": "2026-03-17",
                    }]},
                )
                self.assertEqual(r.status_code, 200)

        await asyncio.wait_for(
            asyncio.gather(consume(), post_corrections()),
            timeout=10.0,
        )

        types = [e[0] for e in all_events]
        self.assertIn("hitl_required", types)
        self.assertIn("agent_start", types)
        self.assertIn("final_plan", types)
        self.assertIn("run_complete", types)


if __name__ == "__main__":
    unittest.main()
