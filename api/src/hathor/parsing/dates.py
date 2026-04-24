"""Date parsing for vaccination-card extraction.

Mirrors :func:`parseRawDate` in ``web/lib/document-intelligence.ts``
exactly. Both parsers consume the same synthetic JSON fixture
(``cards/fixtures/synthetic_egypt_handwritten.json``) so behaviour
stays aligned across the stack.

If you change one, change the other and re-run both test suites.
"""

from __future__ import annotations

import datetime as _dt
import re

# Eastern Arabic-Indic digits (U+0660..U+0669) — the digit shapes most
# Egyptian MoHP cards use.
_EASTERN_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
# Persian / Extended-Arabic-Indic digits (U+06F0..U+06F9) — visually
# close to Eastern Arabic but a distinct Unicode block. Some cards mix
# the two; the parser must understand both.
_PERSIAN_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

# Pediatric vaccination plausibility window. See the docstring on
# parseRawDate in web/lib/document-intelligence.ts for the why-23-means-
# 2023 rationale and the conditions under which this should be revisited.
PEDIATRIC_MIN_YEAR = 2000
PEDIATRIC_MAX_YEAR = _dt.date.today().year + 1
_TWO_DIGIT_PIVOT = PEDIATRIC_MAX_YEAR % 100


def _westernise_digits(text: str) -> str:
    out_chars: list[str] = []
    for ch in text:
        i = _EASTERN_ARABIC_DIGITS.find(ch)
        if i != -1:
            out_chars.append(str(i))
            continue
        i = _PERSIAN_INDIC_DIGITS.find(ch)
        if i != -1:
            out_chars.append(str(i))
            continue
        out_chars.append(ch)
    return "".join(out_chars)


def _normalise_two_digit_year(yy: int) -> int:
    if yy <= _TWO_DIGIT_PIVOT:
        return 2000 + yy
    return 1900 + yy


def _is_plausible_pediatric_year(year: int) -> bool:
    return PEDIATRIC_MIN_YEAR <= year <= PEDIATRIC_MAX_YEAR


def _build_iso(year: int, month: int, day: int) -> str | None:
    if not (1 <= month <= 12):
        return None
    if not (1 <= day <= 31):
        return None
    if not _is_plausible_pediatric_year(year):
        return None
    try:
        # Round-trip through datetime.date to reject impossible day-
        # of-month combinations (Feb 30, Apr 31, etc).
        _dt.date(year, month, day)
    except ValueError:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


_ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_DMY_RE = re.compile(r"^(\d{1,2})([\/\-.])(\d{1,2})\2(\d{2}|\d{4})$")


def parse_raw_date(raw: object) -> str | None:
    """Best-effort parse of a raw date string into ISO YYYY-MM-DD.

    Accepts (after digit-system normalisation):
      - ISO ``YYYY-MM-DD``
      - ``DD/MM/YYYY``, ``DD-MM-YYYY``, ``DD.MM.YYYY``
      - ``DD/MM/YY`` (two-digit year — pediatric-window rule)
      - Single-digit day or month (``9/3/2024``)
      - Eastern Arabic-Indic digits, Persian-Indic digits, mixed
        digit systems within the same date string.

    Returns ``None`` on any ambiguity (empty input, non-string input,
    bare digit run that is not a date, underdetermined fields,
    out-of-range day/month, impossible day-of-month combinations,
    implausible years). Never raises.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        return None
    trimmed = _westernise_digits(raw).strip()
    if not trimmed:
        return None

    iso = _ISO_RE.match(trimmed)
    if iso:
        y, m, d = iso.groups()
        return _build_iso(int(y), int(m), int(d))

    dmy = _DMY_RE.match(trimmed)
    if dmy:
        d_raw, _sep, m_raw, y_raw = dmy.groups()
        day = int(d_raw)
        month = int(m_raw)
        year_literal = int(y_raw)
        year = (
            _normalise_two_digit_year(year_literal)
            if len(y_raw) == 2
            else year_literal
        )
        return _build_iso(year, month, day)

    return None
