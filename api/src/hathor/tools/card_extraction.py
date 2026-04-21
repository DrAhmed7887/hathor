"""Tool: extract_vaccinations_from_card — stubbed for Day 2."""

import json
from claude_agent_sdk import tool

STUB_DATA = {
    "child_dob": "2024-06-15",
    "card_country": "Egypt",
    "extracted_doses": [
        {
            "vaccine_trade_name": "Hexyon",
            "date_given": "2024-08-15",
            "dose_number_on_card": 1,
            "source": "Egyptian vaccination card",
        },
        {
            "vaccine_trade_name": "Hexyon",
            "date_given": "2024-10-15",
            "dose_number_on_card": 2,
            "source": "Egyptian vaccination card",
        },
        {
            "vaccine_trade_name": "Hexyon",
            "date_given": "2024-12-15",
            "dose_number_on_card": 3,
            "source": "Egyptian vaccination card",
        },
        {
            "vaccine_trade_name": "MMR",
            "date_given": "2025-06-15",
            "dose_number_on_card": 1,
            "source": "Egyptian vaccination card",
        },
    ],
    "extraction_method": "STUB — hardcoded Day 2 test scenario",
    "confidence": "n/a (stub)",
}


@tool(
    "extract_vaccinations_from_card",
    "Extract all vaccination records from a child's vaccination card image. Returns structured dose data including vaccine trade names, dates given, and dose numbers as written on the card. [STUB: Day 2 returns hardcoded test data; real vision OCR in Day 3]",
    {"image_path": str},
)
async def extract_vaccinations_from_card(args: dict) -> dict:
    image_path = args.get("image_path", "")
    result = {**STUB_DATA, "image_path_received": image_path}
    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
