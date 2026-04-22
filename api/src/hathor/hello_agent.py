"""Smoke test: verify Claude Agent SDK + Opus 4.7 (or Sonnet) can run end-to-end."""

import os
import sys

import anyio
from claude_agent_sdk import query
from claude_agent_sdk.types import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
)

SYSTEM_PROMPT = (
    "You are Hathor, a clinical reasoning agent for vaccination reconciliation. "
    "You are being smoke-tested — confirm you can reason and describe what tools "
    "you would need."
)

USER_PROMPT = (
    "Briefly describe what you would need to reconcile a child's vaccination history "
    "given a card image, date of birth, and a target country's schedule. "
    "Think step by step about the tools you would need."
)


async def main() -> None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY is not set in the environment.", file=sys.stderr)
        sys.exit(1)
    print(f"API key loaded: {api_key[:8]}...")

    model = os.environ.get("HATHOR_MODEL", "claude-opus-4-7")
    print(f"Model: {model}")
    print("-" * 60)

    options = ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=model,
        thinking={"type": "enabled", "budget_tokens": 2000},
        permission_mode="bypassPermissions",
    )

    async for message in query(prompt=USER_PROMPT, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, ThinkingBlock):
                    print("\n[THINKING]")
                    print(block.thinking)
                    print("[/THINKING]")
                elif isinstance(block, TextBlock):
                    print("\n[TEXT]")
                    print(block.text)
                    print("[/TEXT]")
                elif isinstance(block, ToolUseBlock):
                    print(f"\n[TOOL USE] {block.name}")
                    print(f"  input: {block.input}")
        elif isinstance(message, SystemMessage):
            pass  # internal SDK bookkeeping
        elif isinstance(message, ResultMessage):
            print("\n" + "=" * 60)
            print("USAGE SUMMARY")
            print("=" * 60)
            if message.usage:
                u = message.usage
                print(f"  Input tokens:              {u.get('input_tokens', 'n/a')}")
                print(f"  Output tokens:             {u.get('output_tokens', 'n/a')}")
                print(f"  Cache creation tokens:     {u.get('cache_creation_input_tokens', 0)}")
                print(f"  Cache read tokens:         {u.get('cache_read_input_tokens', 0)}")
            if message.total_cost_usd is not None:
                print(f"  Estimated cost (USD):      ${message.total_cost_usd:.4f}")
            print(f"  Duration:                  {message.duration_ms}ms")
            print(f"  Turns:                     {message.num_turns}")


if __name__ == "__main__":
    anyio.run(main)
