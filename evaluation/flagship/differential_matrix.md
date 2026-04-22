# Hathor Flagship — Differential Matrix
Generated: 2026-04-22  
Scenario: Egyptian infant (DOB 2024-06-15, age 22.2 months), 4 documented doses (Hexyon ×3, MMR ×1), relocating to Germany

---

## Run-level statistics

| Run | Model | Tool calls | Cost (USD) | Stop reason |
|---|---|---|---|---|
| sonnet_run_1 | claude-sonnet-4-6 | 21 | $0.4000 | end_turn |
| sonnet_run_2 | claude-sonnet-4-6 | 19 | $0.3585 | end_turn |
| sonnet_run_3 | claude-sonnet-4-6 | 27 | $0.4443 | end_turn |
| opus_run_1 | claude-opus-4-7 | 20 | $0.7686 | end_turn |
| opus_run_2 | claude-opus-4-7 | 18 | $0.5960 | end_turn |
| opus_run_3 | claude-opus-4-7 | 20 | $0.5766 | end_turn |

**Sonnet mean cost: $0.401 · Opus mean cost: $0.648 · Opus/Sonnet cost ratio: 1.6×**

---

## Clinical decision matrix

| Decision point | S1 | S2 | S3 | O1 | O2 | O3 |
|---|---|---|---|---|---|---|
| **PCV — doses in plan** | 3 | 3 | 3 | 3 | 3 | 3 |
| **PCV — overcounting flagged?** | ✅ Yes (Flag 2) | ✅ Yes (Flag 2) | ✅ Yes (Flag 2) | ❌ No | ❌ No | ❌ No |
| **MenB — doses in plan** | 3 | 3 | 3 | 3 | 3 | 3 |
| **MenB — 24-month boundary flagged?** | ✅ Yes (Flag 3) | ⚠️ Partially | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **MMR dose 2 timing** | Visit 1 (immediate) | Visit 1 | Visit 1 | Visit 1 | Visit 1 | Visit 1 |
| **Varicella handling** | Catch-up + history check | Catch-up + history check | Catch-up + history check | Catch-up + history check | Catch-up + history check | Catch-up + history check |
| **Rotavirus — window closed flagged?** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Masernschutzgesetz (§20 IfSG) flagged?** | ❌ Not surfaced | ❌ Not surfaced | ❌ Not surfaced | ❌ Not surfaced | ❌ Not surfaced | ❌ Not surfaced |
| **Kita/daycare enrolment mentioned?** | ❌ No | ❌ No | ❌ No | ⚠️ "Kita staff" (doc note) | ❌ No | ❌ No |
| **Visit count** | 3 | 3 | 3 | 3 | 3 | 3 |
| **Hexyon G3 invalidation** | ✅ Correctly identified | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Within-model variance

**Sonnet:** Tool call count varies (19–27). Clinical decisions are **identical** across all 3 runs. All 3 runs surface the same two flags (PCV overcounting, MenB boundary). No within-model clinical variance.

**Opus:** Tool call count consistent (18–20). Clinical decisions are **identical** across all 3 runs. All 3 runs flag the MenB boundary; none flag PCV overcounting. No within-model clinical variance.

---

## Key finding: the PCV decision reversal

**Hypothesis going in:** Opus would correctly apply STIKO's 2-dose catch-up rule for 12–23 month unvaccinated children; Sonnet would follow the tool's 3-dose primary-series output blindly.

**Observed (all 6 runs):** Both models follow the `build_catchup_schedule` tool's 3-dose PCV output. **However:**

- **Sonnet (all 3 runs):** Explicitly flags in the paediatrician notes section that the tool returned 3 doses based on the infant primary schedule, but that STIKO catch-up guidance for 12–23 months typically specifies **2 doses** — and asks the clinician to confirm before Visit 3.
- **Opus (all 3 runs):** Does **not** flag the PCV dose count discrepancy. Accepts the tool's 3-dose output without surfacing the catch-up exception.

This is the **inverse** of the Day 2 differential. Sonnet is now the model questioning the tool; Opus is silently accepting it.

**Root cause:** The `build_catchup_schedule` tool returns doses based on the full STIKO primary series (3 doses for PCV), without applying age-stratified catch-up rules (which call for 2 doses when initiation is at 12–23 months, 1 dose at ≥24 months). This is a tool accuracy issue, not a model reasoning issue. Both models are constrained by the tool's output; Sonnet is the one overriding it with clinical judgment.

---

## The unopened differential: Masernschutzgesetz

The **Masernschutzgesetz (German Measles Protection Act, §20 IfSG, effective March 2020)** requires proof of MMR vaccination (or natural immunity) for all children enrolling in daycare or school. For a 22-month-old relocating to Germany, this is a near-certain near-term requirement. It also imposes a deadline: the family must produce documentation *before* Kita enrolment.

**Observed:** None of the 6 runs (Sonnet or Opus) surfaced this legal requirement. The scenario prompt does not mention Kita enrolment; neither model inferred it from "family is relocating."

**Testable differential:** Adding "the child will enrol in Kita (daycare) within the next 4 weeks" to the scenario may produce a differential — Opus reasoning about the legal deadline vs. Sonnet producing a clinical schedule without it. This is untested.

---

## Summary

| Attribute | Sonnet 4.6 | Opus 4.7 |
|---|---|---|
| PCV plan | 3 doses (follows tool) | 3 doses (follows tool) |
| PCV over-prescription flagged | **✅ All 3 runs** | ❌ None |
| MenB boundary flagged | ✅ All 3 runs | ✅ All 3 runs |
| Masernschutzgesetz | ❌ | ❌ |
| Overall clinical accuracy | Equivalent | Equivalent |
| Self-correction behavior | More prominent | Quieter |
| Cost | $0.40/run | $0.65/run |
