"""Hathor FastAPI server — single SSE endpoint for the reconciliation agent.

POST /reconcile-stream
  Request:  JSON body with child_dob, target_country, given_doses
  Response: text/event-stream — events stream as the agent reasons

Event types emitted:
  agent_start   — once at start: model name, tool count
  thinking      — each thinking block
  tool_use      — each tool call (index, name, input)
  tool_result   — each tool result (index, is_error, result JSON)
  assistant_text — intermediate text blocks (with tool calls)
  final_plan    — the terminal report (no tool calls in that message)
  run_complete  — run stats
  error         — any exception
"""

import json
import os
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

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
from hathor.tools import HATHOR_TOOLS

MODEL = os.environ.get("HATHOR_MODEL", "claude-sonnet-4-6")
MCP_SERVER_NAME = "hathor"

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
    target_country: str = "Germany"
    given_doses: list[DoseRecord]
    model: str | None = None


def _sse(event_type: str, data: dict) -> bytes:
    """Format a single SSE event as UTF-8 bytes."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n".encode()


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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": MODEL}
