"""Hathor FastAPI server — SSE endpoints for the reconciliation agent.

POST /reconcile-stream
  Request:  JSON body with child_dob, target_country, given_doses
  Response: text/event-stream — events stream as the agent reasons

POST /reconcile/card
  Request:  JSON body with image_path, child_dob, target_country, model?
  Response: text/event-stream — runs extract → Phase D → (HITL roundtrip) → agent

POST /reconcile/hitl/{session_id}/corrections
  Request:  JSON body with corrections list
  Response: 200 on success; 404 unknown session; 410 expired; 400 malformed

Event types emitted:
  agent_start    — once at start: model name, tool count
  thinking       — each thinking block
  tool_use       — each tool call (index, name, input)
  tool_result    — each tool result (index, is_error, result JSON)
  assistant_text — intermediate text blocks (with tool calls)
  final_plan     — the terminal report (no tool calls in that message)
  run_complete   — run stats
  error          — any exception
  hitl_required  — Phase D needs clinician review (from /reconcile/card only)
  hitl_timeout   — HITL session expired without corrections
"""

import asyncio
import datetime as _dt
import json
import logging
import os
import pathlib
import re
from typing import AsyncGenerator, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, create_sdk_mcp_server
from claude_agent_sdk.types import (
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from hathor.agent_prompt import SYSTEM_PROMPT
from hathor.safety import phase_d
from hathor.schemas.extraction import CardExtractionOutput, FieldExtraction
from hathor.server_sessions import RECONCILE_SESSIONS, SESSIONS, HITLSession
from hathor.tools import HATHOR_TOOLS
from hathor.tools.card_extraction import build_stub_output

MODEL = os.environ.get("HATHOR_MODEL", "claude-opus-4-7")
MCP_SERVER_NAME = "hathor"

_log = logging.getLogger("hathor.server")
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
CARDS_DIR = (REPO_ROOT / "cards").resolve()

app = FastAPI(title="Hathor API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class DoseRecord(BaseModel):
    vaccine_trade_name: str
    date_given: str
    source: str = "vaccination card"


class ValidateScheduleRecord(BaseModel):
    antigen: str
    date: str
    # Nullable so booster rows the card does not number can still reach
    # the engine. Primary-series rows carry an integer; boosters without
    # a numbered position arrive as None. The engine validates boosters
    # by antigen + age + interval rather than by a dose position it does
    # not encode — see validate_dose's dose_kind handling.
    dose_number: int | None = None
    # Clinical class of the row. Defaults to "primary" for backward
    # compatibility with payloads predating the booster fix.
    dose_kind: Literal["primary", "booster", "birth", "unknown"] = "primary"
    prior_dose_age_days: int | None = None


class ValidateScheduleRequest(BaseModel):
    records: list[ValidateScheduleRecord]
    child_dob: str


class ReconcileRequest(BaseModel):
    child_dob: str
    target_country: str = "Egypt"
    given_doses: list[DoseRecord]
    model: str | None = None


class ReconcileCardRequest(BaseModel):
    image_path: str
    child_dob: str
    target_country: str = "Egypt"
    model: str | None = None


class HITLCorrection(BaseModel):
    field_path: str
    action: Literal["edit", "keep", "skip"]
    corrected_value: str | None = None


class HITLCorrectionsRequest(BaseModel):
    corrections: list[HITLCorrection] = Field(default_factory=list)


class OverrideSubmissionRequest(BaseModel):
    recommendation_id: str
    rule_id: str
    # justification_code: required when overriding `override_required`;
    # omit (null) when overriding `fail` (free-text only).
    justification_code: str | None = None
    # clinical_reason_text: required for `fail`; optional for `override_required`.
    clinical_reason_text: str | None = None
    # severity tells the server which validation branch applies.
    severity: Literal["fail", "override_required"]


def _sse(event_type: str, data: dict) -> bytes:
    """Format a single SSE event as UTF-8 bytes."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n".encode()


_DOSE_PATH_RE = re.compile(r"^extracted_doses\[(\d+)\]\.(\w+)$")
_METADATA_PATH_RE = re.compile(r"^card_metadata\.(\w+)$")


def _validate_image_path(raw: str) -> pathlib.Path:
    """Return the resolved Path if `raw` is inside CARDS_DIR.

    Rejects (with HTTPException 400 + INFO log):
    - Absolute paths outside the allowlist.
    - Paths containing `..` traversal sequences (even when they resolve
      back inside CARDS_DIR — cheap to be strict here).
    - Paths that resolve outside CARDS_DIR.

    The file does not need to exist — the extraction tool is still stubbed.
    """
    if not isinstance(raw, str) or not raw:
        _log.info("rejected image_path (empty) raw=%r", raw)
        raise HTTPException(400, "image_path must be a non-empty string")

    p = pathlib.PurePosixPath(raw.replace("\\", "/"))
    if ".." in p.parts:
        _log.info("rejected image_path (traversal) raw=%r", raw)
        raise HTTPException(400, "image_path must not contain '..'")

    candidate = pathlib.Path(raw)
    # Relative paths are resolved from the repository root so a client that
    # passes "cards/foo.jpg" lands inside CARDS_DIR, while "data/foo.json"
    # lands outside and is rejected. Absolute paths are used as-is.
    resolved = (
        candidate.resolve()
        if candidate.is_absolute()
        else (REPO_ROOT / candidate).resolve()
    )
    try:
        resolved.relative_to(CARDS_DIR)
    except ValueError:
        _log.info(
            "rejected image_path (outside allowlist) raw=%r resolved=%s allowlist=%s",
            raw, resolved, CARDS_DIR,
        )
        raise HTTPException(400, f"image_path must resolve within {CARDS_DIR.name}/")
    return resolved


def _serialize_hitl_field(h: phase_d.HITLField) -> dict:
    return {
        "dose_index": h.dose_index,
        "field_path": h.field_path,
        "reason": h.reason,
        "extracted": h.extracted.model_dump(mode="json"),
    }


def _set_nested_field(data: dict, field_path: str, new_field: dict | None) -> None:
    """Mutate `data` (a CardExtractionOutput dict) by setting the field
    at `field_path` to `new_field`. Raises ValueError on unknown path."""
    if m := _DOSE_PATH_RE.match(field_path):
        idx, attr = int(m.group(1)), m.group(2)
        data["extracted_doses"][idx][attr] = new_field
        return
    if m := _METADATA_PATH_RE.match(field_path):
        data["card_metadata"][m.group(1)] = new_field
        return
    raise ValueError(f"unknown field_path: {field_path}")


def _apply_corrections(
    auto_committed: CardExtractionOutput,
    hitl_queue: list[phase_d.HITLField],
    corrections: list[HITLCorrection],
) -> CardExtractionOutput:
    """Merge clinician corrections into the auto-committed extraction.
    Each corrected field is emitted with confidence 1.0 (physician-verified)."""
    queue_by_path = {h.field_path: h for h in hitl_queue}
    data = auto_committed.model_dump(mode="python")
    for c in corrections:
        hitl_entry = queue_by_path[c.field_path]  # caller validated membership
        if c.action == "edit":
            new_field: dict | None = {
                "value": c.corrected_value,
                "confidence": 1.0,
                "needs_review": False,
                "ambiguity_reason": None,
            }
        elif c.action == "keep":
            new_field = {
                "value": hitl_entry.extracted.value,
                "confidence": 1.0,
                "needs_review": False,
                "ambiguity_reason": None,
            }
        else:  # "skip"
            new_field = None
        _set_nested_field(data, c.field_path, new_field)
    return CardExtractionOutput.model_validate(data)


def _confirmed_to_dose_records(confirmed: CardExtractionOutput) -> list[DoseRecord]:
    """Unwrap .value from each FieldExtraction into the legacy DoseRecord shape
    the existing _stream_agent prompt-builder expects."""
    out: list[DoseRecord] = []
    for dose in confirmed.extracted_doses:
        if dose.transcribed_antigen is None or dose.date_administered is None:
            continue  # clinician skipped or field absent — drop from agent view
        if dose.transcribed_antigen.value is None or dose.date_administered.value is None:
            continue
        out.append(DoseRecord(
            vaccine_trade_name=dose.transcribed_antigen.value,
            date_given=dose.date_administered.value,
            source="vaccination card",
        ))
    return out


def _demo_fast_reconcile_enabled() -> bool:
    return os.environ.get("DEMO_FAST_RECONCILE", "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _canonical_demo_antigen(raw: str) -> str:
    key = raw.strip().lower()
    if "pentavalent" in key:
        return "Pentavalent"
    if "hepb" in key or "hepatitis b" in key:
        return "HepB"
    if key.startswith("opv"):
        return "OPV"
    if key.startswith("pcv") or "pneumococcal" in key:
        return "PCV"
    if "yellow fever" in key:
        return "YellowFever"
    if key in {"bcg", "opv", "ipv", "rotavirus", "mmr", "measles"}:
        return raw.strip()
    return raw.strip()


def _parse_card_dose_number(field: FieldExtraction | None) -> int | None:
    if field is None or field.value is None:
        return None
    try:
        return int(str(field.value).strip())
    except (TypeError, ValueError):
        return None


def _confirmed_to_phase_e_context_doses(confirmed: CardExtractionOutput) -> list[dict]:
    doses: list[dict] = []
    for dose in confirmed.extracted_doses:
        antigen = dose.transcribed_antigen.value if dose.transcribed_antigen else None
        date_given = dose.date_administered.value if dose.date_administered else None
        if not antigen or not date_given:
            continue
        doses.append({
            "antigen": _canonical_demo_antigen(antigen),
            "date_administered": date_given,
            "dose_number": _parse_card_dose_number(dose.dose_number_on_card),
        })
    return doses


def _dose_records_to_phase_e_context_doses(records: list[DoseRecord]) -> list[dict]:
    doses: list[dict] = []
    series_counts: dict[str, int] = {}
    for record in records:
        antigen = _canonical_demo_antigen(record.vaccine_trade_name)
        series_counts[antigen] = series_counts.get(antigen, 0) + 1
        doses.append({
            "antigen": antigen,
            "date_administered": record.date_given,
            "dose_number": series_counts[antigen],
        })
    return doses


def _serialize_validation_result(result) -> dict:
    return result.model_dump(mode="json")


def _serialize_recommendation(rec) -> dict:
    data = rec.model_dump(mode="json")
    return {
        "recommendation_id": data["recommendation_id"],
        "kind": data["kind"],
        "antigen": data["antigen"],
        "agent_rationale": data["agent_rationale"],
        "reasoning": data.get("reasoning"),
        "agent_confidence": data.get("agent_confidence"),
        "dose_number": data.get("dose_number"),
        "target_date": data.get("target_date"),
        "source_dose_indices": data.get("source_dose_indices", []),
    }


async def _stream_demo_fast_phase_e_from_doses(
    confirmed_doses: list[dict],
    child_dob: str,
    target_country: str,
) -> AsyncGenerator[bytes, None]:
    """Deterministic Phase E demo path.

    This is an output-boundary shortcut, not a replacement for agent reasoning:
    Phase D has already run, recommendations are derived only from confirmed
    rows plus the explicit Rotavirus gap, and Phase E still gates every
    actionable item through the deterministic rules engine.
    """
    from datetime import date

    from hathor.safety.phase_e import ClinicalContext, gate
    from hathor.schemas.recommendation import Recommendation

    yield _sse("agent_start", {
        "model": "deterministic-demo-fast",
        "tools": 0,
        "demo_fast": True,
    })
    yield _sse("assistant_text", {"text": "Evidence extracted."})
    recommendations: list[Recommendation] = []

    for idx, dose in enumerate(confirmed_doses):
        dose_number = dose.get("dose_number")
        antigen = dose.get("antigen", "")
        recommendations.append(Recommendation(
            recommendation_id=f"fast-dose-{idx + 1:03d}",
            kind="dose_verdict",
            antigen=antigen,
            dose_number=dose_number,
            agent_rationale=(
                f"{antigen} dose {dose_number} recorded on the card."
                if dose_number is not None
                else f"{antigen} dose recorded on the card."
            ),
            reasoning="Deterministic demo-fast reconciliation from confirmed Phase D rows.",
            agent_confidence=1.0,
            source_dose_indices=[idx],
        ))

    has_rotavirus = any(d.get("antigen") == "Rotavirus" for d in confirmed_doses)
    if not has_rotavirus:
        recommendations.append(Recommendation(
            recommendation_id="fast-rotavirus-review",
            kind="dose_verdict",
            antigen="Rotavirus",
            dose_number=1,
            agent_rationale="No confirmed rotavirus dose was found.",
            reasoning=(
                "Gap-mode recommendation created from confirmed rows so Phase E "
                "can evaluate the Rotavirus initiation window."
            ),
            agent_confidence=1.0,
            source_dose_indices=[],
        ))

    ctx = ClinicalContext(
        child_dob=date.fromisoformat(child_dob),
        target_country=target_country,
        source_country="Nigeria",
        confirmed_doses=confirmed_doses,
    )
    output = gate(recommendations, ctx)

    yield _sse("assistant_text", {"text": "Rules applied."})

    all_results = [
        *[_serialize_validation_result(r) for r in output.active],
        *[_serialize_validation_result(r) for r in output.superseded],
    ]
    rsession = RECONCILE_SESSIONS.create(recommendations=all_results)
    recs_by_id = {
        rec.recommendation_id: _serialize_recommendation(rec)
        for rec in recommendations
    }

    yield _sse(
        "phase_e_complete",
        {
            "session_id": rsession.session_id,
            "has_failures": output.has_failures,
            "has_override_required": output.has_override_required,
            "active_results": [
                _serialize_validation_result(r) for r in output.active
            ],
            "recommendations": recs_by_id,
            "override_endpoint": f"/session/{rsession.session_id}/override",
            "expires_at": rsession.expires_at.isoformat(),
        },
    )

    if output.has_failures or output.has_override_required:
        yield _sse("assistant_text", {"text": "Clinician action needed."})
    else:
        yield _sse("assistant_text", {"text": "Export package generated."})

    yield _sse("final_plan", {
        "markdown": (
            "## Reconciliation package\n\n"
            "Evidence extracted, rules applied, and clinician-review items "
            "prepared for Phase E resolution."
        )
    })
    yield _sse("run_complete", {
        "tool_call_count": 0,
        "model": "deterministic-demo-fast",
        "demo_fast": True,
    })


async def _stream_demo_fast_reconciliation(
    confirmed: CardExtractionOutput,
    child_dob: str,
    target_country: str,
) -> AsyncGenerator[bytes, None]:
    confirmed_doses = _confirmed_to_phase_e_context_doses(confirmed)
    async for chunk in _stream_demo_fast_phase_e_from_doses(
        confirmed_doses=confirmed_doses,
        child_dob=child_dob,
        target_country=target_country,
    ):
        yield chunk


def _build_prompt(req: ReconcileRequest) -> str:
    import datetime

    today = datetime.date.today().isoformat()
    doses_text = "\n".join(
        f"  - {d.vaccine_trade_name} — date given: {d.date_given}  (source: {d.source})"
        for d in req.given_doses
    )
    return (
        f"A family is relocating to {req.target_country}. Their child has the following "
        f"vaccination records:\n\n{doses_text}\n\n"
        f"Child date of birth : {req.child_dob}\n"
        f"Target country      : {req.target_country}\n"
        f"Today's date        : {today}\n\n"
        f"Please reconcile this child's vaccination history against the {req.target_country} "
        f"schedule and provide a complete catch-up plan."
    )


def _parse_tool_result_content(content: str | list | None) -> dict:
    """Extract a JSON-parseable dict from tool result content."""
    if content is None:
        return {}
    if isinstance(content, str):
        try:
            return json.loads(content)
        except (json.JSONDecodeError, ValueError):
            return {"text": content}
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                texts.append(item.get("text", ""))
        combined = "\n".join(texts)
        try:
            return json.loads(combined)
        except (json.JSONDecodeError, ValueError):
            return {"text": combined}
    return {}


async def _stream_agent(req: ReconcileRequest) -> AsyncGenerator[bytes, None]:
    """Run the agent and yield SSE-formatted event bytes."""
    active_model = req.model or MODEL
    # Emit agent_start immediately — before any setup — so the browser gets
    # a response within milliseconds of the request arriving.
    yield _sse("agent_start", {"model": active_model, "tools": len(HATHOR_TOOLS)})

    mcp_server = create_sdk_mcp_server(MCP_SERVER_NAME, tools=HATHOR_TOOLS)
    allowed_tools = [f"mcp__{MCP_SERVER_NAME}__{t.name}" for t in HATHOR_TOOLS]

    options = ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=active_model,
        mcp_servers={MCP_SERVER_NAME: mcp_server},
        allowed_tools=allowed_tools,
        thinking={"type": "enabled", "budget_tokens": 8000},
        permission_mode="bypassPermissions",
    )

    tool_index = 0
    tool_id_to_index: dict[str, int] = {}
    tool_id_to_name: dict[str, str] = {}
    final_plan_text: list[str] = []
    result_message: ResultMessage | None = None

    try:
        async with ClaudeSDKClient(options) as client:
            await client.query(_build_prompt(req))

            async for message in client.receive_messages():
                if isinstance(message, AssistantMessage):
                    has_tool_use = any(isinstance(b, ToolUseBlock) for b in message.content)

                    for block in message.content:
                        if isinstance(block, ThinkingBlock):
                            yield _sse("thinking", {"text": block.thinking})

                        elif isinstance(block, ToolUseBlock):
                            tool_index += 1
                            tool_id_to_index[block.id] = tool_index
                            tool_id_to_name[block.id] = block.name
                            yield _sse(
                                "tool_use",
                                {
                                    "index": tool_index,
                                    "name": block.name,
                                    "input": block.input or {},
                                },
                            )

                        elif isinstance(block, TextBlock):
                            if has_tool_use:
                                yield _sse("assistant_text", {"text": block.text})
                            else:
                                final_plan_text.append(block.text)
                                yield _sse("assistant_text", {"text": block.text})

                elif isinstance(message, UserMessage):
                    # Tool results are returned as UserMessage with ToolResultBlock content
                    content = message.content
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, ToolResultBlock):
                                idx = tool_id_to_index.get(block.tool_use_id, 0)
                                tool_name = tool_id_to_name.get(block.tool_use_id, "")
                                result_data = _parse_tool_result_content(block.content)
                                yield _sse(
                                    "tool_result",
                                    {
                                        "index": idx,
                                        "tool_use_id": block.tool_use_id,
                                        "result": result_data,
                                        "is_error": bool(block.is_error),
                                    },
                                )
                                # When the agent completes Phase E, create a reconcile
                                # session so the clinician can submit overrides against
                                # `override_required` / `fail` results.
                                if (
                                    tool_name == f"mcp__{MCP_SERVER_NAME}__emit_recommendations"
                                    and not bool(block.is_error)
                                    and isinstance(result_data, dict)
                                    and "active_results" in result_data
                                ):
                                    rsession = RECONCILE_SESSIONS.create(
                                        recommendations=[
                                            *result_data.get("active_results", []),
                                            *result_data.get("superseded_results", []),
                                        ],
                                    )
                                    yield _sse(
                                        "phase_e_complete",
                                        {
                                            "session_id": rsession.session_id,
                                            "has_failures": result_data.get("has_failures", False),
                                            "has_override_required": result_data.get("has_override_required", False),
                                            "active_results": result_data.get("active_results", []),
                                            "override_endpoint": f"/session/{rsession.session_id}/override",
                                            "expires_at": rsession.expires_at.isoformat(),
                                        },
                                    )

                elif isinstance(message, ResultMessage):
                    result_message = message
                    break

    except Exception as exc:
        yield _sse("error", {"message": str(exc)})
        return

    if final_plan_text:
        yield _sse("final_plan", {"markdown": "\n".join(final_plan_text)})

    stats: dict = {"tool_call_count": tool_index}
    if result_message:
        if result_message.usage:
            u = result_message.usage
            stats["input_tokens"] = u.get("input_tokens")
            stats["output_tokens"] = u.get("output_tokens")
            stats["cache_read_tokens"] = u.get("cache_read_input_tokens")
        if result_message.total_cost_usd is not None:
            stats["cost_usd"] = result_message.total_cost_usd

    yield _sse("run_complete", stats)


@app.post("/reconcile-stream")
async def reconcile_stream(req: ReconcileRequest) -> StreamingResponse:
    async def event_generator() -> AsyncGenerator[bytes, None]:
        if _demo_fast_reconcile_enabled():
            confirmed_doses = _dose_records_to_phase_e_context_doses(req.given_doses)
            async for chunk in _stream_demo_fast_phase_e_from_doses(
                confirmed_doses=confirmed_doses,
                child_dob=req.child_dob,
                target_country=req.target_country,
            ):
                yield chunk
        else:
            async for chunk in _stream_agent(req):
                yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


async def _card_reconciliation_stream(
    validated_path: pathlib.Path, req: ReconcileCardRequest
) -> AsyncGenerator[bytes, None]:
    """Actual event stream for /reconcile/card — extracted from the
    endpoint function so tests can drive it directly. Validation lives in
    the endpoint (so HTTP 400 is emitted before the generator starts)."""
    try:
        extraction = build_stub_output(str(validated_path))
    except Exception as exc:
        yield _sse("error", {"message": f"extraction failed: {exc}"})
        return

    result = phase_d.gate(extraction)

    if result.requires_review:
        session = SESSIONS.create(result.auto_committed, result.hitl_queue)
        yield _sse(
            "hitl_required",
            {
                "session_id": session.session_id,
                "hitl_queue": [_serialize_hitl_field(h) for h in result.hitl_queue],
                "resume_endpoint": f"/reconcile/hitl/{session.session_id}/corrections",
                "expires_at": session.expires_at.isoformat(),
            },
        )

        remaining = (session.expires_at - _dt.datetime.now(_dt.timezone.utc)).total_seconds()
        try:
            await asyncio.wait_for(
                session.corrections_event.wait(), timeout=max(remaining, 0.0)
            )
        except asyncio.TimeoutError:
            yield _sse("hitl_timeout", {"session_id": session.session_id})
            return

        try:
            confirmed = _apply_corrections(
                result.auto_committed, result.hitl_queue, session.corrections or []
            )
        except Exception as exc:
            yield _sse("error", {"message": f"correction merge failed: {exc}"})
            return
        finally:
            SESSIONS.drop(session.session_id)
    else:
        confirmed = result.auto_committed

    child_dob = (
        confirmed.card_metadata.patient_dob.value
        if (confirmed.card_metadata.patient_dob
            and confirmed.card_metadata.patient_dob.value)
        else req.child_dob
    )
    if _demo_fast_reconcile_enabled():
        async for chunk in _stream_demo_fast_reconciliation(
            confirmed=confirmed,
            child_dob=child_dob,
            target_country=req.target_country,
        ):
            yield chunk
        return

    delegated = ReconcileRequest(
        child_dob=child_dob,
        target_country=req.target_country,
        given_doses=_confirmed_to_dose_records(confirmed),
        model=req.model,
    )
    async for chunk in _stream_agent(delegated):
        yield chunk


@app.post("/reconcile/card")
async def reconcile_card(req: ReconcileCardRequest) -> StreamingResponse:
    """Card-first reconciliation: extract → Phase D → (HITL) → agent.

    Emits `hitl_required` as an SSE event if Phase D routes any field to
    review, and holds the connection until a companion POST to
    `/reconcile/hitl/{session_id}/corrections` arrives (or the session TTL
    expires, in which case `hitl_timeout` is emitted and the stream closes).
    """
    validated_path = _validate_image_path(req.image_path)
    return StreamingResponse(
        _card_reconciliation_stream(validated_path, req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/reconcile/hitl/{session_id}/corrections")
async def submit_hitl_corrections(
    session_id: str, req: HITLCorrectionsRequest
) -> dict:
    """Receive clinician corrections for a pending HITL session and wake
    the paused SSE generator."""
    session: HITLSession | None = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, f"Unknown session_id: {session_id}")
    if SESSIONS.is_expired(session):
        raise HTTPException(410, f"Session expired: {session_id}")
    if session.corrections_event.is_set():
        raise HTTPException(
            409, f"Corrections already submitted for session {session_id}"
        )

    queue_paths = {h.field_path for h in session.hitl_queue}
    submitted_paths = [c.field_path for c in req.corrections]

    # Every queue entry must be addressed exactly once; no extras.
    if len(submitted_paths) != len(set(submitted_paths)):
        raise HTTPException(400, "duplicate field_path in corrections")
    if set(submitted_paths) != queue_paths:
        unexpected = sorted(set(submitted_paths) - queue_paths)
        missing = sorted(queue_paths - set(submitted_paths))
        parts = []
        if unexpected:
            parts.append(f"unexpected fields: {unexpected}")
        if missing:
            parts.append(f"missing fields: {missing}")
        raise HTTPException(400, "; ".join(parts))

    for c in req.corrections:
        if c.action == "edit" and not (c.corrected_value and c.corrected_value.strip()):
            raise HTTPException(
                400,
                f"action=edit requires non-empty corrected_value for {c.field_path}",
            )
        if c.action in ("keep", "skip") and c.corrected_value is not None:
            raise HTTPException(
                400,
                f"action={c.action} must not include corrected_value for {c.field_path}",
            )

    SESSIONS.resume(session_id, list(req.corrections))
    return {"status": "accepted", "session_id": session_id}


@app.post("/session/{session_id}/override")
async def submit_override(session_id: str, req: OverrideSubmissionRequest) -> dict:
    """Record a clinician override against a Phase E ValidationResult.

    Writes the override to the reconcile session state and to the FHIR
    Provenance audit log. Both the justification code (when structured) and
    the free-text clinical reason are preserved.
    """
    from hathor.fhir.provenance import write_override_provenance
    from hathor.server_sessions import OverrideRecord

    session = RECONCILE_SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(404, f"Unknown session_id: {session_id}")
    if RECONCILE_SESSIONS.is_expired(session):
        raise HTTPException(410, f"Session expired: {session_id}")

    # Per-severity payload validation.
    if req.severity == "fail":
        if not (req.clinical_reason_text and req.clinical_reason_text.strip()):
            raise HTTPException(
                400, "severity=fail requires non-empty clinical_reason_text"
            )
        if req.justification_code is not None:
            raise HTTPException(
                400, "severity=fail must not include justification_code"
            )
    else:  # override_required
        if not req.justification_code:
            raise HTTPException(
                400, "severity=override_required requires justification_code"
            )
        from hathor.schemas.recommendation import OVERRIDE_JUSTIFICATION_CODES
        if req.justification_code not in OVERRIDE_JUSTIFICATION_CODES:
            raise HTTPException(
                400,
                f"justification_code must be one of "
                f"{sorted(OVERRIDE_JUSTIFICATION_CODES)}; got {req.justification_code!r}",
            )

    # Locate the matching recommendation so Provenance can cite its rule_rationale
    # and the agent's original proposal.
    matching = next(
        (
            r for r in session.recommendations
            if r.get("recommendation_id") == req.recommendation_id
               and r.get("rule_id") == req.rule_id
        ),
        None,
    )
    if matching is None:
        raise HTTPException(
            404,
            f"No matching recommendation found for recommendation_id={req.recommendation_id!r}"
            f" rule_id={req.rule_id!r}",
        )

    now = _dt.datetime.now(_dt.timezone.utc)
    record = OverrideRecord(
        recommendation_id=req.recommendation_id,
        rule_id=req.rule_id,
        justification_code=req.justification_code,
        clinical_reason_text=req.clinical_reason_text,
        timestamp=now,
        clinician_id=session.clinician_id,
    )
    RECONCILE_SESSIONS.append_override(session_id, record)

    provenance_id = write_override_provenance(
        override=record,
        validation_result=matching,
    )

    return {
        "status": "accepted",
        "session_id": session_id,
        "provenance_id": provenance_id,
    }


@app.post("/validate-schedule")
async def validate_schedule(req: ValidateScheduleRequest) -> list[dict]:
    """Thin HTTP wrapper over the validate_dose engine.

    Per input record, computes age_at_dose_days = date - child_dob and invokes
    the existing validate_dose tool, returning the engine's native per-record
    output unchanged. target_country defaults to "Egypt" (Phase 1 destination).
    """
    from hathor.tools.dose_validation import validate_dose

    try:
        dob = _dt.date.fromisoformat(req.child_dob)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"invalid child_dob: {req.child_dob!r}")

    results: list[dict] = []
    for record in req.records:
        try:
            given = _dt.date.fromisoformat(record.date)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"invalid date: {record.date!r}")
        args = {
            "antigen": record.antigen,
            "dose_number": record.dose_number,
            "dose_kind": record.dose_kind,
            "age_at_dose_days": (given - dob).days,
            "target_country": "Egypt",
            "prior_dose_age_days": record.prior_dose_age_days,
        }
        envelope = await validate_dose.handler(args)
        results.append(json.loads(envelope["content"][0]["text"]))
    return results


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": MODEL}
