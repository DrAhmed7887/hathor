"""Hathor FastAPI server — single SSE endpoint for the reconciliation agent.

POST /reconcile-stream
  Request:  JSON body with child_dob, target_country, given_doses
  Response: text/event-stream — events stream as the agent reasons

Event types emitted:
  agent_start   — once at start: model name, tool count
  thinking      — each thinking block
  tool_use      — each tool call (index, name, input)
  tool_result   — each tool result (index, content summary)
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
    ToolUseBlock,
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


def _sse(event_type: str, data: dict) -> str:
    """Format a single SSE event string."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


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


async def _stream_agent(req: ReconcileRequest) -> AsyncGenerator[str, None]:
    """Run the agent and yield SSE-formatted event strings."""
    mcp_server = create_sdk_mcp_server(MCP_SERVER_NAME, tools=HATHOR_TOOLS)
    allowed_tools = [f"mcp__{MCP_SERVER_NAME}__{t.name}" for t in HATHOR_TOOLS]

    options = ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=MODEL,
        mcp_servers={MCP_SERVER_NAME: mcp_server},
        allowed_tools=allowed_tools,
        thinking={"type": "enabled", "budget_tokens": 8000},
        permission_mode="bypassPermissions",
    )

    yield _sse("agent_start", {"model": MODEL, "tools": len(HATHOR_TOOLS)})

    tool_index = 0
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

                elif isinstance(message, ResultMessage):
                    # Emit tool results from the result message if available
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
    async def event_generator() -> AsyncGenerator[str, None]:
        async for chunk in _stream_agent(req):
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": MODEL}
