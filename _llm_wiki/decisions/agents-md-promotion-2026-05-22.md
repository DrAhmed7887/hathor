# Decision — Root `AGENTS.md` cleaned and promoted to tracked canonical (2026-05-22)

**Status:** resolved. Preserved snapshot.

## Decision

`/Users/ahmedzayed/projects/hathor/AGENTS.md` is **tracked as of
2026-05-22** at commit `eea3027 docs: add general agent
instructions`. It is the canonical rules file for general
coding-agent sessions (Codex and any non-Claude agent) on this
repository.

Earlier, it was untracked and contained template-derived fake model
strings (`Codex-opus-4-7`, `Codex-sonnet-4-6`) inherited from a
mechanical mirror of `CLAUDE.md`. Those strings were removed before
the file was tracked. The promoted file now uses a generic **"Model
Guidance"** section that defers model selection to whatever the
operator/tool configures, with `HATHOR_MODEL` as the env-var
override.

## What was actually committed

The cleaned `AGENTS.md` keeps the structural and clinical rules of
`CLAUDE.md` intact:

- Project scope and Phase 1 / Phase 2 framing.
- Scope-discipline rule ("default answer is no").
- No-hardcoded-pipeline architectural rule (worded as "the agent
  decides which tools to call" rather than "the Claude model
  decides").
- Two-safety-loops design (Phase D vision, Phase E rules engine),
  including clinician final authority and FHIR Provenance logging.
- Tool granularity principle.
- Secrets rules.
- "Before Large Changes" gate.
- Repository layout.
- Next 16 deltas relevant to the HATHOR build.

What it changes from `CLAUDE.md`:

- Audience: "general-purpose coding agents" instead of "Claude Code".
- Model section: generic "Model Guidance" (operator/tool configures;
  repo safety rules outrank model-specific assumptions) instead of
  `claude-opus-4-7` / `claude-sonnet-4-6` defaults.
- Pipeline rule wording: "The agent decides…" rather than "The
  Claude model decides…".

## Operating consequences for agents

- Both `CLAUDE.md` and `AGENTS.md` are tracked, canonical rule files.
  Claude Code reads `CLAUDE.md`; Codex and other general agents read
  `AGENTS.md`.
- The wiki is the durable memory across both; it does **not** declare
  a universal default model.
- The two files are intended to stay in sync. If a future change
  edits `CLAUDE.md` but not `AGENTS.md` (or vice versa), the wiki
  drifts and any agent reviewing it should **flag the drift to
  Ahmed** rather than silently reconciling.
- Per the wiki update policy, this decision file is a preserved
  snapshot. To change the decision, write a new dated file in
  `decisions/` and link it from `index.md`.

## What did **not** change in this resolution

- The unrelated uncommitted work in `web/` (passport feature,
  Remotion compositions, `package.json` deltas) was not touched.
- No source code was modified.
- `web/AGENTS.md` (the tracked frontend rules file) was not touched.
- Project-local `.claude/` is still **not an active authority** for
  this wiki — its status is independent of root `AGENTS.md`.

## Pointers

- Tracked file: `/Users/ahmedzayed/projects/hathor/AGENTS.md`
- Promotion commit: `eea3027 docs: add general agent instructions`
- Reconciliation commit: this wiki update (the commit that introduces
  this file)
- Sibling rule file: `/Users/ahmedzayed/projects/hathor/CLAUDE.md`
- Frontend rule file: `/Users/ahmedzayed/projects/hathor/web/AGENTS.md`
