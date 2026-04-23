"""Hathor safety loops.

Two mandatory gates:
- Phase D (vision): per-field OCR confidence gate before the agent sees data.
- Phase E (reasoning): per-recommendation rules-engine gate before the
  clinician sees data.

See CLAUDE.md ("Architectural Rule: Two Safety Loops") and
docs/SAFETY_LOOPS.md.
"""
