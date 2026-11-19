# Clairic Flash on 14 synthetic cards: run of 19 Nov 2026

Colab A100-SXM4-40GB (H100 not selectable), with the DeepGEMM matmul sent to the Triton fallback (`PATCHED`), so scores may differ slightly from an H100. 244 fields (a date and a lot per expected row). `raw_responses.json` holds the model's full answers; re-score them with cells 7–8.

## Result
- **85.7% of fields correct** (dates 90%, lots 81%). Dates are scored from the printed text, read day first, the way Hathor parses them. Clairic's own date normaliser rejected every day/month-ambiguous date (`invalid_printed_temporal`, confidence 0), although it read the digits right.
- **Printed and synthetic-handwritten cards (01–10, 13–14): 88–100% per card.** Clean, rotated, low-contrast, Arabic-Indic and Persian digits, the duplicate visit, decoy date-like numbers and the WHO card are all ≥ 94%.
- **Arabic handwritten cards fail: 11 = 28%, 12 = 17%.** On both, Clairic says the lot is blank, with 91–99.9% confidence, for every row.
- **Confidence vs correctness:** AUROC 0.814. At a 0.95 threshold, 23% of fields go to a human and 20 of 35 wrong answers are caught. 20 wrong answers had confidence ≥ 0.9: 18 on cards 11–12, plus "EH-HBO" for "EH-HB0" (letter O for zero) on cards 13–14.
- Card 07 (missing date): Clairic invented "2025-07-01" for the blank cell, but at confidence 0.27, so the threshold catches it.
- Every response reports `truncated=True`. That flag is set when any field is invalid (`backend.py`), so here it reflects the date-normaliser refusals. It doesn't mean the input was cut.

## What this means for Hathor
- Its confidence can't decide on its own what skips human review: on the Arabic handwritten cards, which are Hathor's core case, it is confidently wrong.
- Usable as a second reader on printed cards: disagreement with Opus, or confidence below 0.95, sends the field to the HITL queue. Lots need a format check (O vs 0).
- Dates: use `printed_value` and Hathor's own parser, never Clairic's normalised `value`.

## Not covered
The 27B model (needs H100), image tiling for handwritten cards, real cards, comparison with Opus.
