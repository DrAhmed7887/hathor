"""Regression tests for booster-dose handling and the biological-
plausibility RED gate in validate_dose + /validate-schedule.

Backs three user-stated acceptance criteria:

  3. Engine does not silently drop dose_kind = booster.
  4. DD/MM/YYYY ambiguity is handled safely (engine rejects non-ISO
     dates with 422 so ambiguous clinician input cannot masquerade as
     a valid date).
  7. A biologically impossible vaccine date before DOB is rejected by
     the RED gate.

Plus the Emma-card synthetic scenario (task C):

  * DTP primary-series row at 6 months (dose 3) + a separately labeled
    booster row must both survive into the validation payload AND both
    receive engine verdicts — the booster MUST NOT be silently dropped
    the way the pre-fix filter did.
"""

import asyncio
import datetime as _dt
import json
import unittest

from fastapi.testclient import TestClient

from hathor.server import app
from hathor.tools.dose_validation import validate_dose


class TestDoseKindBoosterIsPreserved(unittest.TestCase):
    """Acceptance #3: engine does not silently drop dose_kind='booster'.

    A booster reaches validate_dose with dose_number=None. The engine
    must return a result (not raise, not discard), must echo the
    booster classification back, and must mark the row for clinician
    confirmation unless it already rejected it on min-age / interval.
    """

    def _invoke(self, args: dict) -> dict:
        envelope = asyncio.run(validate_dose.handler(args))
        return json.loads(envelope["content"][0]["text"])

    def test_booster_with_null_dose_number_round_trips(self):
        # 18-month DTP booster after primary series at 2/4/6 months.
        # prior_dose_age_days = 180 (the 6-month dose 3).
        out = self._invoke({
            "antigen": "DTP",
            "dose_number": None,
            "dose_kind": "booster",
            "age_at_dose_days": 540,  # 18 months
            "target_country": "Egypt",
            "prior_dose_age_days": 180,
        })
        self.assertEqual(out["dose_kind"], "booster")
        self.assertIsNone(out["dose_number"])
        self.assertTrue(out["valid"], f"reasons={out['reasons']}")
        self.assertTrue(
            out["needs_clinician_confirmation"],
            "Boosters without a tighter rule must stay AMBER/review-needed, "
            "not auto-approve.",
        )
        self.assertTrue(
            any("Booster" in f for f in out["flags"]),
            f"Expected booster-review flag; got flags={out['flags']}",
        )

    def test_booster_with_interval_violation_returns_invalid(self):
        # Booster attempted 10 days after prior dose — below the 28-day
        # generic floor the engine applies to booster rows.
        out = self._invoke({
            "antigen": "DTP",
            "dose_number": None,
            "dose_kind": "booster",
            "age_at_dose_days": 190,
            "target_country": "Egypt",
            "prior_dose_age_days": 180,
        })
        self.assertFalse(out["valid"])
        self.assertFalse(out["needs_clinician_confirmation"])
        self.assertTrue(
            any("28-day" in r for r in out["reasons"]),
            f"Expected 28-day floor rejection; got reasons={out['reasons']}",
        )

    def test_booster_below_min_age_returns_invalid(self):
        # BCG has min age 0; pick an antigen with a real floor — PCV
        # (42 days). Booster given on day 10 must still fail the floor.
        out = self._invoke({
            "antigen": "PCV",
            "dose_number": None,
            "dose_kind": "booster",
            "age_at_dose_days": 10,
            "target_country": "Egypt",
        })
        self.assertFalse(out["valid"])
        self.assertFalse(out["needs_clinician_confirmation"])
        self.assertTrue(
            any("below minimum age" in r for r in out["reasons"]),
            f"Expected min-age rejection; got reasons={out['reasons']}",
        )

    def test_primary_series_unchanged_by_booster_plumbing(self):
        # Regression: the dose_kind default must preserve prior behaviour
        # for plain primary-series calls. A DTP dose 2 at 10 weeks with
        # prior dose at 6 weeks passes.
        out = self._invoke({
            "antigen": "DTP",
            "dose_number": 2,
            "age_at_dose_days": 70,
            "target_country": "Egypt",
            "prior_dose_age_days": 42,
        })
        self.assertTrue(out["valid"])
        self.assertEqual(out["dose_kind"], "primary")
        self.assertFalse(out["needs_clinician_confirmation"])


class TestRedGateBiologicalPlausibility(unittest.TestCase):
    """Acceptance #7: a dose date before DOB is rejected by the RED gate."""

    def _invoke(self, args: dict) -> dict:
        envelope = asyncio.run(validate_dose.handler(args))
        return json.loads(envelope["content"][0]["text"])

    def test_negative_age_returns_invalid_with_plausibility_reason(self):
        # Vision pass misreads 2023 as 2021; child DOB is 2023-03-18, so
        # server computes age_at_dose_days as -682 (dose appears to have
        # been given before birth).
        out = self._invoke({
            "antigen": "BCG",
            "dose_number": 1,
            "age_at_dose_days": -682,
            "target_country": "Egypt",
        })
        self.assertFalse(out["valid"])
        self.assertTrue(
            any("before the child's date of birth" in r.lower() or "before" in r.lower()
                for r in out["reasons"]),
            f"Expected biological-plausibility reason; got reasons={out['reasons']}",
        )
        # The plausibility rejection must win over a trailing min-age
        # rejection — the clinician needs the right diagnosis.
        joined = " ".join(out["reasons"]).lower()
        self.assertIn("biologically impossible", joined)


class TestValidateScheduleRouteAcceptsBooster(unittest.TestCase):
    """Acceptance #1 (engine side): booster rows make it through the
    HTTP boundary and come back with a verdict — they are not silently
    dropped by FastAPI/Pydantic validation."""

    def setUp(self):
        self.client = TestClient(app)

    def test_booster_record_is_validated_and_echoed(self):
        # Emma's Egyptian card: DTP primary dose 3 at 6 months + DTP
        # booster at 18 months. Both rows must survive and be validated.
        body = {
            "child_dob": "2024-10-01",
            "records": [
                {
                    "antigen": "DTP",
                    "date": "2025-04-01",   # 6 months later — dose 3
                    "dose_number": 3,
                    "dose_kind": "primary",
                    "prior_dose_age_days": 120,
                },
                {
                    "antigen": "DTP",
                    "date": "2026-04-01",   # 18 months — booster
                    "dose_number": None,
                    "dose_kind": "booster",
                    "prior_dose_age_days": 183,
                },
            ],
        }
        r = self.client.post("/validate-schedule", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()
        self.assertEqual(
            len(results), 2,
            "Both rows (dose 3 + booster) must return verdicts — the booster "
            "must not be silently filtered out.",
        )
        # Primary dose 3 passes.
        self.assertTrue(results[0]["valid"])
        self.assertEqual(results[0]["dose_kind"], "primary")
        self.assertEqual(results[0]["dose_number"], 3)
        # Booster echoes back as booster + null dose_number + amber.
        self.assertEqual(results[1]["dose_kind"], "booster")
        self.assertIsNone(results[1]["dose_number"])
        self.assertTrue(
            results[1].get("needs_clinician_confirmation"),
            "Boosters without explicit engine rules must surface as AMBER.",
        )


class TestValidateScheduleRouteRejectsAmbiguousDates(unittest.TestCase):
    """Acceptance #4: DD/MM/YYYY ambiguity is handled safely.

    The engine accepts ISO YYYY-MM-DD only. When a clinician's DD/MM
    value slips through (e.g. "05/05/2023"), the server 422s with a
    specific detail string rather than silently treating it as a valid
    date or approximating. The UI's native <input type="date"> normally
    prevents this from ever reaching the wire; the test guards the
    boundary itself.
    """

    def setUp(self):
        self.client = TestClient(app)

    def test_dd_mm_yyyy_rejected_422(self):
        body = {
            "child_dob": "2023-03-18",
            "records": [{
                "antigen": "BCG",
                "date": "05/05/2023",
                "dose_number": 1,
                "dose_kind": "primary",
                "prior_dose_age_days": None,
            }],
        }
        r = self.client.post("/validate-schedule", json=body)
        self.assertEqual(r.status_code, 422, r.text)
        self.assertIn("invalid date", r.text)

    def test_dob_dd_mm_yyyy_rejected_422(self):
        body = {
            "child_dob": "18/03/2023",
            "records": [{
                "antigen": "BCG",
                "date": "2023-05-05",
                "dose_number": 1,
                "dose_kind": "primary",
                "prior_dose_age_days": None,
            }],
        }
        r = self.client.post("/validate-schedule", json=body)
        self.assertEqual(r.status_code, 422, r.text)
        self.assertIn("invalid child_dob", r.text)


class TestEmmaCardSyntheticRegression(unittest.TestCase):
    """Task C: no Emma fixture exists in the repo (checked 2026-04-24),
    so this is the synthetic placeholder the task spec requested.

    Printed row labels on Emma's Egyptian MoHP card include an explicit
    "3rd dose at 6 months" row AND a separate "booster at 18 months" row.
    The pre-fix bug: the booster was either forced into dose 4 by the
    vision pass OR dropped entirely by buildValidationRecords because
    dose_number was null. Post-fix the booster must reach the engine,
    AND the primary series must not be renumbered just because a
    booster row exists.
    """

    def setUp(self):
        self.client = TestClient(app)

    def test_emma_primary_and_booster_both_receive_verdicts(self):
        # DOB chosen so dose 3 lands at 6 months, booster at 18 months.
        dob = _dt.date(2024, 10, 1)
        body = {
            "child_dob": dob.isoformat(),
            "records": [
                {"antigen": "DTP", "date": "2024-12-12", "dose_number": 1,
                 "dose_kind": "primary", "prior_dose_age_days": None},
                {"antigen": "DTP", "date": "2025-02-09", "dose_number": 2,
                 "dose_kind": "primary", "prior_dose_age_days": 72},
                {"antigen": "DTP", "date": "2025-04-08", "dose_number": 3,
                 "dose_kind": "primary", "prior_dose_age_days": 131},
                {"antigen": "DTP", "date": "2026-04-08", "dose_number": None,
                 "dose_kind": "booster", "prior_dose_age_days": 189},
            ],
        }
        r = self.client.post("/validate-schedule", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        results = r.json()
        self.assertEqual(len(results), 4)
        # Primary series intact, none renumbered.
        for i in (0, 1, 2):
            self.assertEqual(results[i]["dose_kind"], "primary")
            self.assertEqual(results[i]["dose_number"], i + 1)
        # Booster echoes back intact and surfaces for clinician review.
        self.assertEqual(results[3]["dose_kind"], "booster")
        self.assertIsNone(results[3]["dose_number"])
        self.assertTrue(results[3]["valid"])
        self.assertTrue(results[3].get("needs_clinician_confirmation"))


if __name__ == "__main__":
    unittest.main()
