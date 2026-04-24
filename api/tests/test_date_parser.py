"""Date parser parity test.

Reads cards/fixtures/synthetic_egypt_handwritten.json — the same JSON
the TypeScript parser test consumes — and walks every parser_case
through hathor.parsing.parse_raw_date. Failures here mean the JS and
Python implementations have drifted and need to be re-aligned.
"""

from __future__ import annotations

import json
import pathlib
import unittest

from hathor.parsing.dates import parse_raw_date

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "cards" / "fixtures" / "synthetic_egypt_handwritten.json"


def _load_fixture() -> dict:
    with FIXTURE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


class TestSyntheticParserFixture(unittest.TestCase):
    """Drive the same JSON fixture through the Python parser as the TS test."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = _load_fixture()

    def test_parser_cases_round_trip(self) -> None:
        for case in self.fixture["parser_cases"]:
            with self.subTest(id=case["id"], raw=case["raw_text"]):
                got = parse_raw_date(case["raw_text"])
                self.assertEqual(got, case["expected_iso"])


class TestParserNegativeCases(unittest.TestCase):
    """Hostile inputs must not throw and must not coerce into dates."""

    def test_does_not_throw_on_garbage(self) -> None:
        for value in [
            "",
            "   ",
            "21/?/2023",
            "abc",
            "{}",
            "21//2023",
            "21..2023",
            "0123456",
            "2023",
            "2023-13-01",
            "2023-02-30",
            "32/01/2023",
            "9/3/24/extra",
            None,
            42,
            object(),
            {},
            [],
        ]:
            with self.subTest(value=repr(value)):
                # The function must never raise on hostile input.
                self.assertIsNone(parse_raw_date(value))

    def test_underdetermined_returns_none(self) -> None:
        for value in ["21/?/2023", "21/03/", "/03/2023", "21/03"]:
            with self.subTest(value=value):
                self.assertIsNone(parse_raw_date(value))

    def test_bare_digit_runs_never_become_dates(self) -> None:
        for value in ["0123456", "1234567", "20230318", "230318", "2305"]:
            with self.subTest(value=value):
                self.assertIsNone(parse_raw_date(value))

    def test_pediatric_window_two_digit_year(self) -> None:
        # Mirrors the TS test: 23 → 2023, never 1923.
        self.assertEqual(parse_raw_date("20/07/23"), "2023-07-20")


if __name__ == "__main__":
    unittest.main()
