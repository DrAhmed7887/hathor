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
from hathor.server_sessions import SESSIONS, HITLSession
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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": MODEL}
