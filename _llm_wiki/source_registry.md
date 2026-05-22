# Source Registry

External authorities that this wiki cites or compresses. When facts on
a wiki page conflict with one of these, the source wins — update the
wiki page and log the change.

## In-repo authorities

| Source | What it owns |
|---|---|
| `/Users/ahmedzayed/projects/hathor/CLAUDE.md` | **Claude Code** project rules (tracked): model default `claude-opus-4-7`, scope discipline, no-hardcoded-pipeline, two safety loops, secrets policy, Next 16 deltas. **Authoritative over the wiki for Claude Code sessions.** |
| `/Users/ahmedzayed/projects/hathor/AGENTS.md` | **General-agent rules file candidate pending commit.** Corrected on 2026-05-22 to remove template-derived fake model names and to use operator/tool-configured model guidance. Treat as pending durable canon until Ahmed commits it. Keep aligned with `CLAUDE.md`; flag drift to Ahmed rather than silently reconciling. |
| `/Users/ahmedzayed/projects/hathor/README.md` | Public project description. |
| `/Users/ahmedzayed/projects/hathor/PRD.md` | Product requirements document. |
| `/Users/ahmedzayed/projects/hathor/docs/SAFETY_LOOPS.md` | Phase D (vision-confidence) and Phase E (rules-engine) gate design. |
| `/Users/ahmedzayed/projects/hathor/docs/CLINICAL_DECISIONS.md` | Clinical rationale and reconciliation decisions. |
| `/Users/ahmedzayed/projects/hathor/docs/REFERENCES.md` | Methods sources and WHO DAK references. |
| `/Users/ahmedzayed/projects/hathor/docs/HACKATHON_DEMO_SCRIPT.md` | Demo flow for the hackathon submission. |
| `/Users/ahmedzayed/projects/hathor/docs/PII_HARDENING.md` | PII handling rules. |
| `/Users/ahmedzayed/projects/hathor/docs/SESSION_HANDOFF.md` | Handoff notes between work sessions. |
| `/Users/ahmedzayed/projects/hathor/internal/BUILD_LOG.md` | Day-by-day build narrative. |
| `/Users/ahmedzayed/projects/hathor/web/AGENTS.md` | Tracked. Provides frontend-specific agent rules (agent-neutral wording); points any agent to `web/node_modules/next/dist/docs/` as the authoritative Next 16 reference. |
| `/Users/ahmedzayed/projects/hathor/.claude/` | Project-local Claude configuration directory. **Not an active authority for this wiki.** Do not mutate from the wiki and do not treat as a durable canonical source. May be referenced only as a "project-local agent configuration candidate" after Ahmed explicitly confirms it should be part of the repo workflow. Distinct from user-level `~/.claude`, which is forbidden in either direction. |

## User-level authorities

User-level tool-state folders (`~/.claude`, `~/.codex`, `~/.gemini`,
`~/.hermes`) are **not active authorities for this wiki.** They are
out of scope unless Ahmed explicitly provides their content into the
session. Do not read or cite them during normal project work — agents
running there already see whatever is relevant, and the wiki must not
encourage cross-agent peeking at private tool state.

If Ahmed pastes content from one of those folders into a session,
treat that pasted content as the authority for that session only;
do not record paths into `~/.claude` etc. as ongoing sources here.

## External authorities

| Source | What it owns |
|---|---|
| WHO DAK (immunization) | Ground truth for vaccination schedule logic encoded in `api/src/hathor/safety/` and `api/src/hathor/tools/dose_validation.py`. See `docs/REFERENCES.md` for exact pointers. |
| Karpathy LLM Wiki gist — `https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f` | The upstream method this `_llm_wiki/` follows. |
| Next.js 16 bundled docs — `web/node_modules/next/dist/docs/` | Authoritative over training data for App Router code in `web/`. Per `web/AGENTS.md`. |
| Anthropic Claude Agent SDK | Runtime for the backend agent in `api/src/hathor/`. |

## Out-of-scope / forbidden sources

- Google Drive — do not read or write.
- Tool-state folders (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.hermes`) — do not read or write.
- Anything under `cards/private/`.
- Secrets, credentials, passport scans, bank documents, legal/family files.

## How to add a source

1. Add a row above with the absolute path or URL and what it owns.
2. Append an entry to `log.md`.
3. If the source supersedes content already on a wiki page, update
   that page in the same session.
