"""Tool: consult_specialists — fan-out parallel specialist consultation.

Runs the existing card extraction (vision OCR, per-field confidence, Phase D
shape) and then concurrently dispatches the extraction to every specialist
registered in :data:`hathor.specialists.SPECIALISTS`. Returns a single tool
result combining the raw extraction (Phase D contract preserved) with the
list of specialist verdicts.

Wall-clock latency is bound by the slowest specialist, not the sum — that
is the whole point of the parallel pattern. Specialists run via
``asyncio.gather(return_exceptions=True)``: one specialist failing returns
an error verdict (``severity=error``, empty issues), it does not poison
the orchestrator or block the other specialists.

Wire-up: env-flag-gated swap in ``hathor.tools.__init__`` —
``HATHOR_USE_SPECIALISTS=1`` puts ``consult_specialists`` in the agent's
tool list in place of ``extract_vaccinations_from_card``. Default
behaviour unchanged.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from claude_agent_sdk import tool

from hathor.specialists import SPECIALISTS, SpecialistVerdict
from hathor.tools.card_extraction import extract_card

_log = logging.getLogger("hathor.tools.consult_specialists")

# Wall-clock ms of the most recent successful consultation (extract +
# parallel specialists). Mirrors the LAST_VISION_CALL_MS pattern in
# card_extraction so the server's timing_summary SSE event can report
# the breakdown.
LAST_CONSULT_MS: float | None = None
LAST_SPECIALIST_MS: dict[str, float] | None = None


async def _run_one_specialist(
    name: str,
    fn,
    needs_planning: bool,
    extraction_payload: dict,
    target_country: str,
    child_dob: str | None,
) -> SpecialistVerdict:
    """Wrap one specialist call so any exception becomes an error verdict
    rather than propagating into ``gather``. We use this wrapper because
    ``asyncio.gather(return_exceptions=True)`` returns the raw exception
    object — we want a uniform ``SpecialistVerdict`` shape downstream.

    Specialists with ``needs_planning_context=True`` (e.g. catch-up planner)
    receive extra kwargs; review-only specialists get just the extraction.
    """
    t_start = time.perf_counter()
    try:
        if needs_planning:
            return await fn(
                extraction_payload,
                target_country=target_country,
                child_dob=child_dob,
            )
        return await fn(extraction_payload)
    except Exception as exc:  # noqa: BLE001 — we deliberately catch all
        _log.exception("specialist=%s failed", name)
        return SpecialistVerdict(
            specialist=name,
            model="unknown",
            elapsed_ms=(time.perf_counter() - t_start) * 1000,
            issues=[],
            summary="",
            error=f"{type(exc).__name__}: {exc}",
        )


@tool(
    "consult_specialists",
    "Extract vaccinations from a card AND consult 5 parallel specialist sub-agents "
    "in one call: source-country detector, attending physician (common-error checker), "
    "WHO baseline cross-checker, translator (non-English cards only), and catch-up "
    "planner. Returns the same per-field-confidence extraction shape as "
    "extract_vaccinations_from_card (so Phase D still works), plus a "
    "'specialist_verdicts' list with structured findings from each specialist. "
    "Specialists run in parallel — wall-clock latency is the slowest specialist, "
    "not the sum. Use this in place of extract_vaccinations_from_card when you "
    "want pre-computed clinical review alongside extraction. The target_country "
    "and child_dob arguments are required by the catch-up planner; pass best "
    "available values.",
    {"image_path": str, "target_country": str, "child_dob": str},
)
async def consult_specialists(args: dict) -> dict:
    global LAST_CONSULT_MS, LAST_SPECIALIST_MS

    image_path = args.get("image_path", "")
    target_country = args.get("target_country", "Egypt")
    child_dob = args.get("child_dob") or None
    t_start = time.perf_counter()

    extraction = await extract_card(image_path)
    extraction_payload = extraction.model_dump(mode="json")

    # Fan out to every registered specialist in parallel. asyncio.gather
    # returns results in registration order, regardless of completion
    # order — so verdicts can be zipped back to their specialist names.
    verdicts: list[SpecialistVerdict] = await asyncio.gather(
        *(
            _run_one_specialist(
                name, fn, needs_planning,
                extraction_payload, target_country, child_dob,
            )
            for name, fn, needs_planning in SPECIALISTS
        )
    )

    elapsed_ms = (time.perf_counter() - t_start) * 1000
    LAST_CONSULT_MS = elapsed_ms
    LAST_SPECIALIST_MS = {v["specialist"]: v["elapsed_ms"] for v in verdicts}
    _log.info(
        "consult_total_ms=%.0f specialists=%d errors=%d per_specialist=%s",
        elapsed_ms,
        len(verdicts),
        sum(1 for v in verdicts if v.get("error")),
        {k: f"{v:.0f}ms" for k, v in LAST_SPECIALIST_MS.items()},
    )

    combined = {
        **extraction_payload,
        "image_path_received": image_path,
        "specialist_verdicts": verdicts,
    }
    return {"content": [{"type": "text", "text": json.dumps(combined, indent=2, ensure_ascii=False)}]}
