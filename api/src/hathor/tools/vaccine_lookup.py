"""Tool: lookup_vaccine_equivalence — trade name to antigen component mapping."""

import json
from claude_agent_sdk import tool

# Keys are normalised lowercase trade names (and common aliases).
# components: list of antigen strings the agent uses for schedule matching.
# stiko_equivalent: how STIKO/Germany refers to this antigen group.
VACCINE_DB: dict[str, dict] = {
    # Hexavalent (DTaP + IPV + Hib + HepB)
    "hexyon": {
        "canonical_name": "Hexyon",
        "manufacturer": "Sanofi Pasteur",
        "components": ["DTaP", "IPV", "Hib", "HepB"],
        "combination_type": "hexavalent",
        "stiko_equivalent": "Hexavalent (DTaP-IPV-Hib-HepB)",
        "notes": "Widely used in Egypt and EU. Egypt may use whole-cell pertussis variant; Hexyon is acellular (DTaP). Both satisfy DTP requirement.",
        "source": "EMA SmPC / STIKO",
    },
    "hexaxim": {
        "canonical_name": "Hexaxim",
        "manufacturer": "Sanofi Pasteur",
        "components": ["DTaP", "IPV", "Hib", "HepB"],
        "combination_type": "hexavalent",
        "stiko_equivalent": "Hexavalent (DTaP-IPV-Hib-HepB)",
        "source": "EMA SmPC",
    },
    "infanrix hexa": {
        "canonical_name": "Infanrix Hexa",
        "manufacturer": "GSK",
        "components": ["DTaP", "IPV", "Hib", "HepB"],
        "combination_type": "hexavalent",
        "stiko_equivalent": "Hexavalent (DTaP-IPV-Hib-HepB)",
        "source": "EMA SmPC / STIKO",
    },
    "vaxelis": {
        "canonical_name": "Vaxelis",
        "manufacturer": "MCM Vaccine / Sanofi-MSD",
        "components": ["DTaP", "IPV", "Hib", "HepB"],
        "combination_type": "hexavalent",
        "stiko_equivalent": "Hexavalent (DTaP-IPV-Hib-HepB)",
        "source": "EMA SmPC",
    },
    # Pentavalent (DTaP + IPV + Hib — no HepB)
    "pentaxim": {
        "canonical_name": "Pentaxim",
        "manufacturer": "Sanofi Pasteur",
        "components": ["DTaP", "IPV", "Hib"],
        "combination_type": "pentavalent",
        "stiko_equivalent": "Pentavalent (DTaP-IPV-Hib)",
        "notes": "Does NOT include HepB. Common on older Egyptian cards before hexavalent was introduced.",
        "source": "EMA SmPC",
    },
    "pentavac": {
        "canonical_name": "Pentavac",
        "manufacturer": "Sanofi Pasteur",
        "components": ["DTaP", "IPV", "Hib"],
        "combination_type": "pentavalent",
        "stiko_equivalent": "Pentavalent (DTaP-IPV-Hib)",
        "notes": "Egyptian/MENA market pentavalent. Does NOT include HepB. May appear on Egyptian cards as 'الخماسي'.",
        "source": "Sanofi product data",
    },
    "infanrix ipv+hib": {
        "canonical_name": "Infanrix IPV+Hib",
        "manufacturer": "GSK",
        "components": ["DTaP", "IPV", "Hib"],
        "combination_type": "pentavalent",
        "stiko_equivalent": "Pentavalent (DTaP-IPV-Hib)",
        "source": "EMA SmPC",
    },
    # MMR and variants
    "priorix": {
        "canonical_name": "Priorix",
        "manufacturer": "GSK",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "stiko_equivalent": "MMR",
        "source": "EMA SmPC",
    },
    "mmrvaxpro": {
        "canonical_name": "M-M-RvaxPro",
        "manufacturer": "MSD",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "stiko_equivalent": "MMR",
        "source": "EMA SmPC",
    },
    "m-m-rvaxpro": {
        "canonical_name": "M-M-RvaxPro",
        "manufacturer": "MSD",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "stiko_equivalent": "MMR",
        "source": "EMA SmPC",
    },
    "mmr": {
        "canonical_name": "MMR (generic)",
        "manufacturer": "Various",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "stiko_equivalent": "MMR",
        "notes": "Generic MMR notation on Egyptian cards — accept as MMR without requiring specific brand.",
        "source": "Clinical convention",
    },
    "mr": {
        "canonical_name": "MR (Measles-Rubella)",
        "manufacturer": "Various",
        "components": ["Measles", "Rubella"],
        "combination_type": "MR",
        "stiko_equivalent": "MR — does NOT cover Mumps",
        "notes": "Older Egyptian cards may show MR at 9 months instead of MMR. Counts for Measles and Rubella only; Mumps component is missing.",
        "source": "Clinical convention",
    },
    # Varicella
    "varilrix": {
        "canonical_name": "Varilrix",
        "manufacturer": "GSK",
        "components": ["Varicella"],
        "combination_type": "monovalent",
        "stiko_equivalent": "Varicella",
        "source": "EMA SmPC",
    },
    "varivax": {
        "canonical_name": "Varivax",
        "manufacturer": "MSD",
        "components": ["Varicella"],
        "combination_type": "monovalent",
        "stiko_equivalent": "Varicella",
        "source": "EMA SmPC",
    },
    "varicella": {
        "canonical_name": "Varicella (generic)",
        "manufacturer": "Various",
        "components": ["Varicella"],
        "combination_type": "monovalent",
        "stiko_equivalent": "Varicella",
        "source": "Clinical convention",
    },
    # MMR-V (combined)
    "priorix-tetra": {
        "canonical_name": "Priorix-Tetra",
        "manufacturer": "GSK",
        "components": ["Measles", "Mumps", "Rubella", "Varicella"],
        "combination_type": "MMRV",
        "stiko_equivalent": "MMRV (counts for both MMR and Varicella)",
        "source": "EMA SmPC",
    },
    "proquad": {
        "canonical_name": "ProQuad",
        "manufacturer": "MSD",
        "components": ["Measles", "Mumps", "Rubella", "Varicella"],
        "combination_type": "MMRV",
        "stiko_equivalent": "MMRV (counts for both MMR and Varicella)",
        "source": "EMA SmPC",
    },
    # Rotavirus
    "rotarix": {
        "canonical_name": "Rotarix",
        "manufacturer": "GSK",
        "components": ["Rotavirus"],
        "combination_type": "monovalent",
        "stiko_equivalent": "Rotavirus (2-dose series)",
        "notes": "2-dose oral vaccine. Series complete after dose 2.",
        "source": "EMA SmPC",
    },
    "rotateq": {
        "canonical_name": "RotaTeq",
        "manufacturer": "MSD",
        "components": ["Rotavirus"],
        "combination_type": "pentavalent oral",
        "stiko_equivalent": "Rotavirus (3-dose series)",
        "notes": "3-dose oral vaccine. Series complete after dose 3.",
        "source": "EMA SmPC",
    },
    # Pneumococcal
    "prevenar 13": {
        "canonical_name": "Prevenar 13",
        "manufacturer": "Pfizer",
        "components": ["PCV"],
        "combination_type": "PCV13",
        "stiko_equivalent": "PCV (13-valent)",
        "source": "EMA SmPC",
    },
    "prevenar13": {
        "canonical_name": "Prevenar 13",
        "manufacturer": "Pfizer",
        "components": ["PCV"],
        "combination_type": "PCV13",
        "stiko_equivalent": "PCV (13-valent)",
        "source": "EMA SmPC",
    },
    "synflorix": {
        "canonical_name": "Synflorix",
        "manufacturer": "GSK",
        "components": ["PCV"],
        "combination_type": "PCV10",
        "stiko_equivalent": "PCV (10-valent) — STIKO accepts PCV10 or PCV13",
        "source": "EMA SmPC",
    },
    "prevenar 20": {
        "canonical_name": "Prevenar 20",
        "manufacturer": "Pfizer",
        "components": ["PCV"],
        "combination_type": "PCV20",
        "stiko_equivalent": "PCV (20-valent) — accepted by STIKO from 2024",
        "source": "EMA SmPC",
    },
}


def _normalise(name: str) -> str:
    return name.lower().strip()


@tool(
    "lookup_vaccine_equivalence",
    "Look up a vaccine trade name and return its antigen components. Use this to determine what antigens a named vaccine on a vaccination card actually covers, before checking whether those antigens satisfy the target-country schedule. Returns components list, combination type, and a cross-reference mapping.",
    {"vaccine_name": str, "target_country": str},
)
async def lookup_vaccine_equivalence(args: dict) -> dict:
    name = args.get("vaccine_name", "")
    target_country = args.get("target_country", "Egypt")
    key = _normalise(name)

    entry = VACCINE_DB.get(key)

    if entry is None:
        # Fuzzy: try substring match
        for db_key, db_val in VACCINE_DB.items():
            if key in db_key or db_key in key:
                entry = db_val
                break

    if entry is None:
        result = {
            "vaccine_name": name,
            "found": False,
            "message": f"'{name}' not found in Hathor vaccine database. The agent should flag this for manual verification.",
            "suggestion": "Check if the trade name is an abbreviation or alternate spelling. Consider looking up the batch number or manufacturer on the card.",
        }
    else:
        result = {
            "vaccine_name": name,
            "found": True,
            "target_country": target_country,
            **entry,
        }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
