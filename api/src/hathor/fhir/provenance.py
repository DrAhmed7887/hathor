"""FHIR R4 Provenance emitter for Hathor clinical overrides (Commit 8 — Phase C seed).

Posture: **FHIR R4 Provenance, IMMZ-aligned architecture, Phase C seed.**
This module does not claim IMMZ conformance. IMMZ profiles Provenance around
recording Immunization events (who gave the shot); the override-of-rules-engine
use case is not modeled there today. Where the standard has no clean slot, we
use a local `http://hathor.health/...` CodeSystem or a named extension — flagged
at the specific call site.

Business → FHIR mapping (mirrors what was agreed pre-build):

  target[0]           ← recommendation_id      (logical URN; migrates to
                                                ImmunizationRecommendation/{id}
                                                when Phase C persists
                                                recommendations as FHIR
                                                resources)
  recorded            ← override timestamp
  agent[0].who        ← clinician_id           (placeholder — see inline flag)
  agent[0].type       ← 'author' (standard provenance-participant-type code)
  activity            ← local 'clinical-override' code (no standard FHIR /
                        IMMZ equivalent — FLAGGED)
  reason[0]           ← rule_id (local hathor.health/rule-id system)
  reason[1]           ← justification_code + clinical_reason_text (local
                        hathor.health/override-justification system)
  extension[0]        ← phase-e-override-context (custom extension —
                        FLAGGED; no published StructureDefinition artifact)
  entity[0]           ← source Recommendation (logical URN; same Phase C
                        migration note as target[0])

Output sink: one JSON line per override appended to
`<repo>/evaluation/provenance_log.jsonl`. Durable storage (e.g., HAPI FHIR,
Postgres-backed bundle table) is Phase C work; see docs/DEFERRED_DOC_UPDATES.md.
"""

import json
import logging
import pathlib
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from fhir.resources.R4B.provenance import Provenance

if TYPE_CHECKING:
    from hathor.server_sessions import OverrideRecord

_log = logging.getLogger("hathor.fhir.provenance")

# Repo-root-relative log sink. Per-process append; not rotated. See module docstring.
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_LOG_PATH = _REPO_ROOT / "evaluation" / "provenance_log.jsonl"

# ── Local Hathor CodeSystems ──────────────────────────────────────────────────
# These are local (not registered with any terminology server) because no
# standard FHIR or IMMZ value set covers these concepts today.
_SYSTEM_ACTIVITY     = "http://hathor.health/CodeSystem/activity"
_SYSTEM_RULE_ID      = "http://hathor.health/CodeSystem/rule-id"
_SYSTEM_JUSTIFY      = "http://hathor.health/CodeSystem/override-justification"
_SYSTEM_PARTICIPANT  = "http://terminology.hl7.org/CodeSystem/provenance-participant-type"

# Custom extension URL — placeholder. No published StructureDefinition artifact
# exists yet. Phase C will either publish the StructureDefinition or migrate to
# a standard slot if IMMZ evolves to include override context.
_EXT_OVERRIDE_CONTEXT = "http://hathor.health/fhir/StructureDefinition/phase-e-override-context"


def _build_provenance(
    override: "OverrideRecord",
    validation_result: dict[str, Any],
) -> Provenance:
    """Construct the Provenance resource per the mapping in the module docstring."""
    recorded_iso = override.timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    # Logical URN; migrates to ImmunizationRecommendation/{id} when Phase C
    # persists recommendations as FHIR resources.
    target_urn = f"urn:hathor:recommendation:{override.recommendation_id}"

    # reason[1]: structured justification + free-text clinical reason.
    justification_coding: list[dict[str, str]] = []
    if override.justification_code:
        justification_coding.append({
            "system": _SYSTEM_JUSTIFY,
            "code": override.justification_code,
        })
    # FHIR rejects empty strings on `text` fields; only include when populated.
    rule_rationale = validation_result.get("rule_rationale") or ""
    free_text = (override.clinical_reason_text or "").strip()
    reason_rule: dict = {
        "coding": [{
            "system": _SYSTEM_RULE_ID,
            "code": override.rule_id,
            "display": validation_result.get("rule_slug") or override.rule_id,
        }],
    }
    if rule_rationale:
        reason_rule["text"] = rule_rationale
    reason_justify: dict = {}
    if justification_coding:
        reason_justify["coding"] = justification_coding
    if free_text:
        reason_justify["text"] = free_text
    # Guard: reason entries must not be empty.
    reason_entries = [reason_rule]
    if reason_justify:
        reason_entries.append(reason_justify)

    # extension[0]: Phase-E override context. FLAGGED — custom extension, no
    # published StructureDefinition. Carries the deterministic verdict context
    # the clinician overrode, which has no standard FHIR/IMMZ slot today.
    # Nested sub-extensions omit any entry whose valueString would be empty —
    # FHIR rejects empty strings on `valueString`.
    sub_extensions: list[dict] = []
    for sub_url, raw in (
        ("ruleRationale",    validation_result.get("rule_rationale") or ""),
        ("ruleSlug",         validation_result.get("rule_slug") or ""),
        ("severity",         validation_result.get("severity") or ""),
        ("overrideLoggedAs", validation_result.get("override_logged_as") or "AuditEvent"),
    ):
        if raw:
            sub_extensions.append({"url": sub_url, "valueString": raw})
    override_context_ext = {
        "url": _EXT_OVERRIDE_CONTEXT,
        "extension": sub_extensions,
    }

    return Provenance(
        id=str(uuid.uuid4()),
        target=[{
            "reference": target_urn,
            "display": override.recommendation_id,
        }],
        recorded=recorded_iso,
        activity={
            "coding": [{
                "system": _SYSTEM_ACTIVITY,
                "code": "clinical-override",
                "display": "Clinician override of Phase E rule verdict",
            }],
            "text": "Clinician override of Phase E rule verdict",
        },
        agent=[{
            "type": {
                "coding": [{
                    "system": _SYSTEM_PARTICIPANT,
                    "code": "author",
                }],
            },
            # DEMO-CLINICIAN PLACEHOLDER — server has no authentication today.
            # Production: this must be the authenticated physician identity
            # (Reference(Practitioner/{id}) or Reference(PractitionerRole/{id})).
            # See docs/DEFERRED_DOC_UPDATES.md for the production-review checklist.
            "who": {"display": override.clinician_id},
        }],
        reason=reason_entries,
        entity=[{
            "role": "source",
            "what": {
                # Logical URN; migrates to ImmunizationRecommendation/{id} when
                # Phase C persists recommendations as FHIR resources.
                "reference": target_urn,
                "display": f"Phase E verdict: {validation_result.get('rule_slug') or ''}".strip(),
            },
        }],
        extension=[override_context_ext],
    )


def write_override_provenance(
    *,
    override: "OverrideRecord",
    validation_result: dict[str, Any],
) -> str:
    """Emit a Provenance resource for an override and append it to the JSONL sink.

    Returns the Provenance.id so the caller (the /session/{id}/override
    endpoint) can include it in its response for the UI confirmation tick.
    """
    provenance = _build_provenance(override, validation_result)
    resource_json = provenance.model_dump(mode="json", exclude_none=True)

    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOG_PATH.open("a") as f:
        f.write(json.dumps({
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "provenance": resource_json,
        }))
        f.write("\n")

    _log.info(
        "Provenance written provenance_id=%s recommendation_id=%s rule_id=%s",
        provenance.id, override.recommendation_id, override.rule_id,
    )
    return provenance.id
