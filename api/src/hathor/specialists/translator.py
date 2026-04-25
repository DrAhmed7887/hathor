"""Specialist: Translator (multilingual → English).

Owns the single sub-question: "What does each non-English transcription on
this card mean in English, with clinical precision preserved?"

Used to produce a parallel English version of every dose's transcribed
antigen + any free-text fields, so a clinician who doesn't read the source
language can verify the extraction. Also useful for the audit trail —
clinician corrections recorded in English are a stable canonical form.

Conditional execution: skipped if ``card_metadata.detected_language.value``
is "English" (or ``en``). The orchestrator filters this specialist out
when the card is already English to save the API call.
"""

from __future__ import annotations

import json
import time

from hathor.specialists._base import (
    DEFAULT_MODEL,
    Issue,
    SpecialistVerdict,
    run_structured_call,
)

TRANSLATOR_SYSTEM_PROMPT = """You translate the antigen / vaccine names and free-text fields on a non-English vaccination card into English, preserving medical precision. You do NOT add clinical interpretation — that is the main agent's job. You translate, period.

Return raw JSON only — no prose, no markdown fences:

{
  "language": "<source language name in English, e.g. 'Arabic', 'French', 'Tigrinya'>",
  "translations": [
    {
      "dose_index": <int — index into extracted_doses>,
      "original_antigen": "<verbatim from input>",
      "english_antigen": "<English equivalent — generic name, NOT trade name>",
      "translation_confidence": 0.0,
      "ambiguity_note": "<one sentence if the translation is ambiguous; null otherwise>"
    }
  ],
  "metadata_translations": {
    "patient_dob_label": "<English label for the DOB field if it appears in source language; null if not present>",
    "card_title": "<English title of the card if a title is visible; null otherwise>",
    "other_notes": "<any free-text notes translated to English; null if none>"
  },
  "summary": "<one sentence stating language and number of doses translated>"
}

### Translation rules

**Arabic medical terms (Egyptian/Sudanese/Syrian):**
- الالتهاب الكبدى B → Hepatitis B (HepB)
- الالتهاب الكبدى الوبائى → Hepatitis B
- شلل أطفال فموى → Oral Polio Vaccine (OPV)
- شلل أطفال بالحقن / شلل بالحقن → Inactivated Polio Vaccine (IPV)
- الدرن → BCG (tuberculosis vaccine)
- الثلاثى البكتيرى → DTP (Diphtheria-Tetanus-Pertussis)
- الثلاثى الفيروسى → MMR (Measles-Mumps-Rubella)
- الحصبة → Measles
- الحصبة الألمانية → Rubella
- النكاف → Mumps
- جدرى الماء → Varicella (chickenpox)
- الخماسى → Pentavalent (DTP-HepB-Hib)
- السداسى → Hexavalent (DTP-HepB-Hib-IPV)
- المكورات الرئوية / النيموكوكال → PCV (pneumococcal)
- الفيروس العجلى / روتا → Rotavirus
- الحمى الصفراء → Yellow Fever
- المكورات السحائية → Meningococcal (likely MenAfriVac in African context)
- كبسولة فيتامين أ → Vitamin A capsule (NOT a vaccine — flag with translation_confidence 1.0 and ambiguity_note: "Vitamin A is a nutritional supplement, not a vaccine antigen — do not credit toward immunisation coverage.")

**French medical terms (Senegalese/West African):**
- Hépatite B → Hepatitis B
- Polio orale / VPO → Oral Polio Vaccine (OPV)
- Polio injectable / VPI → Inactivated Polio Vaccine (IPV)
- Tuberculose / BCG → BCG
- DTC / DTCoq → DTP (Diphtheria-Tetanus-Pertussis)
- ROR (Rougeole-Oreillons-Rubéole) → MMR
- Rougeole → Measles
- Pentavalent → Pentavalent (DTP-HepB-Hib)
- Fièvre jaune → Yellow Fever

**Tigrinya (Eritrean):**
- Treat as Tigrinya; if you don't know the exact term, transliterate and mark translation_confidence ≤ 0.5 with ambiguity_note explaining.

**Amharic (Ethiopian):**
- Same posture — translate when known, transliterate + flag when uncertain.

### Confidence calibration

- 1.0 : Direct, unambiguous translation (الدرن = BCG; ROR = MMR).
- 0.85–0.95 : Confident but the source has handwriting / abbreviation variance.
- 0.50–0.84 : Ambiguous — could be one of two antigens; explain in ambiguity_note.
- < 0.50 : You cannot confidently translate — provide best-guess + explain.

### What NOT to do

- Do NOT canonicalise to a trade name. "الدرن" → "BCG", not "BCG SSI" or "BCG Pasteur".
- Do NOT interpret clinical meaning. "الحصبة at 9 months" → "Measles", not "Measles monovalent (does not cover Mumps/Rubella)" — that's the attending physician's job.
- Do NOT skip vitamin / supplement entries — translate them but mark with the appropriate ambiguity_note so the main agent excludes them from antigen counting.
- Do NOT invent doses that aren't in the input.
"""


def _is_english(extraction: dict) -> bool:
    """True if the card's detected language is English (any case)."""
    md = extraction.get("card_metadata") or {}
    lang_field = md.get("detected_language") or {}
    val = (lang_field.get("value") or "").strip().lower()
    return val in {"english", "en", "eng"}


async def consult(extraction: dict) -> SpecialistVerdict:
    """Translate non-English content. Skipped (returns empty verdict) for
    English cards — the main agent reads English directly."""
    t_start = time.perf_counter()

    if _is_english(extraction):
        return SpecialistVerdict(
            specialist="translator",
            model=DEFAULT_MODEL,
            elapsed_ms=(time.perf_counter() - t_start) * 1000,
            issues=[
                Issue(
                    code="TRANSLATION_SKIPPED",
                    severity="info",
                    antigen=None,
                    dose_indices=[],
                    summary="Card is in English — translator skipped.",
                    detail="Language detection returned English; no translation needed.",
                    suggested_action=None,
                )
            ],
            summary="Translator skipped (English card).",
            error=None,
        )

    user_message = (
        "Translate the following card's antigen names and free-text fields into "
        "English per the rules in your system prompt.\n\n"
        f"```json\n{json.dumps(extraction, indent=2, ensure_ascii=False)}\n```\n\n"
        "Return your structured JSON verdict."
    )

    try:
        parsed = await run_structured_call(
            specialist_name="translator",
            system_prompt=TRANSLATOR_SYSTEM_PROMPT,
            user_message=user_message,
        )
    except Exception as exc:
        return SpecialistVerdict(
            specialist="translator",
            model=DEFAULT_MODEL,
            elapsed_ms=(time.perf_counter() - t_start) * 1000,
            issues=[],
            summary="",
            error=f"{type(exc).__name__}: {exc}",
        )

    # Repackage translations as info-level issues so the main agent's
    # iteration is uniform across all specialists.
    translations = parsed.get("translations", []) or []
    language = parsed.get("language", "Unknown")
    issues: list[Issue] = []

    for tr in translations:
        if not isinstance(tr, dict):
            continue
        idx = tr.get("dose_index")
        original = tr.get("original_antigen", "")
        english = tr.get("english_antigen", "")
        conf = float(tr.get("translation_confidence", 0.0))
        ambig = tr.get("ambiguity_note")

        sev = "info" if conf >= 0.85 else "warning"
        issues.append(
            Issue(
                code="TRANSLATION",
                severity=sev,
                antigen=english,
                dose_indices=[idx] if isinstance(idx, int) else [],
                summary=f"{original} → {english} (conf {conf:.2f})",
                detail=ambig or f"Translated from {language}.",
                suggested_action=None,
            )
        )

    md_tr = parsed.get("metadata_translations") or {}
    if any(md_tr.get(k) for k in ("patient_dob_label", "card_title", "other_notes")):
        md_text = "; ".join(
            f"{k}: {v}" for k, v in md_tr.items() if v
        )
        issues.append(
            Issue(
                code="TRANSLATION_METADATA",
                severity="info",
                antigen=None,
                dose_indices=[],
                summary=f"Card metadata translated from {language}.",
                detail=md_text,
                suggested_action=None,
            )
        )

    return SpecialistVerdict(
        specialist="translator",
        model=parsed.get("_model", DEFAULT_MODEL),
        elapsed_ms=parsed.get("_elapsed_ms", (time.perf_counter() - t_start) * 1000),
        issues=issues,
        summary=str(parsed.get("summary", f"Translated {len(translations)} doses from {language}.")),
        error=None,
    )
