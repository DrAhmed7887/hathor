# Hathor

An autonomous clinical reasoning agent for cross-border vaccination schedule reconciliation.

---

## The Story Behind the Name

Hathor was the ancient Egyptian goddess of motherhood and the protection of children. This project takes its name and its purpose from that origin. It was built by an Egyptian physician relocating to Germany with his family — for whom the question this software answers is not abstract. When you arrive in a new country with your children's vaccination cards, you face a real administrative and clinical gap: the records are real, the vaccines were given, but nobody can tell you cleanly which ones count, which are missing, and what your children need next under the new country's schedule. Hathor is the tool that should have existed.

---

## The Problem

Migrant families face a genuine clinical gap at the intersection of international health systems. Egypt's EPI schedule, Germany's STIKO recommendations, and the WHO's universal childhood immunisation schedule overlap in complex and non-obvious ways. A vaccine given under one trade name in one country may satisfy a requirement listed under a different name in another. Timing windows differ. Combination vaccines are recorded differently across systems. No existing tool reconciles these schedules automatically — clinicians do it manually from memory or outdated reference sheets, parents get inconsistent guidance, and children sometimes receive redundant doses or — worse — miss necessary catch-up vaccinations.

---

## The Solution

Hathor is an autonomous agent built on the Claude Agent SDK and Claude Opus 4.7. Given a photograph of a child's vaccination card, the child's date of birth, and a target country's immunisation schedule, the agent:

1. Reads and parses the card using vision capabilities
2. Identifies each administered vaccine by name, batch, and date
3. Queries the target country's schedule for equivalence rules
4. Reasons about timing gaps, partial series, and combination vaccines
5. Critiques its own draft reconciliation before finalising
6. Outputs a structured plan: what counts, what's missing, what's due next, and any timing concerns

The output is designed for parent decision support — clear, actionable, and appropriately caveated as non-prescriptive guidance requiring clinical confirmation.

---

## Why Claude Opus 4.7

Vaccination reconciliation is not a lookup problem. It requires genuine multi-step clinical reasoning: interpreting ambiguous vaccine names, applying jurisdiction-specific equivalence rules, reasoning about age-appropriate timing, and catching errors in its own conclusions. Opus 4.7 was selected specifically because it was trained for agentic loop behaviour — including self-verification and mid-loop backtracking — that weaker models do not reliably exhibit. Extended thinking is kept on throughout: the research question behind this project is precisely whether visible, verifiable reasoning from a frontier model can reach a quality acceptable for parent-facing clinical decision support.

---

## Status

**Day 1 of 5 — Foundation only. Not yet functional.**

The project skeleton, Python environment, and SDK smoke test are complete. Vaccination logic, tool implementation, and the web frontend are Day 2–3 work.

| Day | Goal | Status |
|-----|------|--------|
| 1 | Monorepo, SDK wired, first agent query | ✓ Complete |
| 2 | Custom tools, schedule data, end-to-end agent run | Pending |
| 3 | Next.js frontend, SSE streaming | Pending |
| 4 | Polish, flagship demo case, methods writeup | Pending |
| 5 | Demo video + submit | Pending |

---

## Built For

**"Built with Opus 4.7" Hackathon** — Anthropic × Cerebral Valley, April 21–26, 2026.

---

## Disclaimer

Hathor is a research and demonstration project. It is not a medical device, not a substitute for clinical advice, and not approved for diagnostic or prescriptive use. All outputs require confirmation by a qualified healthcare provider.

---

## License

MIT © 2026 Ahmed Zayed
