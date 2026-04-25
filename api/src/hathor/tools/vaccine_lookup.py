"""Tool: lookup_vaccine_equivalence — trade name to antigen component mapping."""

import json
from claude_agent_sdk import tool
from hathor.schedules.vaccine_synonyms import lookup_vaccine_synonym

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
        "notes": "Widely used in Egypt and EU. Egypt may use whole-cell pertussis variant; Hexyon is acellular (DTaP). Both satisfy DTP requirement.",
        "source": "EMA SmPC",
    },
    "hexaxim": {
        "canonical_name": "Hexaxim",
        "manufacturer": "Sanofi Pasteur",
        "components": ["DTaP", "IPV", "Hib", "HepB"],
        "combination_type": "hexavalent",
        "source": "EMA SmPC",
    },
    "infanrix hexa": {
        "canonical_name": "Infanrix Hexa",
        "manufacturer": "GSK",
        "components": ["DTaP", "IPV", "Hib", "HepB"],
        "combination_type": "hexavalent",
        "source": "EMA SmPC",
    },
    "vaxelis": {
        "canonical_name": "Vaxelis",
        "manufacturer": "MCM Vaccine / Sanofi-MSD",
        "components": ["DTaP", "IPV", "Hib", "HepB"],
        "combination_type": "hexavalent",
        "source": "EMA SmPC",
    },
    # Pentavalent (DTaP + IPV + Hib — no HepB)
    "pentaxim": {
        "canonical_name": "Pentaxim",
        "manufacturer": "Sanofi Pasteur",
        "components": ["DTaP", "IPV", "Hib"],
        "combination_type": "pentavalent",
        "notes": "Does NOT include HepB. Common on older Egyptian cards before hexavalent was introduced.",
        "source": "EMA SmPC",
    },
    "pentavac": {
        "canonical_name": "Pentavac",
        "manufacturer": "Sanofi Pasteur",
        "components": ["DTaP", "IPV", "Hib"],
        "combination_type": "pentavalent",
        "notes": "Egyptian/MENA market pentavalent. Does NOT include HepB. May appear on Egyptian cards as 'الخماسي'.",
        "source": "Sanofi product data",
    },
    "infanrix ipv+hib": {
        "canonical_name": "Infanrix IPV+Hib",
        "manufacturer": "GSK",
        "components": ["DTaP", "IPV", "Hib"],
        "combination_type": "pentavalent",
        "source": "EMA SmPC",
    },
    # MMR and variants
    "priorix": {
        "canonical_name": "Priorix",
        "manufacturer": "GSK",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "source": "EMA SmPC",
    },
    "mmrvaxpro": {
        "canonical_name": "M-M-RvaxPro",
        "manufacturer": "MSD",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "source": "EMA SmPC",
    },
    "m-m-rvaxpro": {
        "canonical_name": "M-M-RvaxPro",
        "manufacturer": "MSD",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "source": "EMA SmPC",
    },
    "mmr": {
        "canonical_name": "MMR (generic)",
        "manufacturer": "Various",
        "components": ["Measles", "Mumps", "Rubella"],
        "combination_type": "MMR",
        "notes": "Generic MMR notation on Egyptian cards — accept as MMR without requiring specific brand.",
        "source": "Clinical convention",
    },
    "mr": {
        "canonical_name": "MR (Measles-Rubella)",
        "manufacturer": "Various",
        "components": ["Measles", "Rubella"],
        "combination_type": "MR",
        "notes": "Older Egyptian cards may show MR at 9 months instead of MMR. Counts for Measles and Rubella only; Mumps component is missing.",
        "source": "Clinical convention",
    },
    # Varicella
    "varilrix": {
        "canonical_name": "Varilrix",
        "manufacturer": "GSK",
        "components": ["Varicella"],
        "combination_type": "monovalent",
        "source": "EMA SmPC",
    },
    "varivax": {
        "canonical_name": "Varivax",
        "manufacturer": "MSD",
        "components": ["Varicella"],
        "combination_type": "monovalent",
        "source": "EMA SmPC",
    },
    "varicella": {
        "canonical_name": "Varicella (generic)",
        "manufacturer": "Various",
        "components": ["Varicella"],
        "combination_type": "monovalent",
        "source": "Clinical convention",
    },
    # MMR-V (combined)
    "priorix-tetra": {
        "canonical_name": "Priorix-Tetra",
        "manufacturer": "GSK",
        "components": ["Measles", "Mumps", "Rubella", "Varicella"],
        "combination_type": "MMRV",
        "source": "EMA SmPC",
    },
    "proquad": {
        "canonical_name": "ProQuad",
        "manufacturer": "MSD",
        "components": ["Measles", "Mumps", "Rubella", "Varicella"],
        "combination_type": "MMRV",
        "source": "EMA SmPC",
    },
    # Rotavirus
    "rotarix": {
        "canonical_name": "Rotarix",
        "manufacturer": "GSK",
        "components": ["Rotavirus"],
        "combination_type": "monovalent",
        "notes": "2-dose oral vaccine. Series complete after dose 2.",
        "source": "EMA SmPC",
    },
    "rotateq": {
        "canonical_name": "RotaTeq",
        "manufacturer": "MSD",
        "components": ["Rotavirus"],
        "combination_type": "pentavalent oral",
        "notes": "3-dose oral vaccine. Series complete after dose 3.",
        "source": "EMA SmPC",
    },
    # Pneumococcal
    "prevenar 13": {
        "canonical_name": "Prevenar 13",
        "manufacturer": "Pfizer",
        "components": ["PCV"],
        "combination_type": "PCV13",
        "source": "EMA SmPC",
    },
    "prevenar13": {
        "canonical_name": "Prevenar 13",
        "manufacturer": "Pfizer",
        "components": ["PCV"],
        "combination_type": "PCV13",
        "source": "EMA SmPC",
    },
    "synflorix": {
        "canonical_name": "Synflorix",
        "manufacturer": "GSK",
        "components": ["PCV"],
        "combination_type": "PCV10",
        "source": "EMA SmPC",
    },
    "prevenar 20": {
        "canonical_name": "Prevenar 20",
        "manufacturer": "Pfizer",
        "components": ["PCV"],
        "combination_type": "PCV20",
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

    synonym_entry = None
    if entry is None:
        synonym_entry = lookup_vaccine_synonym(name)

    if entry is None and synonym_entry is None:
        result = {
            "vaccine_name": name,
            "found": False,
            "message": f"'{name}' not found in Hathor vaccine database. The agent should flag this for manual verification.",
            "suggestion": "Check if the trade name is an abbreviation or alternate spelling. Consider looking up the batch number or manufacturer on the card.",
        }
    elif synonym_entry is not None:
        result = {
            "vaccine_name": name,
            "found": True,
            "target_country": target_country,
            "canonical_name": synonym_entry["canonical_name"],
            "components": [synonym_entry["canonical_name"]],
            "combination_type": "synonym",
            "antigen": synonym_entry["antigen"],
            "product_label": synonym_entry["product_label"],
            "source": "Hathor African card synonym mapping",
            "notes": "Local card synonym match; verify against the country schedule before clinical use.",
        }
    else:
        result = {
            "vaccine_name": name,
            "found": True,
            "target_country": target_country,
            **entry,
        }

    return {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
