import asyncio
import json
from pathlib import Path
import unittest

from hathor.schedules.age import parse_age_administered
from hathor.schedules.validation import validate_schedule_seed
from hathor.schedules.vaccine_synonyms import lookup_vaccine_synonym
from hathor.tools.schedule import get_schedule
from hathor.tools.vaccine_lookup import lookup_vaccine_equivalence


REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEDULES_DIR = REPO_ROOT / "data" / "schedules"


class TestWhoAgeAdministeredParser(unittest.TestCase):
    def test_birth_code(self):
        parsed = parse_age_administered("B")
        self.assertEqual(parsed["recommended_age_unit"], "birth")
        self.assertEqual(parsed["recommended_age_months"], 0)
        self.assertTrue(parsed["is_birth_dose"])

    def test_week_code(self):
        parsed = parse_age_administered("W6")
        self.assertEqual(parsed["recommended_age_unit"], "weeks")
        self.assertEqual(parsed["recommended_age_value"], 6)
        self.assertAlmostEqual(parsed["recommended_age_months"], 1.38)

    def test_month_code(self):
        parsed = parse_age_administered("M9")
        self.assertEqual(parsed["recommended_age_unit"], "months")
        self.assertEqual(parsed["recommended_age_value"], 9)
        self.assertEqual(parsed["recommended_age_months"], 9)

    def test_year_code(self):
        parsed = parse_age_administered("Y9")
        self.assertEqual(parsed["recommended_age_unit"], "years")
        self.assertEqual(parsed["recommended_age_value"], 9)
        self.assertEqual(parsed["recommended_age_months"], 108)

    def test_first_contact_code(self):
        parsed = parse_age_administered("1st contact")
        self.assertEqual(parsed["recommended_age_unit"], "contact_based")
        self.assertIsNone(parsed["recommended_age_months"])
        self.assertFalse(parsed["age_is_fixed"])


class TestScheduleSeedValidation(unittest.TestCase):
    def test_existing_schedule_files_validate(self):
        failures: dict[str, list[str]] = {}
        for path in sorted(SCHEDULES_DIR.glob("*.json")):
            schedule = json.loads(path.read_text())
            errors = validate_schedule_seed(schedule)
            if errors:
                failures[path.name] = errors
        self.assertEqual(failures, {})


class TestVaccineSynonyms(unittest.TestCase):
    def test_arabic_synonyms(self):
        self.assertEqual(lookup_vaccine_synonym("بي سي جي")["canonical_name"], "BCG")
        self.assertEqual(lookup_vaccine_synonym("شلل الأطفال")["canonical_name"], "OPV")
        self.assertEqual(lookup_vaccine_synonym("التهاب كبدي ب")["canonical_name"], "HepB")

    def test_french_synonyms(self):
        self.assertEqual(lookup_vaccine_synonym("VPO")["canonical_name"], "OPV")
        self.assertEqual(lookup_vaccine_synonym("VPI")["canonical_name"], "IPV")
        self.assertEqual(lookup_vaccine_synonym("VPH")["canonical_name"], "HPV")

    def test_english_synonyms(self):
        self.assertEqual(lookup_vaccine_synonym("Yellow Fever")["canonical_name"], "Yellow Fever")
        self.assertEqual(lookup_vaccine_synonym("Tdap")["canonical_name"], "Tdap")
        self.assertEqual(lookup_vaccine_synonym("MenA")["canonical_name"], "MenA")

    def test_legacy_vaccine_lookup_uses_synonyms(self):
        result = asyncio.run(lookup_vaccine_equivalence.handler({
            "vaccine_name": "خماسي",
            "target_country": "Egypt",
        }))
        body = json.loads(result["content"][0]["text"])
        self.assertTrue(body["found"])
        self.assertEqual(body["canonical_name"], "Penta")
        self.assertEqual(body["source"], "Hathor African card synonym mapping")


class TestScheduleFilteringCompatibility(unittest.TestCase):
    def test_nigeria_week_based_rows_are_returned(self):
        result = asyncio.run(get_schedule.handler({
            "country_code": "Nigeria",
            "child_age_months": 0,
        }))
        body = json.loads(result["content"][0]["text"])
        returned = {
            (dose["antigen"], dose["dose_number"])
            for dose in body["doses"]
        }
        self.assertIn(("Pentavalent", 1), returned)
        self.assertIn(("OPV", 2), returned)
        penta1 = next(
            dose for dose in body["doses"]
            if dose["antigen"] == "Pentavalent" and dose["dose_number"] == 1
        )
        self.assertEqual(penta1["recommended_age_unit"], "weeks")
        self.assertEqual(penta1["recommended_age_value"], 6)
        self.assertAlmostEqual(penta1["recommended_age_months"], 1.38)


if __name__ == "__main__":
    unittest.main()
