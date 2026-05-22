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
- **General-agent stack:** the repo-root `AGENTS.md` is a corrected
  general-agent rules file candidate pending commit. It does not
  invent model IDs; it tells agents to use the best available reasoning
  model configured by the operator/tool and to follow repo safety rules
  over model-specific assumptions.

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
   (tracked) if you are Claude Code; `AGENTS.md` if you are a general
   coding agent. `AGENTS.md` is corrected for promotion but remains a
   pending-commit candidate until Ahmed commits it.
4. Confirm the request does not require moving files, mutating Git
   state (no commit / branch / pull / push / stash / reset / clean —
   especially strict while the passport + Remotion work is uncommitted),
   modifying source code, or touching Google Drive / tool-state
   folders. If it does, stop and ask Ahmed.
