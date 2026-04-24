"""Tool: extract_vaccinations_from_card.

STUB for Phase D testing and demo; real vision extraction in a future commit.

Emits `CardExtractionOutput` with per-field confidence (see
`hathor.schemas.extraction`). Selects one of two stub variants based on the
received `image_path`:

- **Nigerian EPI flagship** (default): DOB 2025-12-09 (child is 136 days old
  at reconciliation time 2026-04-24 — past the 15-week Rotavirus dose-1
  initiation cutoff). BCG at birth, Pentavalent × 3 + OPV × 3 at Nigerian NPI
  6/10/14-week timing. No Rotavirus. All confidences 1.0. Designed to surface
  HATHOR-AGE-003 override_required when source_country is Nigeria.
- **Phase D demo variant** (`image_path` contains "phase_d" or "hitl_demo"):
  same dose set, but Pentavalent dose 3's administration date is emitted with
  confidence 0.62 so the Phase D gate routes it to HITL review — used to demo
  the per-field HITL flow end-to-end.

Neither variant performs real OCR. Both are deterministic.
"""

import json

from claude_agent_sdk import tool

from hathor.schemas.extraction import (
    CardExtractionOutput,
    CardMetadata,
    ExtractedDose,
    FieldExtraction,
)


def _hi(value: str) -> FieldExtraction:
    """High-confidence stub field. STUB for Phase D testing."""
    return FieldExtraction(value=value, confidence=1.0, needs_review=False)


def _lo(value: str, reason: str) -> FieldExtraction:
    """Low-confidence stub field — will be routed to HITL by Phase D.
    STUB for Phase D testing."""
    return FieldExtraction(
        value=value,
        confidence=0.62,
        needs_review=True,
        ambiguity_reason=reason,
    )


def _is_demo_variant(image_path: str) -> bool:
    p = image_path.lower()
    return "phase_d" in p or "hitl_demo" in p


def build_stub_output(image_path: str) -> CardExtractionOutput:
    """Return one of two stub variants. STUB for Phase D testing and demo;
    real vision extraction in a future commit.

    Variant selection (see module docstring): image_path sniff for
    "phase_d" / "hitl_demo" → Phase D demo variant; otherwise flagship.

    Flagship scenario: Nigerian infant, DOB 2025-12-09. At reconciliation
    time (2026-04-24) the child is 136 days old — past the ACIP 15-week
    (105-day) Rotavirus dose-1 initiation cutoff — and has never received
    a Rotavirus dose. BCG at birth; Pentavalent × 3 + OPV × 3 on Nigerian
    NPI 6/10/14-week primary timing. No MMR (child is only ~4.5 months).
    Designed to surface HATHOR-AGE-003 override_required when the agent
    correctly infers source_country = "Nigeria".
    """
    demo = _is_demo_variant(image_path)

    # In the Phase D demo variant, Pentavalent dose 3's administration date
    # is smudged so the Phase D gate routes it to HITL review.
    penta3_date = (
        _lo("2026-03-1?", "Day digit is smudged; could be 15, 16, or 17")
        if demo
        else _hi("2026-03-17")
    )

    return CardExtractionOutput(
        card_metadata=CardMetadata(
            detected_language=_hi("English"),
            overall_legibility=_hi("Medium" if demo else "High"),
            patient_dob=_hi("2025-12-09"),
        ),
        extracted_doses=[
            # BCG at birth — standard Nigerian NPI
            ExtractedDose(
                transcribed_antigen=_hi("BCG"),
                date_administered=_hi("2025-12-09"),
                dose_number_on_card=_hi("1"),
            ),
            # Pentavalent (DPT-HepB-Hib) × 3 at 6/10/14 weeks — Nigerian NPI primary series
            ExtractedDose(
                transcribed_antigen=_hi("Pentavalent (DPT-HepB-Hib)"),
                date_administered=_hi("2026-01-20"),  # +42 days (6 weeks)
                dose_number_on_card=_hi("1"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("OPV"),
                date_administered=_hi("2026-01-20"),
                dose_number_on_card=_hi("1"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("Pentavalent (DPT-HepB-Hib)"),
                date_administered=_hi("2026-02-17"),  # +70 days (10 weeks)
                dose_number_on_card=_hi("2"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("OPV"),
                date_administered=_hi("2026-02-17"),
                dose_number_on_card=_hi("2"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("Pentavalent (DPT-HepB-Hib)"),
                date_administered=penta3_date,          # +98 days (14 weeks); smudged in Phase D
                dose_number_on_card=_hi("3"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("OPV"),
                date_administered=_hi("2026-03-17"),    # +98 days (14 weeks)
                dose_number_on_card=_hi("3"),
            ),
        ],
        extraction_method=(
            "STUB — phase_d demo variant (Pentavalent dose 3 date smudged)"
            if demo
            else "STUB — Nigerian EPI flagship (no Rotavirus; child past 15-week cutoff)"
        ),
    )


@tool(
    "extract_vaccinations_from_card",
    "Extract all vaccination records from a child's vaccination card image. "
    "Returns CardExtractionOutput with per-field confidence scores, "
    "needs_review flags, and ambiguity reasons. "
    "[STUB for Phase D testing and demo; real vision extraction in a future "
    "commit. If the image_path contains 'phase_d' or 'hitl_demo', one dose's "
    "date is emitted with confidence 0.62 to exercise the HITL gate; "
    "otherwise all field confidences are 1.0.]",
    {"image_path": str},
)
async def extract_vaccinations_from_card(args: dict) -> dict:
    """STUB for Phase D testing and demo; real vision extraction in a future commit."""
    image_path = args.get("image_path", "")
    output = build_stub_output(image_path)
    payload = output.model_dump(mode="json")
    payload["image_path_received"] = image_path
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}
