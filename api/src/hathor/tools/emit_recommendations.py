"""Tool: emit_recommendations — submit final structured clinical recommendations to Phase E.

The agent calls this tool EXACTLY ONCE at the end of reasoning, after all dose
validation and catch-up planning is complete. Phase E validates every recommendation
against deterministic clinical rules before the output reaches the clinician UI or
the FHIR bundle.

See docs/SAFETY_LOOPS.md — Phase E for the gate design.
See docs/schema-proposal.md §4 for the approved tool interface.
"""

import json
from datetime import date

from claude_agent_sdk import tool

# NOTE: hathor.safety.phase_e is NOT imported at module level.
# phase_e.py imports from hathor.tools.dose_validation, which triggers
# hathor/tools/__init__.py, which imports this module → circular import.
# Deferring the import to inside the function body breaks the cycle.
from hathor.schemas.recommendation import Recommendation, ValidationResult


def _serialize_result(r: ValidationResult) -> dict:
    return {
        "recommendation_id": r.recommendation_id,
        "severity": r.severity,
        "rule_id": r.rule_id,
        "rule_slug": r.rule_slug,
        "rule_rationale": r.rule_rationale,
        "override_allowed": r.override_allowed,
        "override_logged_as": r.override_logged_as,
        "supersedes": r.supersedes,
        "override_justification_codes": r.override_justification_codes,
    }


@tool(
    "emit_recommendations",
    (
        "Submit the final structured clinical recommendations for Phase E validation. "
        "Call this EXACTLY ONCE at the end of your reasoning, after all dose validation "
        "and catch-up planning is complete. Every actionable clinical claim — "
        "'due', 'overdue', 'catchup_visit', 'dose_verdict', or 'contra' — must appear "
        "here. Do not make clinical claims in your text response that are not also "
        "represented in this list. Narrative text (card summary, educational notes, "
        "uncertainty annotations) goes in your text response, not here. "
        "Phase E will validate each recommendation against deterministic clinical rules "
        "and return a ValidationResult per recommendation with severity 'pass', 'warn', "
        "'fail', or 'override_required'. "
        "For 'fail' results: explain the blocking rule in one sentence, state "
        "that clinician override is available and will be logged via FHIR Provenance, "
        "ask for the clinical reason as free text, and do not finalize the recommendation "
        "until the clinician responds. "
        "For 'override_required' results (Friction by Design): apply distinct visual "
        "treatment — these carry documented adverse-event risk. Present the available "
        "justification codes from override_justification_codes to the clinician, require "
        "selection of exactly one code plus optional free text, and log both to FHIR "
        "Provenance. Do not treat override_required the same as fail."
    ),
    {
        "recommendations": list,
        "clinical_context": dict,
    },
)
async def emit_recommendations(args: dict) -> dict:
    # Deferred import — must stay inside the function to avoid circular import.
    # See module-level comment above.
    from hathor.safety.phase_e import ClinicalContext, gate

    raw_recs: list = args.get("recommendations", [])
    ctx_dict: dict = args.get("clinical_context", {})

    # Build clinical context
    dob_str = ctx_dict.get("child_dob", "")
    try:
        child_dob = date.fromisoformat(dob_str)
    except (ValueError, TypeError):
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "error": (
                        f"clinical_context.child_dob must be ISO date (YYYY-MM-DD), "
                        f"got: {dob_str!r}"
                    )
                }),
            }]
        }
    ctx = ClinicalContext(
        child_dob=child_dob,
        target_country=ctx_dict.get("target_country", "Egypt"),
        source_country=ctx_dict.get("source_country", ""),
        confirmed_doses=ctx_dict.get("confirmed_doses", []),
    )

    # Validate each recommendation dict against the Recommendation schema
    recommendations: list[Recommendation] = []
    schema_errors: list[str] = []
    for i, rec_dict in enumerate(raw_recs):
        try:
            recommendations.append(Recommendation.model_validate(rec_dict))
        except Exception as exc:
            schema_errors.append(f"recommendations[{i}]: {exc}")

    if schema_errors:
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "error": "One or more recommendations failed schema validation.",
                    "details": schema_errors,
                }),
            }]
        }

    # Run Phase E gate
    output = gate(recommendations, ctx)

    result = {
        "total_recommendations": len(recommendations),
        "has_failures": output.has_failures,
        "has_override_required": output.has_override_required,
        "active_results": [_serialize_result(r) for r in output.active],
        "superseded_results": [_serialize_result(r) for r in output.superseded],
        "provenance_note": (
            "superseded_results are preserved for FHIR Provenance logging "
            "even though they are not presented to the clinician."
        ),
    }
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
