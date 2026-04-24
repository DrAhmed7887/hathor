"""Tests for Commit 8 — Phase E override surface.

Scope:
  * ReconcileSessionStore (session creation, expiry, append_override).
  * /session/{id}/override endpoint (payload validation per severity,
    404/410/400 error branches, happy-path Provenance write).
  * fhir.provenance.write_override_provenance (resource shape, JSONL sink).
"""

import json
import pathlib
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

from hathor.fhir.provenance import _LOG_PATH, _build_provenance, write_override_provenance
from hathor.server import app
from hathor.server_sessions import (
    RECONCILE_SESSIONS,
    OverrideRecord,
    ReconcileSessionStore,
)


def _sample_active_results() -> list[dict]:
    """A representative active-results snapshot mimicking emit_recommendations output."""
    return [
        {
            "recommendation_id": "rec-001",
            "severity": "override_required",
            "rule_id": "HATHOR-AGE-003",
            "rule_slug": "rota_age_cutoffs",
            "rule_rationale": "Rotavirus dose-1 max age 105d — adverse-event risk.",
            "override_allowed": True,
            "override_logged_as": "AuditEvent",
            "supersedes": None,
            "override_justification_codes": ["HIGH_BURDEN_ORIGIN", "OUTBREAK_CATCHUP", "CLINICIAN_DETERMINED"],
        },
        {
            "recommendation_id": "rec-002",
            "severity": "fail",
            "rule_id": "HATHOR-DOSE-002",
            "rule_slug": "min_interval_met",
            "rule_rationale": "DTaP G2 must be ≥28d after G1.",
            "override_allowed": True,
            "override_logged_as": "AuditEvent",
            "supersedes": None,
            "override_justification_codes": [],
        },
        {
            "recommendation_id": "rec-003",
            "severity": "pass",
            "rule_id": "HATHOR-AGE-001",
            "rule_slug": "min_age_valid",
            "rule_rationale": "Dose meets minimum age.",
            "override_allowed": True,
            "override_logged_as": "AuditEvent",
            "supersedes": None,
            "override_justification_codes": [],
        },
    ]


class ReconcileSessionStoreTests(unittest.TestCase):
    def test_create_assigns_id_and_ttl(self) -> None:
        store = ReconcileSessionStore(ttl_seconds=60)
        s = store.create([{"recommendation_id": "rec-x"}])
        self.assertTrue(s.session_id)
        self.assertEqual(s.clinician_id, "demo-clinician")
        self.assertEqual(len(s.recommendations), 1)
        self.assertFalse(store.is_expired(s))

    def test_expiry(self) -> None:
        store = ReconcileSessionStore(ttl_seconds=60)
        s = store.create([])
        s.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.assertTrue(store.is_expired(s))

    def test_append_override(self) -> None:
        store = ReconcileSessionStore()
        s = store.create([])
        rec = OverrideRecord(
            recommendation_id="rec-001", rule_id="R-001",
            justification_code="HIGH_BURDEN_ORIGIN", clinical_reason_text=None,
            timestamp=datetime.now(timezone.utc), clinician_id="demo-clinician",
        )
        result = store.append_override(s.session_id, rec)
        self.assertIsNotNone(result)
        self.assertEqual(len(s.overrides), 1)
        self.assertEqual(s.overrides[0].justification_code, "HIGH_BURDEN_ORIGIN")

    def test_append_override_unknown_session(self) -> None:
        store = ReconcileSessionStore()
        rec = OverrideRecord(
            recommendation_id="rec-x", rule_id="R", justification_code=None,
            clinical_reason_text="x", timestamp=datetime.now(timezone.utc),
            clinician_id="demo-clinician",
        )
        self.assertIsNone(store.append_override("unknown", rec))


class ProvenanceEmitterTests(unittest.TestCase):
    def test_build_provenance_override_required_shape(self) -> None:
        rec = OverrideRecord(
            recommendation_id="rec-001", rule_id="HATHOR-AGE-003",
            justification_code="HIGH_BURDEN_ORIGIN",
            clinical_reason_text="Nigerian migrant, outbreak risk.",
            timestamp=datetime(2026, 4, 24, 12, 0, 0, tzinfo=timezone.utc),
            clinician_id="demo-clinician",
        )
        result = _sample_active_results()[0]
        p = _build_provenance(rec, result)
        j = p.model_dump(mode="json", exclude_none=True)

        # Target: logical URN, recommendation_id as display
        self.assertEqual(j["target"][0]["reference"], "urn:hathor:recommendation:rec-001")
        # Recorded: ISO-8601 with Z
        self.assertTrue(j["recorded"].endswith("Z"))
        # Activity: local CodeSystem, clinical-override code
        self.assertEqual(j["activity"]["coding"][0]["code"], "clinical-override")
        self.assertEqual(j["activity"]["coding"][0]["system"], "http://hathor.health/CodeSystem/activity")
        # Agent: placeholder clinician, 'author' type
        self.assertEqual(j["agent"][0]["who"]["display"], "demo-clinician")
        self.assertEqual(j["agent"][0]["type"]["coding"][0]["code"], "author")
        # Reason[0]: rule_id
        self.assertEqual(j["reason"][0]["coding"][0]["code"], "HATHOR-AGE-003")
        # Reason[1]: justification code + free text
        self.assertEqual(j["reason"][1]["coding"][0]["code"], "HIGH_BURDEN_ORIGIN")
        self.assertEqual(j["reason"][1]["text"], "Nigerian migrant, outbreak risk.")
        # Extension: phase-e-override-context with nested sub-extensions
        self.assertEqual(j["extension"][0]["url"], "http://hathor.health/fhir/StructureDefinition/phase-e-override-context")
        sub_urls = {e["url"] for e in j["extension"][0]["extension"]}
        self.assertEqual(sub_urls, {"ruleRationale", "ruleSlug", "severity", "overrideLoggedAs"})
        # Entity: source role, logical URN
        self.assertEqual(j["entity"][0]["role"], "source")
        self.assertEqual(j["entity"][0]["what"]["reference"], "urn:hathor:recommendation:rec-001")

    def test_build_provenance_fail_no_justification_code(self) -> None:
        rec = OverrideRecord(
            recommendation_id="rec-002", rule_id="HATHOR-DOSE-002",
            justification_code=None,
            clinical_reason_text="Clinical judgment: dose was verified via second card.",
            timestamp=datetime.now(timezone.utc), clinician_id="demo-clinician",
        )
        result = _sample_active_results()[1]
        p = _build_provenance(rec, result)
        j = p.model_dump(mode="json", exclude_none=True)
        # Reason[1] carries free text, no coding when justification_code absent
        self.assertNotIn("coding", j["reason"][1])
        self.assertIn("verified via second card", j["reason"][1]["text"])

    def test_write_override_provenance_appends_jsonl(self) -> None:
        rec = OverrideRecord(
            recommendation_id="rec-jsonl", rule_id="HATHOR-AGE-003",
            justification_code="OUTBREAK_CATCHUP", clinical_reason_text=None,
            timestamp=datetime.now(timezone.utc), clinician_id="demo-clinician",
        )
        result = _sample_active_results()[0]
        before = _LOG_PATH.read_text().count("\n") if _LOG_PATH.exists() else 0
        provenance_id = write_override_provenance(override=rec, validation_result=result)
        self.assertTrue(provenance_id)
        after = _LOG_PATH.read_text().count("\n")
        self.assertEqual(after, before + 1)
        # Last line parses and contains our rec
        last = _LOG_PATH.read_text().splitlines()[-1]
        entry = json.loads(last)
        self.assertEqual(entry["provenance"]["target"][0]["display"], "rec-jsonl")
        self.assertEqual(entry["provenance"]["id"], provenance_id)


class OverrideEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        # Fresh session with sample active results
        self.session = RECONCILE_SESSIONS.create(_sample_active_results())

    def tearDown(self) -> None:
        RECONCILE_SESSIONS.drop(self.session.session_id)

    def _url(self, session_id: str | None = None) -> str:
        return f"/session/{session_id or self.session.session_id}/override"

    def test_override_required_happy_path(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-001",
            "rule_id": "HATHOR-AGE-003",
            "severity": "override_required",
            "justification_code": "HIGH_BURDEN_ORIGIN",
            "clinical_reason_text": "Migrant from Nigeria.",
        })
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["status"], "accepted")
        self.assertTrue(body["provenance_id"])
        # Session state reflects the override
        session = RECONCILE_SESSIONS.get(self.session.session_id)
        assert session is not None
        self.assertEqual(len(session.overrides), 1)
        self.assertEqual(session.overrides[0].justification_code, "HIGH_BURDEN_ORIGIN")

    def test_fail_happy_path(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-002",
            "rule_id": "HATHOR-DOSE-002",
            "severity": "fail",
            "clinical_reason_text": "Verified dose via secondary card.",
        })
        self.assertEqual(res.status_code, 200, res.text)

    def test_override_required_missing_code(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-001",
            "rule_id": "HATHOR-AGE-003",
            "severity": "override_required",
            "clinical_reason_text": "x",
        })
        self.assertEqual(res.status_code, 400)

    def test_override_required_invalid_code(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-001",
            "rule_id": "HATHOR-AGE-003",
            "severity": "override_required",
            "justification_code": "MADE_UP_CODE",
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("justification_code", res.text)

    def test_fail_missing_free_text(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-002",
            "rule_id": "HATHOR-DOSE-002",
            "severity": "fail",
        })
        self.assertEqual(res.status_code, 400)

    def test_fail_rejects_justification_code(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-002",
            "rule_id": "HATHOR-DOSE-002",
            "severity": "fail",
            "clinical_reason_text": "x",
            "justification_code": "HIGH_BURDEN_ORIGIN",
        })
        self.assertEqual(res.status_code, 400)

    def test_unknown_session(self) -> None:
        res = self.client.post(self._url("not-a-real-id"), json={
            "recommendation_id": "rec-001",
            "rule_id": "HATHOR-AGE-003",
            "severity": "override_required",
            "justification_code": "HIGH_BURDEN_ORIGIN",
        })
        self.assertEqual(res.status_code, 404)

    def test_expired_session(self) -> None:
        self.session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-001",
            "rule_id": "HATHOR-AGE-003",
            "severity": "override_required",
            "justification_code": "HIGH_BURDEN_ORIGIN",
        })
        self.assertEqual(res.status_code, 410)

    def test_unknown_recommendation(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-does-not-exist",
            "rule_id": "HATHOR-AGE-003",
            "severity": "override_required",
            "justification_code": "HIGH_BURDEN_ORIGIN",
        })
        self.assertEqual(res.status_code, 404)

    def test_mismatched_rule_id(self) -> None:
        res = self.client.post(self._url(), json={
            "recommendation_id": "rec-001",
            "rule_id": "NOT-THE-RIGHT-RULE",
            "severity": "override_required",
            "justification_code": "HIGH_BURDEN_ORIGIN",
        })
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
