"""Unit tests for validate_dose tool and _get_min_interval helper.

Covers:
  - optional prior_dose_age_days schema (Fix A)
  - BCG explicit INTERVAL_RULES entry replacing fallback (Fix B)
  - regression: dose 2+ interval violation still returns Invalid
"""

import asyncio
import json
import unittest

from hathor.tools.dose_validation import validate_dose
from hathor.tools.intervals import INTERVAL_RULES, _get_min_interval


class TestValidateDoseOptionalPriorAge(unittest.TestCase):
    """Fix A — prior_dose_age_days is now optional in the tool schema.

    The runtime path has always handled None correctly; these tests verify that
    the tool returns a valid result (no interval check) when the caller omits
    the field or passes None, covering the dose-1 / no-prior-dose case.
    """

    def _invoke(self, args: dict) -> dict:
        result = asyncio.run(validate_dose.handler(args))
        return json.loads(result["content"][0]["text"])

    def test_dose1_prior_age_none_skips_interval_check(self):
        """validate_dose with prior_dose_age_days=None must not fire interval check."""
        out = self._invoke({
            "antigen": "OPV",
            "dose_number": 1,
            "age_at_dose_days": 2,
            "target_country": "Egypt",
            "prior_dose_age_days": None,
        })
        self.assertTrue(out["valid"], f"Expected valid, got reasons: {out['reasons']}")
        # No reason should mention "Interval from prior dose"
        for r in out["reasons"] + out.get("flags", []):
            self.assertNotIn("Interval from prior dose", r)

    def test_dose1_prior_age_omitted_skips_interval_check(self):
        """validate_dose with prior_dose_age_days omitted must not fire interval check."""
        out = self._invoke({
            "antigen": "OPV",
            "dose_number": 1,
            "age_at_dose_days": 2,
            "target_country": "Egypt",
            # prior_dose_age_days intentionally absent
        })
        self.assertTrue(out["valid"], f"Expected valid, got reasons: {out['reasons']}")
        for r in out["reasons"] + out.get("flags", []):
            self.assertNotIn("Interval from prior dose", r)

    def test_bcg_dose1_prior_age_omitted_is_valid(self):
        """BCG dose 1 with no prior_dose_age_days must be valid (birth dose)."""
        out = self._invoke({
            "antigen": "BCG",
            "dose_number": 1,
            "age_at_dose_days": 0,
            "target_country": "Egypt",
        })
        self.assertTrue(out["valid"], f"Expected valid, got reasons: {out['reasons']}")
        for r in out["reasons"] + out.get("flags", []):
            self.assertNotIn("Interval from prior dose", r)
            self.assertNotIn("antigen not in rule table", r)

    def test_dose2_with_adequate_interval_is_valid(self):
        """Regression: dose 2 with a sufficient interval must still pass."""
        out = self._invoke({
            "antigen": "OPV",
            "dose_number": 2,
            "age_at_dose_days": 120,
            "target_country": "Egypt",
            "prior_dose_age_days": 60,  # 60-day interval ≥ 28-day minimum
        })
        self.assertTrue(out["valid"], f"Expected valid, got reasons: {out['reasons']}")

    def test_dose2_with_short_interval_is_invalid(self):
        """Regression: dose 2 with insufficient interval must return Invalid."""
        out = self._invoke({
            "antigen": "OPV",
            "dose_number": 2,
            "age_at_dose_days": 62,
            "target_country": "Egypt",
            "prior_dose_age_days": 60,  # 2-day interval < 28-day minimum
        })
        self.assertFalse(out["valid"])
        self.assertTrue(
            any("Interval from prior dose" in r for r in out["reasons"]),
            "Expected interval violation reason in output",
        )


class TestBcgIntervalRule(unittest.TestCase):
    """Fix B — BCG must be an explicit entry in INTERVAL_RULES.

    Before this fix, _get_min_interval('BCG', ...) returned the fallback
    (28, "default ACIP minimum (antigen not in rule table)").
    After, it returns the explicit BCG entry (0, "WHO position paper").
    """

    def test_bcg_in_interval_rules(self):
        """BCG must have an explicit entry — not missing from the table."""
        self.assertIn("BCG", INTERVAL_RULES, "BCG missing from INTERVAL_RULES")

    def test_bcg_returns_explicit_entry_not_fallback(self):
        """_get_min_interval for BCG must not return the fallback sentinel string."""
        _, source = _get_min_interval("BCG", 0, 1)
        self.assertNotIn("antigen not in rule table", source,
                         "BCG still hitting the 'antigen not in rule table' fallback")

    def test_bcg_interval_zero(self):
        """BCG standard_min_days must be 0 — single-dose, any interval valid."""
        min_days, _ = _get_min_interval("BCG", 0, 1)
        self.assertEqual(min_days, 0)

    def test_bcg_single_dose_note_present(self):
        """BCG INTERVAL_RULES entry must carry a single-dose explanatory note."""
        rule = INTERVAL_RULES["BCG"]
        note = rule.get("note", "")
        self.assertIn("single", note.lower(),
                      "BCG interval rule note should indicate single-dose semantics")


if __name__ == "__main__":
    unittest.main()
