"""Phase E scenario evaluation harness.

Loads every fixture in ``evaluation/fixtures/phase_e/*.json``, runs each
through :func:`hathor.safety.phase_e.gate`, and asserts that the active
and superseded ValidationResults match the fixture's declared
expectations. Prints a screenshot-able pass/fail table; exits 0 only when
every fixture matches.

This is a SCENARIO-LEVEL eval — the unit-test layer at
``api/tests/test_phase_e.py`` already pins per-rule behaviour. The
fixtures here demonstrate the rules engine on integrated, realistic
clinical scenarios so judges and reviewers can see the engine catch
defect classes end-to-end without needing to read the source.

Fixture schema (each *.json):

    {
      "name": str,                       # one-line title
      "description": str,                # rationale
      "context": {                       # → ClinicalContext
        "child_dob": "YYYY-MM-DD",
        "target_country": str,
        "source_country": str,
        "current_date": "YYYY-MM-DD",    # optional; defaults to today
        "confirmed_doses": [{...}, ...]
      },
      "recommendations": [<Recommendation dict>, ...],
      "expects": [
        {
          "recommendation_id": str,
          "rule_id": str,
          "severity": "pass" | "warn" | "fail" | "override_required",
          "supersedes": str | None,                     # optional
          "in": "active" | "superseded",                # optional, default "active"
          "justification_codes_present": [str, ...]     # optional
        },
        ...
      ],
      "forbids": [                                      # optional
        {
          "recommendation_id": str,
          "rule_id": str,
          "severity": "..." | null                      # null = forbid any severity
        },
        ...
      ]
    }

Run:

    cd api && uv run python ../evaluation/run_phase_e_eval.py

(or invoke from anywhere with a Python that has the ``hathor`` package
installed; the script self-adds ``api/src`` to ``sys.path`` as a
fallback.)
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
API_SRC = PROJECT_ROOT / "api" / "src"
if API_SRC.is_dir() and str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from hathor.safety.phase_e import ClinicalContext, gate  # noqa: E402
from hathor.schemas.recommendation import (  # noqa: E402
    Recommendation,
    ValidationResult,
)

FIXTURES_DIR = HERE / "fixtures" / "phase_e"


def _load_context(d: dict) -> ClinicalContext:
    kwargs = {
        "child_dob": date.fromisoformat(d["child_dob"]),
        "target_country": d["target_country"],
        "source_country": d.get("source_country", ""),
        "confirmed_doses": list(d.get("confirmed_doses", [])),
    }
    if "current_date" in d:
        kwargs["current_date"] = date.fromisoformat(d["current_date"])
    return ClinicalContext(**kwargs)


def _load_recommendation(d: dict) -> Recommendation:
    return Recommendation.model_validate(d)


def _results_for(
    output_list: list[ValidationResult], rec_id: str, rule_id: str
) -> list[ValidationResult]:
    return [
        r for r in output_list if r.recommendation_id == rec_id and r.rule_id == rule_id
    ]


def _summarise_results(
    results: list[ValidationResult], rec_id: str
) -> list[tuple[str | None, str]]:
    return [(r.rule_id, r.severity) for r in results if r.recommendation_id == rec_id]


@dataclass
class FixtureOutcome:
    name: str
    title: str
    passed: bool
    failures: list[str]


def _check_fixture(fixture_path: Path) -> FixtureOutcome:
    with open(fixture_path) as f:
        fx = json.load(f)

    title = fx.get("name", fixture_path.stem)
    failures: list[str] = []

    try:
        ctx = _load_context(fx["context"])
        recs = [_load_recommendation(r) for r in fx["recommendations"]]
    except Exception as exc:  # malformed fixture — surface the problem
        return FixtureOutcome(
            name=fixture_path.stem,
            title=title,
            passed=False,
            failures=[f"fixture load error: {exc!r}"],
        )

    output = gate(recs, ctx)

    for expect in fx.get("expects", []):
        rec_id = expect["recommendation_id"]
        rule_id = expect["rule_id"]
        severity = expect["severity"]
        in_list = expect.get("in", "active")
        target_list = output.active if in_list == "active" else output.superseded

        candidates = _results_for(target_list, rec_id, rule_id)
        matching_severity = [r for r in candidates if r.severity == severity]
        if not matching_severity:
            actual_active = _summarise_results(output.active, rec_id)
            actual_superseded = _summarise_results(output.superseded, rec_id)
            failures.append(
                f"expected {rule_id}={severity} in {in_list} for {rec_id}; "
                f"active={actual_active}; superseded={actual_superseded}"
            )
            continue

        result = matching_severity[0]

        if "supersedes" in expect:
            expected_supersedes = expect["supersedes"]
            if result.supersedes != expected_supersedes:
                failures.append(
                    f"expected {rule_id} to supersede {expected_supersedes!r} "
                    f"for {rec_id}; got {result.supersedes!r}"
                )

        if "justification_codes_present" in expect:
            actual_codes = set(result.override_justification_codes or [])
            for code in expect["justification_codes_present"]:
                if code not in actual_codes:
                    failures.append(
                        f"expected justification code {code!r} on "
                        f"{rec_id}/{rule_id}; got {sorted(actual_codes)}"
                    )

    for forbid in fx.get("forbids", []):
        rec_id = forbid["recommendation_id"]
        rule_id = forbid["rule_id"]
        severity = forbid.get("severity")
        candidates = _results_for(output.active, rec_id, rule_id)
        if severity is None:
            if candidates:
                failures.append(
                    f"forbidden: {rule_id} appeared in active for {rec_id}; "
                    f"got severities {[r.severity for r in candidates]}"
                )
        else:
            offending = [r for r in candidates if r.severity == severity]
            if offending:
                failures.append(
                    f"forbidden: {rule_id}={severity} appeared in active for {rec_id}"
                )

    return FixtureOutcome(
        name=fixture_path.stem,
        title=title,
        passed=not failures,
        failures=failures,
    )


def _print_table(outcomes: list[FixtureOutcome]) -> None:
    name_w = max((len(o.name) for o in outcomes), default=len("Fixture"))
    name_w = max(name_w, len("Fixture"))
    title_w = max((len(o.title) for o in outcomes), default=len("Description"))
    title_w = min(title_w, 90)

    sep = f"  {'-' * name_w}  {'-' * 6}  {'-' * title_w}"
    print()
    print(f"  {'Fixture':<{name_w}}  {'Status':<6}  {'Description':<{title_w}}")
    print(sep)
    for o in outcomes:
        status = "PASS" if o.passed else "FAIL"
        title = o.title if len(o.title) <= title_w else o.title[: title_w - 1] + "…"
        print(f"  {o.name:<{name_w}}  {status:<6}  {title:<{title_w}}")
    print(sep)
    passed = sum(1 for o in outcomes if o.passed)
    print(f"  {passed}/{len(outcomes)} passed")
    print()


def main() -> int:
    fixture_paths = sorted(FIXTURES_DIR.glob("*.json"))
    if not fixture_paths:
        print(f"No fixtures found in {FIXTURES_DIR}", file=sys.stderr)
        return 1

    outcomes = [_check_fixture(p) for p in fixture_paths]
    _print_table(outcomes)

    failed = [o for o in outcomes if not o.passed]
    if failed:
        print("Failures:")
        for o in failed:
            print(f"  {o.name}:")
            for msg in o.failures:
                print(f"    - {msg}")
        print()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
