# Hathor Flagship Scenario

**Cairo → Aachen: an Egyptian infant's vaccination card, reconciled against STIKO.**

---

## Scenario

A physician family is relocating from Egypt to Germany for a graduate programme at RWTH Aachen. Their child, born 15 June 2024, received the standard Egyptian national immunisation programme (EPI) and one MMR dose in Cairo before departure.

The family plans to enrol the child in Kita (daycare) within the next four weeks and needs to know: which doses count under Germany's STIKO 2026 schedule, what is overdue, and what is legally required before enrolment.

---

## Input

| Field | Value |
|---|---|
| Child date of birth | 2024-06-15 |
| Age at scenario date (2026-04-22) | 22 months 7 days |
| Source country | Egypt |
| Target country | Germany (STIKO 2026) |

### Documented doses

| Trade name | Date given | Child age | Antigen coverage |
|---|---|---|---|
| Hexyon (dose 1) | 2024-08-15 | ~2 months | DTaP-IPV-HepB-Hib (6-in-1) |
| Hexyon (dose 2) | 2024-10-15 | ~4 months | DTaP-IPV-HepB-Hib |
| Hexyon (dose 3) | 2024-12-15 | ~6 months | DTaP-IPV-HepB-Hib |
| MMR (dose 1) | 2025-06-15 | ~12 months | Measles-Mumps-Rubella |

---

## Expected clinical behaviour

A correctly reasoning agent should:

1. **Map Hexyon to STIKO antigens** — Hexyon is a hexavalent vaccine covering DTaP, IPV, HepB, and Hib. All three doses count toward the respective primary series.

2. **Validate Hexyon dose 3** — STIKO requires a minimum 180-day interval between Hexyon dose 2 and dose 3 (G2→G3). Dose 2 was 2024-10-15; dose 3 was 2024-12-15. That is 61 days — well under 180. The agent should flag dose 3 as invalid under STIKO's interval rule.

3. **Apply catch-up rules for PCV (pneumococcal)** — The child has no PCV documentation. At 22 months, STIKO catch-up guidance specifies **2 doses** (not 3 as in the primary infant series). A high-quality agent should flag if the `build_catchup_schedule` tool returns 3 doses (the primary series) and note the catch-up exception.

4. **Handle MenB timing** — The child is 22 months. MenB catch-up for initiation before 24 months uses a 3-dose schedule. At or after 24 months it collapses to 2 doses. The agent should flag this age boundary: the child is close to the 24-month threshold and the schedule may change depending on when vaccination starts.

5. **Flag Masernschutzgesetz (§20 IfSG)** — German law (Masernschutzgesetz, effective March 2020) requires proof of 2-dose MMR vaccination (or natural immunity documentation) for Kita enrolment. The child has only 1 documented MMR dose. The second dose must be administered and documented **before** the enrolment date. This is a legal deadline, not only a clinical recommendation.

6. **Note Rotavirus window is closed** — Rotavirus vaccination has a hard upper age limit (typically 24 weeks for the last dose). At 22 months the window is long closed; the agent should explicitly note this so the clinician does not mistakenly ask about it.

7. **Plan a realistic visit sequence** — Given the Kita enrolment deadline of ~4 weeks, the catch-up plan should front-load MMR dose 2 (legally required) and structure remaining doses around the STIKO minimum intervals.

---

## Observed behaviour (runs on 2026-04-22, both models with Kita context)

| Clinical decision | Sonnet 4.6 | Opus 4.7 |
|---|---|---|
| Hexyon → STIKO antigens mapped | ✅ All 3 runs | ✅ All 3 runs |
| Hexyon G3 interval invalid (61 days < 180) | ✅ All 3 runs | ✅ All 3 runs |
| PCV: 3-dose tool output accepted | Both | Both |
| PCV: 2-dose catch-up exception flagged | ✅ All 3 runs (Sonnet adds clinician note) | ❌ None |
| MenB 24-month boundary flagged | ✅ All 3 runs | ✅ All 3 runs |
| Rotavirus window closed | ✅ All 3 runs | ✅ All 3 runs |
| Masernschutzgesetz (§20 IfSG) flagged | ✅ All 3 runs | ✅ All 3 runs |
| Visit count | 3 | 3 |

**Key differential:** Sonnet (all 3 runs) explicitly questions the `build_catchup_schedule` tool's 3-dose PCV output and adds a paediatrician note asking the clinician to confirm whether the 2-dose catch-up rule applies. Opus (all 3 runs) accepts the tool's output without surfacing the exception. This is the sharpest reproducible model difference found across 12 total runs (6 baseline, 6 with Kita context).

---

## Why this case matters

This scenario captures the real experience of physician and academic families relocating from Egypt to Germany — the personal motivation behind this project. It surfaces the intersection of:

- **Cross-schedule antigen mapping** (Egyptian EPI → STIKO 2026)
- **Interval validation** (Hexyon G3 invalidation is non-obvious and often missed)
- **Age-stratified catch-up rules** (PCV 2-dose rule for 12–23 months vs. primary 3-dose series)
- **Legal deadline reasoning** (Masernschutzgesetz §20 IfSG — not just clinical, but legally binding)
- **Time-bounded planning** (Kita enrolment within 4 weeks constrains visit scheduling)

No existing consumer or clinical tool handles all five of these simultaneously.

---

## Files

| File | Contents |
|---|---|
| `differential_matrix.md` | Full 6-run baseline comparison + 6-run Kita side-probe |
| `latest_sonnet.md` | Most recent Sonnet flagship run output |
| `latest_opus.md` | Most recent Opus flagship run output |
| `latest_comparison.md` | Side-by-side comparison of the two models |
| `masernschutz/` | Individual log files from the 6 Kita side-probe runs |
