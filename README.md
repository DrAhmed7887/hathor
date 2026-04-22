# Hathor

An autonomous clinical reasoning agent that reconciles a child's vaccination history across national immunization schedules.

---

## Why

I am an Egyptian physician who moved from Cairo to Germany with my two young children. When we arrived, my daughter's Egyptian vaccination card — perfectly valid, correctly administered — didn't translate cleanly to the German system. No one could tell me which doses counted, which were missing, and what she needed next under STIKO. I built Hathor to solve this for my own family.

This is not a niche problem. Migrant families face it globally — at the intersection of Egyptian EPI, Turkish schedules, Indian immunisation programs, and dozens of host-country requirements. No open-source tool exists to bridge these systems automatically.

---

## How it works

Hathor is built on the Claude Agent SDK with Claude Opus 4.7 and extended thinking enabled. Eight custom clinical tools are exposed via an in-process MCP server: card extraction, age computation, vaccine equivalence lookup, interval validation, per-dose validation, schedule retrieval, gap analysis, and catch-up scheduling. The agent decides which tools to call, in what order, based on what it discovers — there is no hardcoded pipeline. The reasoning is dynamic: the agent reads a card, resolves trade names to canonical antigens, checks every dose against the destination country's rules, and synthesises a visit-by-visit catch-up plan entirely on its own.

The frontend is Next.js with SSE streaming, so the agent's reasoning is visible live — tool calls, thinking blocks, and the final report all appear in real time as the agent works.

---

## Demo

The flagship case: a 22-month-old child born in Cairo, relocating to Aachen. Her Egyptian card shows three doses of Hexyon (the hexavalent 2-4-6 month series) and one MMR dose. Target schedule: Germany's STIKO Impfkalender 2026.

In roughly 25 seconds, the agent identifies that Hexyon dose 3 doesn't count under STIKO — the Egyptian 2-4-6 schedule produces a 61-day gap between doses 2 and 3, well under STIKO's required 180-day G2→G3 interval. It excludes Rotavirus as a closed age window (not a deficiency — the family needn't worry about it). And it surfaces the Masernschutzgesetz requirement: German law mandates two-dose MMR documentation before Kita (daycare) enrolment, so that dose must come first. The output is a 3-visit catch-up plan with correct co-administration rules and a legal deadline flag.

---

## Run locally

```bash
# Terminal 1 — API
cd hathor/api
export ANTHROPIC_API_KEY=sk-ant-...
uv sync
uv run uvicorn hathor.server:app --port 8000

# Terminal 2 — Frontend
cd hathor/web
npm install
npm run dev
```

Visit `localhost:3000`. Click **Use flagship demo scenario**, then **Reconcile**.

---

## What this is and isn't

This is a research prototype, not a medical device. All outputs are clinical decision support — they require confirmation by a licensed paediatrician before any action is taken. The Egypt schedule data was compiled from Vacsera product documentation and the Nomou paediatric health app; it has not been validated against official MOHP policy documents. The tool currently supports Egypt → Germany reconciliation; additional country pairs are future work. MIT licensed.

---

## Built with

Claude Opus 4.7 · Claude Agent SDK · FastAPI · Next.js · Tailwind CSS

*Built for the "Built with Opus 4.7" Hackathon — Anthropic × Cerebral Valley, April 2026.*
