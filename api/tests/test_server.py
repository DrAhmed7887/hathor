"""Tests for the /validate-schedule HTTP wrapper over the dose-validation engine.

The engine itself is covered by test_dose_tools.py and the broader suite; these
tests exercise the HTTP surface: health check, a valid BCG+OPV dose-1 payload
(mirroring the dose-1 smoke path from commit 286f9f5), and a malformed payload
that must surface as 422 via pydantic.
"""

import unittest

from fastapi.testclient import TestClient

from hathor import server as server_mod


class TestServerHTTP(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(server_mod.app)

    def test_health(self) -> None:
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "ok")
        self.assertIn("model", body)

    def test_validate_schedule_bcg_opv_dose1(self) -> None:
        """Birth-day BCG + OPV dose 1 — both are valid with no prior doses."""
        resp = self.client.post(
            "/validate-schedule",
            json={
                "child_dob": "2024-01-15",
                "records": [
                    {
                        "antigen": "BCG",
                        "date": "2024-01-15",
                        "dose_number": 1,
                        "prior_dose_age_days": None,
                    },
                    {
                        "antigen": "OPV",
                        "date": "2024-01-15",
                        "dose_number": 1,
                        "prior_dose_age_days": None,
                    },
                ],
            },
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(len(body), 2)
        for entry in body:
            self.assertTrue(
                entry["valid"],
                f"Expected valid, got reasons: {entry.get('reasons')}",
            )
        self.assertEqual(body[0]["antigen"], "BCG")
        self.assertEqual(body[1]["antigen"], "OPV")

    def test_validate_schedule_malformed_returns_422(self) -> None:
        """Missing required fields (antigen, child_dob) must surface as 422."""
        resp = self.client.post(
            "/validate-schedule",
            json={"records": [{"date": "2024-01-15", "dose_number": 1}]},
        )
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
