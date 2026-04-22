# Hathor

An autonomous clinical reasoning agent that reconciles a child's vaccination history across national immunization schedules.

---

## Why

Millions of African families move between countries every year — within the continent, for work, study, or safety. A child vaccinated correctly under one national schedule often arrives in a new country where no one can quickly tell the family which doses count, which are missing, and what is needed before the child can enrol in school or nursery. The schedules look similar on paper but diverge in important ways: the antigens covered by combined products, the ages of administration, the vaccines that are routine in one country and not another, and the strict age windows on products like rotavirus.

I am an Egyptian physician. I built Hathor because I kept running into this problem myself and in my clinical work — and because no open-source tool exists for autonomous cross-schedule reconciliation. The closest prior work (AI-VaxGuide, arXiv 2507.03493) does clinician Q&A over a single country's guidelines, not reconciliation across schedules.

---

## How it works

Hathor is built on the Claude Agent SDK with extended thinking enabled. Eight custom clinical tools are exposed via an in-process MCP server: card extraction, age computation, vaccine equivalence lookup, interval validation, per-dose validation, schedule retrieval, gap analysis, and catch-up scheduling. The agent decides which tools to call, in what order, based on what it discovers — there is no hardcoded pipeline. The reasoning is dynamic: the agent reads a card, resolves trade names to canonical antigens, checks every dose against the destination country's rules, and synthesises a visit-by-visit catch-up plan entirely on its own.

The frontend is Next.js with SSE streaming, so the agent's reasoning is visible live — tool calls, thinking blocks, and the final report all appear in real time as the agent works.

---

## Demo

The flagship case: a 22-month-old child born in Lagos, relocating to Cairo. Her Nigerian NPI card shows the full 6/10/14-week primary series (Pentavalent, OPV, PCV13, Rotavirus, IPV at 14 weeks), plus Measles monovalent and Yellow Fever at 9 months. Target schedule: Egypt's EPI.

The agent identifies that the Nigerian Measles-monovalent dose at 9 months does **not** satisfy Egyptian EPI's MMR requirement — Mumps and Rubella are uncovered, and Egyptian EPI calls for two MMR doses (at 12 and 18 months). It preserves the Yellow Fever dose on the record but does not count it as an Egyptian EPI requirement (Egypt is not yellow-fever-endemic). It recognises Nigeria's BCG-at-birth as satisfying Egypt's BCG-at-1-month requirement, and confirms that the Nigerian Pentavalent + separate IPV doses together cover the same antigens as Egypt's Hexavalent. The output is a visit-by-visit catch-up plan focused on the real gaps: MMR ×2, DPT booster, and OPV booster.

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

This is a research prototype, not a medical device. All outputs are clinical decision support — they require confirmation by a licensed paediatrician before any action is taken. The Nigeria schedule is composed from UNICEF Nigeria, the WHO 2024 Nigeria country profile, and the Paediatric Association of Nigeria (2020, reviewed periodically); the Egypt schedule is composed from Egypt MoHP EPI, WHO EMRO, and UNICEF Egypt. The tool currently supports reconciliation into Egypt as the destination country, with Nigeria as the validated source pair; additional African country pairs are future work. MIT licensed.

---

## Built with

Claude Agent SDK · FastAPI · Next.js · Tailwind CSS
