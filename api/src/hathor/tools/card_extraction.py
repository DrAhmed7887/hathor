"""Tool: extract_vaccinations_from_card.

STUB for Phase D testing and demo; real vision extraction in a future commit.

Emits `CardExtractionOutput` with per-field confidence (see
`hathor.schemas.extraction`). Selects one of two stub variants based on the
received `image_path`:

- **Happy path** (default): every field has confidence 1.0. The Phase D gate
  will route nothing to HITL.
- **Phase D demo variant** (`image_path` contains "phase_d" or "hitl_demo"):
  one dose's date is emitted with confidence 0.62 so the Phase D gate routes
  it to HITL review — used to demo the per-field HITL flow end-to-end.

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
    "phase_d" / "hitl_demo" → demo variant; otherwise happy path.
    """
    demo = _is_demo_variant(image_path)

    # In the demo variant, dose 3's administration date is smudged.
    dose3_date = (
        _lo("2024-12-1?", "Day digit is smudged; could be 10, 15, or 18")
        if demo
        else _hi("2024-12-15")
    )

    return CardExtractionOutput(
        card_metadata=CardMetadata(
            detected_language=_hi("English"),
            overall_legibility=_hi("Medium" if demo else "High"),
            patient_dob=_hi("2024-06-15"),
        ),
        extracted_doses=[
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_hi("2024-08-15"),
                dose_number_on_card=_hi("1"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=_hi("2024-10-15"),
                dose_number_on_card=_hi("2"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("Hexyon"),
                date_administered=dose3_date,
                dose_number_on_card=_hi("3"),
            ),
            ExtractedDose(
                transcribed_antigen=_hi("MMR"),
                date_administered=_hi("2025-06-15"),
                dose_number_on_card=_hi("1"),
            ),
        ],
        extraction_method=(
            "STUB — phase_d demo variant (one smudged date)"
            if demo
            else "STUB — happy path (all confidences 1.0)"
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
