# Hathor — LLM Wiki Index

Durable operating memory for the Hathor project. Created 2026-05-22.

## What Hathor is (one paragraph)

Hathor is an autonomous clinical-reasoning agent for cross-border
vaccination-schedule reconciliation. Phase 1 (hackathon scope) is
intra-Africa reconciliation with Nigeria → Egypt as the validated
country pair. The system has two mandatory safety gates: a per-field
vision-confidence gate (Phase D) and a per-recommendation rules-engine
gate (Phase E). Built by Dr. Ahmed Zayed. Backend is FastAPI + the
Claude Agent SDK. Frontend is Next.js 16 + React 19 + Tailwind 4.

**Model defaults are stack-specific, not universal:**

- **Claude Code stack:** the tracked repo-root `CLAUDE.md` sets
  `claude-opus-4-7` as the default (with `claude-sonnet-4-6` for
  side-by-side comparisons when Ahmed requests).
- **Codex / general-agent stack:** the untracked repo-root
  `AGENTS.md` currently spells the defaults as `Codex-opus-4-7` /
  `Codex-sonnet-4-6`, which appears to be a template artifact from
  generating an AGENTS.md mirror of CLAUDE.md. **Ahmed decision
  needed** before this wiki claims a canonical Codex-stack default.

The wiki itself is the durable memory across both stacks; it does
not declare a universal default model.

## Workspace at a glance

| Location | Role | Status |
|---|---|---|
| `/Users/ahmedzayed/projects/hathor` | Active code working copy | **Candidate source of truth.** Uncommitted work present on 2026-05-22. |
| `/Users/ahmedzayed/Desktop/Hathor-video-assets` | External media folder referenced by repo symlink `video/assets-on-desktop/` | Treat both the symlink and Desktop target as read-only from this wiki's POV; do not move, delete, retarget, or reorganize either without explicit Ahmed approval. |
| Google Drive | High-risk cloud sync | **Do not touch.** |
| `~/.claude`, `~/.codex`, `~/.gemini`, `~/.hermes` | Tool-state folders | **Do not touch.** |

## Wiki pages

### Top-level
- [`CLAUDE.md`](CLAUDE.md) — operating rules for every agent that
  reads this wiki. Read this first.
- [`source_registry.md`](source_registry.md) — external authorities
  the wiki cites.
- [`log.md`](log.md) — dated change log for the wiki itself.

### Decisions
- [`decisions/source-of-truth-2026-05-22.md`](decisions/source-of-truth-2026-05-22.md)
  — where the live code and media live, and what is forbidden.

### Manifests (point-in-time snapshots)
- [`manifests/repo-map-2026-05-22.md`](manifests/repo-map-2026-05-22.md)
  — what each top-level directory in the repo contains and what
  it is for.

### Projects
- [`projects/current-status-2026-05-22.md`](projects/current-status-2026-05-22.md)
  — what was in flight as of the wiki-creation date.

## Conventions

- `_llm_wiki/log.md` is **append-only**.
- `_llm_wiki/decisions/*-YYYY-MM-DD.md` are **preserved point-in-time
  snapshots**. Do not edit them in place; to change a decision, write
  a new dated file in `decisions/` and link it from this index.
- `_llm_wiki/manifests/*` and `_llm_wiki/projects/current-status-*.md`
  are **living docs even when the filename carries a date.** Edit in
  place and log the change. The date in the filename marks creation,
  not immutability.
- `CLAUDE.md`, `index.md`, `source_registry.md` are living docs. Edit
  in place and log the change.
- Use **"Ahmed decision needed"** for any open question. Do not guess.

## Quick agent checklist before doing anything

1. Read `_llm_wiki/CLAUDE.md`.
2. Read the latest dated snapshot in each of `decisions/`,
   `manifests/`, `projects/`.
3. Read the repo-root rules file for your agent stack: `CLAUDE.md`
   (tracked) if you are Claude Code; `AGENTS.md` (untracked candidate
   at 2026-05-22) if you are Codex or a general agent. Be aware of
   the other; the two are intended to stay in sync. Treat untracked
   rules files as candidates, not durable canon, until Ahmed promotes
   them.
4. Confirm the request does not require moving files, mutating Git
   state (no commit / branch / pull / push / stash / reset / clean —
   especially strict while the passport + Remotion work is uncommitted),
   modifying source code, or touching Google Drive / tool-state
   folders. If it does, stop and ask Ahmed.
