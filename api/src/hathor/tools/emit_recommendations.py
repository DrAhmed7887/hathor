"""Tool: emit_recommendations — submit final structured clinical recommendations to Phase E.

The agent calls this tool EXACTLY ONCE at the end of reasoning, after all dose
validation and catch-up planning is complete. Phase E validates every recommendation
against deterministic clinical rules before the output reaches the clinician UI or
the FHIR bundle.

**Server-side enforcement (owned here, not in the agent prompt):**

1. **ID namespace ownership.** The server assigns a fresh UUID4 to each incoming
   recommendation and preserves the agent's original id under ``agent_id``. This
   guarantees UI row uniqueness regardless of what the agent emitted — prompt
   tuning cannot make it correct on its own.
2. **Emission completeness check.** Before ``gate()`` runs, the tool verifies
   that every antigen in ``PHASE1_ANTIGENS`` either (a) has at least one
   recommendation emitted for it or (b) has a confirmed dose in
   ``ctx.confirmed_doses`` that covers it (including components of combination
   vaccines like Hexavalent → {DPT, HepB, Hib, IPV}). If neither holds, the
   tool returns an ``incomplete_emission`` error response so the agent can
   retry with the missing recommendations included.

See docs/SAFETY_LOOPS.md — Phase E for the gate design.
See docs/schema-proposal.md §4 for the approved tool interface.
"""

import json
import uuid
from datetime import date

from claude_agent_sdk import tool

# NOTE: hathor.safety.phase_e is NOT imported at module level.
# phase_e.py imports from hathor.tools.dose_validation, which triggers
# hathor/tools/__init__.py, which imports this module → circular import.
# Deferring the import to inside the function body breaks the cycle.
from hathor.schemas.recommendation import Recommendation, ValidationResult


def _serialize_result(r: ValidationResult, agent_id: str | None = None) -> dict:
    """Serialize a ValidationResult for the agent response.

    ``agent_id`` is the id the agent originally supplied for this
    recommendation (before server-side reassignment). Included so the agent
    can correlate Phase E verdicts with its own reasoning log.
    """
    return {
        "recommendation_id": r.recommendation_id,
        "agent_id": agent_id,
        "severity": r.severity,
        "rule_id": r.rule_id,
        "rule_slug": r.rule_slug,
        "rule_rationale": r.rule_rationale,
        "override_allowed": r.override_allowed,
        "override_logged_as": r.override_logged_as,
        "supersedes": r.supersedes,
        "override_justification_codes": r.override_justification_codes,
    }


def _check_emission_completeness(
    recommendations: list[Recommendation],
    confirmed_doses: list[dict],
) -> list[str]:
    """Return sorted list of required diseases that have neither an emitted
    recommendation nor a confirmed dose covering them. Empty list = emission
    is complete.

    Required set: ``REQUIRED_COMPONENT_ANTIGENS`` (disease-level; narrower
    than PHASE1_ANTIGENS which is a product-recognition list).

    Coverage resolution uses ``expand_antigen_coverage`` so that:
    - A Pentavalent dose satisfies Diphtheria, Tetanus, Pertussis, HepB, Hib
      (via COMBINATION_COMPONENTS → "DPT"/"HepB"/"Hib", then DPT →
      Diphtheria/Tetanus/Pertussis via ANTIGEN_DISEASE_COVERAGE).
    - A Hexavalent dose additionally satisfies Polio (via IPV).
    - MMR/MR/MMRV expand to Measles/Mumps/Rubella (+ Varicella for MMRV,
      which is not in the required set but doesn't hurt).
    - Pertussis spelling variants (DTaP, DT, DTP, DTwP) normalize to DPT.

    Rationale: server-side enforcement of "take a position on every in-scope
    clinical target." Generalizes the Rotavirus window-closed case — a
    specific clinical fix identified in docs/CLINICAL_DECISIONS.md Q6 that
    the agent otherwise sometimes omits in live runs.
    """
    # Deferred import — matches the tool body pattern for the same reason.
    from hathor.safety.phase_e import (
        REQUIRED_COMPONENT_ANTIGENS,
        expand_antigen_coverage,
    )

    coverage: set[str] = set()
    for rec in recommendations:
        coverage |= expand_antigen_coverage(rec.antigen)
    for dose in confirmed_doses:
        ag = dose.get("antigen", "") if isinstance(dose, dict) else ""
        coverage |= expand_antigen_coverage(ag)

    return sorted(REQUIRED_COMPONENT_ANTIGENS - coverage)


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
        "REQUIRED on every 'dose_verdict' recommendation: source_dose_indices — a list "
        "of integer indices into clinical_context.confirmed_doses identifying the dose(s) "
        "this verdict evaluates. Convention: last index = dose being evaluated; "
        "second-to-last = prior dose in the series when the verdict depends on an interval. "
        "Phase E rules (HATHOR-AGE-001 min-age, HATHOR-AGE-003 rotavirus cutoff, "
        "HATHOR-DOSE-002 interval, HATHOR-DOSE-003 grace period, HATHOR-EPI-002 live-coadmin) "
        "all guard-return None when source_dose_indices is missing on a dose_verdict, which "
        "silently skips the rule and bypasses the Friction by Design override pathway. "
        "A dose_verdict without source_dose_indices is a malformed recommendation. "
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

    # ── Server-side ID namespace ownership ──────────────────────────────────
    # Reassign a fresh UUID4 to each recommendation's canonical id; preserve
    # the agent-provided id under agent_id so the agent can correlate its
    # reasoning log with the Phase E verdicts returned below. This guarantees
    # uniqueness even when the agent emits duplicate ids (observed in live
    # runs; caused React-key collisions + doubled rows in the Phase E panel).
    id_mapping: dict[str, str] = {}          # server_id → agent_id
    for rec in recommendations:
        rec.agent_id = rec.recommendation_id
        rec.recommendation_id = str(uuid.uuid4())
        id_mapping[rec.recommendation_id] = rec.agent_id or ""

    # ── Server-side emission completeness check ─────────────────────────────
    # Enforces: every antigen in PHASE1_ANTIGENS must have either an emitted
    # recommendation or a confirmed dose (direct or via combination-vaccine
    # components). Prevents silent omission of clinically-required verdicts
    # like the Rotavirus window-closed case for high-burden-origin migrants
    # (docs/CLINICAL_DECISIONS.md Q6) — a failure mode the agent exhibited
    # non-deterministically under prompt-only enforcement.
    missing_antigens = _check_emission_completeness(recommendations, ctx.confirmed_doses)
    if missing_antigens:
        return {
            "content": [{
                "type": "text",
                "text": json.dumps({
                    "error": "incomplete_emission",
                    "message": (
                        f"Missing required recommendations for antigens: "
                        f"{missing_antigens}. Patient has no confirmed doses "
                        "for these antigens. Emit a dose_verdict, overdue, or "
                        "catchup_visit for each, with source_dose_indices=[] "
                        "and severity per clinical rules. Re-call "
                        "emit_recommendations with the missing recommendations "
                        "added to your previous emission."
                    ),
                    "missing_antigens": missing_antigens,
                }),
            }]
        }

    # Run Phase E gate
    output = gate(recommendations, ctx)

    result = {
        "total_recommendations": len(recommendations),
        "has_failures": output.has_failures,
        "has_override_required": output.has_override_required,
        "active_results": [
            _serialize_result(r, id_mapping.get(r.recommendation_id))
            for r in output.active
        ],
        "superseded_results": [
            _serialize_result(r, id_mapping.get(r.recommendation_id))
            for r in output.superseded
        ],
        "id_mapping_note": (
            "recommendation_id is server-assigned (UUID4). Each result "
            "includes the agent_id you originally supplied so you can "
            "correlate with your reasoning log."
        ),
        "provenance_note": (
            "superseded_results are preserved for FHIR Provenance logging "
            "even though they are not presented to the clinician."
        ),
    }
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
