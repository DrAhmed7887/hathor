"""Parsing utilities — kept aligned with the TypeScript versions in
``web/lib``. New parsers added here must have a matching JS sibling
(or a clear note explaining why parity does not apply).
"""

from hathor.parsing.dates import parse_raw_date

__all__ = ["parse_raw_date"]
