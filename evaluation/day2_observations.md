# Day 2 Agent Observations
Generated: 2026-04-22 | Test scenario: Egyptian child (Hexyon×3, MMR×1) → Germany STIKO

---

## Run Statistics

| Run | Model | Tool calls | Output tokens | Cache read tokens | Cost (USD) |
|-----|-------|-----------|---------------|-------------------|------------|
| Sonnet run 1 (Ahmed terminal) | claude-sonnet-4-6 | ~26 (timed out in final text generation) | n/a | n/a | n/a |
| Sonnet run 2 (captured) | claude-sonnet-4-6 | 26 | 24,111 | 109,222 | $0.5867 |
| Opus run 1 (captured) | claude-opus-4-7 | 21 | 11,077 | 117,800 | $0.8181 |

Opus used 5 fewer tool calls and produced less than half the output tokens — more efficient despite being a larger model.

---

## Tool Usage Comparison

### Tools used in every run
`extract_vaccinations_from_card` · `compute_age_at_dose` (×4–5) · `lookup_vaccine_equivalence` (×2) · `validate_dose` (×7–15) · `get_schedule` · `compute_missing_doses` · `build_catchup_schedule`

### Tools used in Opus only
- `check_interval_rule` (×2 — explicit DTaP and HepB G2→G3 interval check alongside validate_dose)
- An extra `compute_age_at_dose` call against the real system date (2026-04-21) to resolve the date inconsistency

### Tools used in Sonnet only
- Sonnet run 2 called `validate_dose` for every individual antigen (DTaP, IPV, Hib, HepB — all three doses each = 12 calls), whereas Opus validated only the critical doses (D1, D2, D3-DTaP, D3-HepB, D3-Hib, D3-IPV, Measles = 7 calls). Different efficiency, same conclusions.

### ToolSearch
All runs used 1 ToolSearch call at the start to load MCP tool schemas (Claude Code deferred tool loading behaviour — expected, not a Hathor tool).

---

## Clinical Agreement: Core Findings

| Finding | Sonnet | Opus |
|---------|--------|------|
| Hexyon = DTaP + HepB + Hib + IPV | ✅ | ✅ |
| Hexyon D1 and D2 valid | ✅ | ✅ |
| Hexyon D3 invalid (61-day interval vs. 180-day STIKO minimum) | ✅ | ✅ |
| Rotavirus window closed — do not vaccinate | ✅ | ✅ |
| PCV entirely absent — never given in Egyptian EPI | ✅ | ✅ |
| MenB entirely absent — never given in Egyptian EPI | ✅ | ✅ |
| BCG not a German gap | ✅ | ✅ |

All runs agreed on every core clinical finding.

---

## Clinical Differences Between Runs

### 1. Date interpretation — **substantive difference**

The test scenario hard-codes `today = 2025-04-21`, but the actual system date when the Opus run executed was **2026-04-21**. Opus noticed the inconsistency:

> "The project context sets today as 2026-04-21, which makes the MMR date coherent. I'll proceed with today = 2026-04-21 (child age ~22 months)."

This cascaded into meaningful clinical differences:

| Dimension | Sonnet (2025-04-21, child 10 m) | Opus (2026-04-21, child 22 m) |
|-----------|--------------------------------|-------------------------------|
| MMR D1 status | Future-dated, not yet given | ✅ Valid (given at 12 m, in the past) |
| Child age | 310 days (10 months) | 676 days (22 months) |
| MMR/Varicella eligibility | Deferred — child not yet 11 m | Already eligible; MMR D1 done |
| Visit count | 4 visits | 3 visits |

**Root cause:** The `TEST_SCENARIO` string in `run_agent.py` has a hard-coded date (`Today's date: 2025-04-21`) that is now a year in the past. For Day 3, this should use `datetime.date.today()`.

### 2. PCV catch-up regimen — **Opus more accurate**

- **Sonnet:** Planned a 2-dose catch-up primary series (D1 → D2 → booster) with explicit interval constraints, flagging the booster timing as uncertain.
- **Opus:** Applied the STIKO catch-up rule for healthy children ≥12 months: **1 dose only** (not a full series). This is clinically correct for an unimmunised child vaccinated after the first birthday with no risk conditions.

Sonnet flagged uncertainty about the booster interval; Opus resolved it correctly by applying the age-specific catch-up rule.

### 3. MenB catch-up series length — **Opus more accurate**

- **Sonnet:** Assumed the 3-dose infant series for MenB catch-up.
- **Opus:** Correctly applied the 2-dose catch-up series for ages 12–23 months (Bexsero SmPC, STIKO recommendation for this age group).

### 4. Kita / Masernschutzgesetz flag — **Opus only**

Opus added a flag specific to German law: under the *Masernschutzgesetz* (Measles Protection Act, §4 effective 2020), daycare facilities are required to verify measles vaccination before enrolment. Sonnet did not surface this flag. This is directly relevant to families relocating to Germany.

### 5. Optional same-day live vaccine co-administration — **Opus only**

Opus explicitly offered the option to co-administer MMR-2 and Varicella-1 on the same day as the non-live vaccines at Visit 1, compressing the schedule if the family prefers fewer clinic trips. Sonnet separated these into a dedicated Visit 2 without offering the same-day option.

---

## Visit Plan Comparison

Both models agreed on the logical structure. The difference in visit count arises entirely from the date drift issue (MMR D1 being future vs past):

**Sonnet (10-month-old):** 4 visits
- V1 today: Hexavalent G3 + PCV D1 + MenB D1
- V2 (≥2025-05-19): PCV D2 + MMR D1 + Varicella D1
- V3 (≥2025-06-16): MenB D2 + PCV D3 (TBC)
- V4 (≥2025-09-15, 15 m): MMR D2 + Varicella D2 + MenB D3 + PCV D3

**Opus (22-month-old):** 3 visits
- V1 today: Hexavalent G3 + PCV D1 + MenB D1 (+ optionally MMR D2 + Varicella D1)
- V2 (≥28 days): MMR D2 + Varicella D1 (if deferred)
- V3 (≥8 weeks from V1, ≥28 days from V2): MenB D2 + Varicella D2

---

## Deficiencies Identified for Day 3

1. **Hard-coded date in `run_agent.py`** — `TEST_SCENARIO` uses `"Today's date: 2025-04-21"`. Replace with `datetime.date.today().isoformat()` to avoid model confusion.
2. **`build_catchup_schedule` is too naive** — lumped PCV D1+D2+D3 into a single visit in both runs; agents had to override this in their reasoning. Tool needs inter-dose interval awareness.
3. **Antigen key mismatch** — Opus validated Measles/Mumps/Rubella as separate antigens, but `compute_missing_doses` expects the combined `"MMR"` key. Opus caught and explained this mismatch; Sonnet avoided it by not crediting the MMR dose. A normalisation step should unify individual antigens to their canonical schedule key.
4. **Final plan text accumulation** — `run_agent.py` appends all intermediate `TextBlock` commentary to `final_text_blocks`, not just the terminal report. Minor output quality issue.
