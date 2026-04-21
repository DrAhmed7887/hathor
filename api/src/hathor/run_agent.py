"""Hathor Day 2 end-to-end agent run.

Usage:
    uv run python -m hathor.run_agent

The agent receives the TEST_SCENARIO prompt and autonomously decides which
tools to call and in what order. No pipeline is hardcoded here.
"""

import json
import os

import anyio

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

# DOB 2024-06-15; today 2025-04-21 → child is ~10 months old
# Hexyon ×3 (Egyptian hexavalent = DTaP+HepB+Hib+IPV) + MMR ×1
TEST_SCENARIO = """\
A family is relocating from Egypt to Germany. Their child has the following entries \
on an Egyptian vaccination card:

  - Hexyon dose 1 — date given: 2024-08-15  (child age ~2 months)
  - Hexyon dose 2 — date given: 2024-10-15  (child age ~4 months)
  - Hexyon dose 3 — date given: 2024-12-15  (child age ~6 months)
  - MMR dose 1    — date given: 2025-06-15  (child age ~12 months)

Child date of birth : 2024-06-15
Card image path     : /cards/test_egypt_child.jpg
Target country      : Germany
Today's date        : 2025-04-21

Please reconcile this child's vaccination history against the German STIKO schedule \
and provide a complete catch-up plan.\
"""


async def main() -> None:
    print(f"{'='*70}")
    print(f"  Hathor — Vaccination Reconciliation Agent")
    print(f"  Model  : {MODEL}")
    print(f"  Tools  : {len(HATHOR_TOOLS)}")
    print(f"{'='*70}\n")

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

    # Telemetry accumulators
    tool_calls_ordered: list[str] = []
    final_text_blocks: list[str] = []
    result_message: ResultMessage | None = None

    async with ClaudeSDKClient(options) as client:
        await client.query(TEST_SCENARIO)

        async for message in client.receive_messages():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, ThinkingBlock):
                        print("\n┌─ THINKING ─────────────────────────────────────────────────┐")
                        for line in block.thinking.splitlines():
                            print(f"│  {line}")
                        print("└────────────────────────────────────────────────────────────┘\n")

                    elif isinstance(block, ToolUseBlock):
                        tool_calls_ordered.append(block.name)
                        print(f"▶ Tool [{len(tool_calls_ordered):02d}] {block.name}")
                        if block.input:
                            pretty = json.dumps(block.input, indent=4)
                            for line in pretty.splitlines():
                                print(f"         {line}")
                        print()

                    elif isinstance(block, TextBlock):
                        print(block.text)
                        final_text_blocks.append(block.text)

            elif isinstance(message, ResultMessage):
                result_message = message
                break

    # ── End-of-run summary ────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print("  RUN SUMMARY")
    print(f"{'='*70}")
    print(f"  Model           : {MODEL}")
    print(f"  Tool calls      : {len(tool_calls_ordered)}")
    print(f"  Call order      :")
    for i, name in enumerate(tool_calls_ordered, 1):
        print(f"    {i:02d}. {name}")

    if result_message:
        if result_message.stop_reason:
            print(f"  Stop reason     : {result_message.stop_reason}")
        if result_message.usage:
            u = result_message.usage
            print(f"  Input tokens    : {u.get('input_tokens', '—')}")
            print(f"  Output tokens   : {u.get('output_tokens', '—')}")
            cache_read = u.get('cache_read_input_tokens')
            if cache_read:
                print(f"  Cache read tkns : {cache_read}")
        if result_message.total_cost_usd is not None:
            print(f"  Cost (USD)      : ${result_message.total_cost_usd:.4f}")

    print(f"{'='*70}")

    if final_text_blocks:
        print("\n── FINAL PLAN TEXT ──────────────────────────────────────────────────")
        print("\n".join(final_text_blocks))
        print("─────────────────────────────────────────────────────────────────────")


if __name__ == "__main__":
    anyio.run(main)
