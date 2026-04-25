"""Shared types + helpers for parallel specialist sub-agents.

Each specialist returns a :class:`SpecialistVerdict` — a uniform structured
shape so the main agent can iterate the verdicts list without per-specialist
parsing. Verdicts carry an explicit ``severity`` so the main agent can
prioritise without re-reasoning (e.g. ``critical`` issues surface above
``info``).
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Literal, TypedDict

from anthropic import AsyncAnthropic

_log = logging.getLogger("hathor.specialists")

# Default model + caps for any specialist that doesn't override. Sonnet 4.6
# is fast + cheap relative to Opus and is appropriate for focused, narrow
# clinical sub-questions.
DEFAULT_MODEL = os.environ.get("HATHOR_SPECIALIST_MODEL") or "claude-sonnet-4-6"
# 120s ceiling: specialists run in parallel so their wall-clock floor is
# bound by the slowest one — under-budgeting the timeout silently kills
# the whole pattern. The attending physician's prompt is long and Sonnet's
# completions on it can run 60-90s. 120s gives headroom without being
# unbounded; tune via env if real-world calls run longer.
DEFAULT_TIMEOUT = float(os.environ.get("HATHOR_SPECIALIST_TIMEOUT", "120"))
DEFAULT_MAX_TOKENS = int(os.environ.get("HATHOR_SPECIALIST_MAX_TOKENS", "4096"))

Severity = Literal["info", "warning", "critical", "error"]
"""Verdict severity. ``critical`` = clinically actionable issue the main
agent must address; ``warning`` = worth noting; ``info`` = context;
``error`` = the specialist itself failed (returned only inside
``return_exceptions=True`` results, not by the specialist itself)."""


class Issue(TypedDict, total=False):
    """One specific finding from a specialist. Multiple issues can be
    emitted per specialist call — one for each distinct concern."""

    code: str  # short identifier, e.g. "MEASLES_MONOVALENT_NO_MMR"
    severity: Severity
    antigen: str | None  # the antigen this concerns, if any
    dose_indices: list[int]  # indices into extracted_doses this references
    summary: str  # one-line summary for the clinician
    detail: str  # fuller explanation
    suggested_action: str | None  # what the main agent should do about it


class SpecialistVerdict(TypedDict):
    """Uniform output shape across all specialists."""

    specialist: str  # specialist name (e.g. "attending_physician")
    model: str  # model used (e.g. "claude-sonnet-4-6")
    elapsed_ms: float  # wall-clock duration of this specialist
    issues: list[Issue]  # findings, in any order
    summary: str  # one-paragraph overall summary for the main agent
    error: str | None  # populated only if the specialist itself failed


# Match a ```json ... ``` block ANYWHERE in the response, not anchored
# to start/end. Sonnet sometimes emits prose after the closing fence
# despite "raw JSON only" instructions; the anchored form silently
# fails on those cases.
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n(.*?)\n```", re.DOTALL)


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    m = _JSON_FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    # No fences — assume the whole response is JSON. If the model emitted
    # leading prose, fall back to slicing from the first { to the last }.
    if text.startswith("{"):
        return text
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        return text[first : last + 1]
    return text


async def run_structured_call(
    *,
    specialist_name: str,
    system_prompt: str,
    user_message: str,
    model: str | None = None,
) -> dict:
    """Run a single Anthropic Messages call and return parsed JSON.

    Wraps the model invocation with timing + JSON-fence stripping + clear
    error handling. Specialists call this rather than touching the SDK
    directly so the call shape (and timing log format) is uniform.

    Returns the parsed JSON dict. Raises on JSON parse failure — callers
    catch and convert to a SpecialistVerdict with severity="error".
    """
    active_model = model or DEFAULT_MODEL
    t_start = time.perf_counter()

    client = AsyncAnthropic()
    message = await client.messages.create(
        model=active_model,
        max_tokens=DEFAULT_MAX_TOKENS,
        timeout=DEFAULT_TIMEOUT,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    text = "".join(
        getattr(block, "text", "")
        for block in message.content
        if getattr(block, "type", None) == "text"
    )
    body = _strip_json_fence(text)
    elapsed_ms = (time.perf_counter() - t_start) * 1000
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        _log.error(
            "specialist=%s returned non-JSON output: %r",
            specialist_name,
            text[:500],
        )
        raise ValueError(
            f"Specialist {specialist_name} returned non-JSON: {exc}. "
            f"First 200 chars: {text[:200]!r}"
        ) from exc

    parsed["_elapsed_ms"] = elapsed_ms
    parsed["_model"] = active_model
    _log.info(
        "specialist=%s elapsed_ms=%.0f model=%s issues=%d",
        specialist_name,
        elapsed_ms,
        active_model,
        len(parsed.get("issues", [])),
    )
    return parsed
