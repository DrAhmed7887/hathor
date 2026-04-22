# cards/ — dev-only vaccination card fixtures

This directory holds example vaccination card images used to exercise
Hathor's `extract_vaccinations_from_card` tool during local development.

**Files in this directory are gitignored** (see the top-level `.gitignore`).
Most card images come from WHO reports, published papers, ministry-of-health
public materials, or consented clinical samples. They are under mixed
copyright and should not be redistributed through this repository.

## Suggested sources (Phase 1 — intra-Africa)

Nigerian cards:
- UNICEF Nigeria Immunization Schedule PDF (example card reproduced in reports)
- Published papers on NPI coverage (Google Scholar: "Nigeria immunization card
  study"), which sometimes reproduce sample cards as figures
- Paediatric Association of Nigeria (pan-ng.org) educational materials

Egyptian cards:
- MoHP public health materials (Arabic/English bilingual stickers)
- Published audits of Egyptian EPI cards (PubMed: "Egypt vaccination card")
- Anonymised scans from consented clinical teaching sets

When saving a card here, use a descriptive filename:
`nga_child_22m_full_npi.jpg`, `egy_legacy_measles_9m_card.jpg`, etc.
