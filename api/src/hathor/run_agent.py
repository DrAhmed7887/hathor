"""Hathor agent runner.

Usage:
    uv run python -m hathor.run_agent                    # default test scenario
    uv run python -m hathor.run_agent --flagship         # flagship demo scenario
    uv run python -m hathor.run_agent --flagship --compare  # run Sonnet + Opus, save comparison

The agent receives the prompt and autonomously decides which tools to call and in what order.
No pipeline is hardcoded here.
"""

import argparse
import datetime
import json
import os
import pathlib

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

DEFAULT_MODEL = os.environ.get("HATHOR_MODEL", "claude-opus-4-7")
OPUS_MODEL = "claude-opus-4-7"
MCP_SERVER_NAME = "hathor"

EVAL_DIR = pathlib.Path(__file__).parents[4] / "evaluation" / "flagship_africa"


def _build_default_prompt() -> str:
    from hathor.flagship_scenario import FLAGSHIP, build_agent_prompt
    return build_agent_prompt(FLAGSHIP)


async def run_once(prompt: str, model: str) -> tuple[list[str], str, ResultMessage | None]:
    """Run the agent once. Returns (tool_calls_ordered, final_text, result_message)."""
    mcp_server = create_sdk_mcp_server(MCP_SERVER_NAME, tools=HATHOR_TOOLS)
    allowed_tools = [f"mcp__{MCP_SERVER_NAME}__{t.name}" for t in HATHOR_TOOLS]

    options = ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=model,
        mcp_servers={MCP_SERVER_NAME: mcp_server},
        allowed_tools=allowed_tools,
        thinking={"type": "enabled", "budget_tokens": 8000},
        permission_mode="bypassPermissions",
    )

    tool_calls_ordered: list[str] = []
    final_text_blocks: list[str] = []
    result_message: ResultMessage | None = None

    async with ClaudeSDKClient(options) as client:
        await client.query(prompt)

        async for message in client.receive_messages():
            if isinstance(message, AssistantMessage):
                has_tool_use = any(isinstance(b, ToolUseBlock) for b in message.content)

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
                        if not has_tool_use:
                            final_text_blocks.append(block.text)

            elif isinstance(message, ResultMessage):
                result_message = message
                break

    return tool_calls_ordered, "\n".join(final_text_blocks), result_message


def _print_summary(model: str, tool_calls: list[str], result_message: ResultMessage | None) -> None:
    print(f"\n{'='*70}")
    print("  RUN SUMMARY")
    print(f"{'='*70}")
    print(f"  Model           : {model}")
    print(f"  Tool calls      : {len(tool_calls)}")
    print(f"  Call order      :")
    for i, name in enumerate(tool_calls, 1):
        print(f"    {i:02d}. {name}")

    if result_message:
        if result_message.stop_reason:
            print(f"  Stop reason     : {result_message.stop_reason}")
        if result_message.usage:
            u = result_message.usage
            print(f"  Input tokens    : {u.get('input_tokens', '—')}")
            print(f"  Output tokens   : {u.get('output_tokens', '—')}")
            cache_read = u.get("cache_read_input_tokens")
            if cache_read:
                print(f"  Cache read tkns : {cache_read}")
        if result_message.total_cost_usd is not None:
            print(f"  Cost (USD)      : ${result_message.total_cost_usd:.4f}")

    print(f"{'='*70}")


def _make_run_md(model: str, tool_calls: list[str], final_text: str, result_message: ResultMessage | None) -> str:
    today = datetime.date.today().isoformat()
    lines = [
        f"# Hathor Flagship Run",
        f"",
        f"- **Date:** {today}",
        f"- **Model:** {model}",
        f"- **Tool calls:** {len(tool_calls)}",
    ]
    if result_message and result_message.total_cost_usd is not None:
        lines.append(f"- **Cost (USD):** ${result_message.total_cost_usd:.4f}")
    if result_message and result_message.usage:
        u = result_message.usage
        lines.append(f"- **Input tokens:** {u.get('input_tokens', '—')}")
        lines.append(f"- **Output tokens:** {u.get('output_tokens', '—')}")
    lines += ["", "## Tool call sequence", ""]
    for i, name in enumerate(tool_calls, 1):
        lines.append(f"{i:02d}. `{name}`")
    lines += ["", "## Final plan", "", final_text]
    return "\n".join(lines)


def _make_comparison_md(
    sonnet_calls: list[str],
    sonnet_text: str,
    sonnet_result: ResultMessage | None,
    opus_calls: list[str],
    opus_text: str,
    opus_result: ResultMessage | None,
) -> str:
    today = datetime.date.today().isoformat()

    def cost(r: ResultMessage | None) -> str:
        if r and r.total_cost_usd is not None:
            return f"${r.total_cost_usd:.4f}"
        return "—"

    lines = [
        f"# Hathor Flagship — Latest Comparison",
        f"",
        f"Generated: {today}",
        f"",
        f"| | Sonnet 4.6 | Opus 4.7 |",
        f"|---|---|---|",
        f"| Tool calls | {len(sonnet_calls)} | {len(opus_calls)} |",
        f"| Cost (USD) | {cost(sonnet_result)} | {cost(opus_result)} |",
        f"",
        f"## Sonnet 4.6 — Final plan",
        f"",
        sonnet_text,
        f"",
        f"---",
        f"",
        f"## Opus 4.7 — Final plan",
        f"",
        opus_text,
    ]
    return "\n".join(lines)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Hathor agent runner")
    parser.add_argument(
        "--flagship",
        action="store_true",
        help="Use the flagship Nigeria→Egypt demo scenario",
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Run Sonnet then Opus and save comparison (requires --flagship)",
    )
    args = parser.parse_args()

    if args.flagship:
        from hathor.flagship_scenario import FLAGSHIP, build_agent_prompt
        prompt = build_agent_prompt(FLAGSHIP)
        print(f"\n  Scenario : {FLAGSHIP.scenario_title}")
    else:
        prompt = _build_default_prompt()

    if args.compare and not args.flagship:
        parser.error("--compare requires --flagship")

    if args.compare:
        # ── Sonnet run ────────────────────────────────────────────────────────
        print(f"{'='*70}")
        print(f"  Hathor — FLAGSHIP COMPARISON  [1/2 Sonnet 4.6]")
        print(f"  Tools  : {len(HATHOR_TOOLS)}")
        print(f"{'='*70}\n")

        sonnet_calls, sonnet_text, sonnet_result = await run_once(prompt, "claude-sonnet-4-6")
        _print_summary("claude-sonnet-4-6", sonnet_calls, sonnet_result)

        # ── Opus run ──────────────────────────────────────────────────────────
        print(f"\n{'='*70}")
        print(f"  Hathor — FLAGSHIP COMPARISON  [2/2 Opus 4.7]")
        print(f"  Tools  : {len(HATHOR_TOOLS)}")
        print(f"{'='*70}\n")

        opus_calls, opus_text, opus_result = await run_once(prompt, OPUS_MODEL)
        _print_summary(OPUS_MODEL, opus_calls, opus_result)

        # ── Write outputs ──────────────────────────────────────────────────────
        EVAL_DIR.mkdir(parents=True, exist_ok=True)
        (EVAL_DIR / "latest_sonnet.md").write_text(_make_run_md("claude-sonnet-4-6", sonnet_calls, sonnet_text, sonnet_result))
        (EVAL_DIR / "latest_opus.md").write_text(_make_run_md(OPUS_MODEL, opus_calls, opus_text, opus_result))
        (EVAL_DIR / "latest_comparison.md").write_text(
            _make_comparison_md(sonnet_calls, sonnet_text, sonnet_result, opus_calls, opus_text, opus_result)
        )
        print(f"\n  Saved: evaluation/flagship_africa/latest_sonnet.md")
        print(f"  Saved: evaluation/flagship_africa/latest_opus.md")
        print(f"  Saved: evaluation/flagship_africa/latest_comparison.md")

    else:
        model = DEFAULT_MODEL
        print(f"{'='*70}")
        print(f"  Hathor — Vaccination Reconciliation Agent")
        print(f"  Model  : {model}")
        print(f"  Tools  : {len(HATHOR_TOOLS)}")
        print(f"{'='*70}\n")

        tool_calls, final_text, result_message = await run_once(prompt, model)
        _print_summary(model, tool_calls, result_message)

        if final_text:
            print("\n── FINAL PLAN TEXT ──────────────────────────────────────────────────")
            print(final_text)
            print("─────────────────────────────────────────────────────────────────────")


if __name__ == "__main__":
    anyio.run(main)
