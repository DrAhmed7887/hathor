# Synthetic vaccination card test set

This fixture set provides fourteen mock vaccination-card images for OCR and vision
extraction tests. The cards are generated from deterministic drawing code and
contain no real child records.

Run the generator from the repository root:

```bash
python3 cards/fixtures/synthetic_vaccination_cards/generate_synthetic_vaccination_cards.py
```

The generator writes PNG images and `manifest.json` in this directory. Treat
the manifest as the expected-output contract for tests.

## Fixture coverage

- Clean Egyptian card.
- Messy handwritten Egyptian card.
- Rotated and skewed Egyptian card.
- Low-contrast photocopy.
- Arabic-Indic digit variant.
- Persian-Indic digit variant.
- Missing-date card.
- Duplicate same-visit vaccines.
- False-positive numbers that look like dates.
- WHO/UNICEF-style international immunization card template.
- Dense Arabic handwritten scan-style cards inspired by photocopied Egyptian
  cards, with fictional dates and margin notes only.
- English handwritten cards with handwritten dates, lot numbers, and provider
  initials.

## Privacy rule

Only synthetic data, public blank templates, or recreated mock cards belong in
this directory. Do not add real child records, real medical record numbers, or
ground truth derived from real patient cards.
