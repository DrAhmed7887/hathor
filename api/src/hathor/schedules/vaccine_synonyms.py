"""Dedicated synonym lookup for common African vaccination-card labels."""

from __future__ import annotations

from typing import Any


VACCINE_SYNONYMS: dict[str, dict[str, Any]] = {
    "bcg": {
        "canonical_name": "BCG",
        "antigen": "Tuberculosis",
        "product_label": "BCG",
        "synonyms": ["BCG", "بي سي جي", "الدرن"],
    },
    "opv": {
        "canonical_name": "OPV",
        "antigen": "Poliomyelitis",
        "product_label": "Oral polio vaccine",
        "synonyms": ["OPV", "شلل الأطفال", "فموي", "VPO"],
    },
    "ipv": {
        "canonical_name": "IPV",
        "antigen": "Poliomyelitis",
        "product_label": "Inactivated polio vaccine",
        "synonyms": ["IPV", "حقن شلل الأطفال", "VPI"],
    },
    "penta": {
        "canonical_name": "Penta",
        "antigen": "Diphtheria-Tetanus-Pertussis-Hepatitis B-Hib",
        "product_label": "DTP-HepB-Hib",
        "synonyms": ["Penta", "Pentavalent", "خماسي", "الطعم الخماسي"],
    },
    "rota": {
        "canonical_name": "Rota",
        "antigen": "Rotavirus",
        "product_label": "Rotavirus vaccine",
        "synonyms": ["Rota", "Rotavirus", "روتا"],
    },
    "pcv": {
        "canonical_name": "PCV",
        "antigen": "Pneumococcal disease",
        "product_label": "Pneumococcal conjugate vaccine",
        "synonyms": ["PCV", "مكورات رئوية"],
    },
    "mr": {
        "canonical_name": "MR",
        "antigen": "Measles-Rubella",
        "product_label": "Measles-rubella vaccine",
        "synonyms": ["MR", "حصبة وحصبة ألمانية", "RR"],
    },
    "mmr": {
        "canonical_name": "MMR",
        "antigen": "Measles-Mumps-Rubella",
        "product_label": "Measles-mumps-rubella vaccine",
        "synonyms": ["MMR"],
    },
    "measles": {
        "canonical_name": "Measles",
        "antigen": "Measles",
        "product_label": "Measles vaccine",
        "synonyms": ["Measles", "VAR"],
    },
    "yellow fever": {
        "canonical_name": "Yellow Fever",
        "antigen": "Yellow fever",
        "product_label": "Yellow fever vaccine",
        "synonyms": ["Yellow Fever", "VAA"],
    },
    "hpv": {
        "canonical_name": "HPV",
        "antigen": "Human papillomavirus",
        "product_label": "HPV vaccine",
        "synonyms": ["HPV", "VPH"],
    },
    "mena": {
        "canonical_name": "MenA",
        "antigen": "Meningococcal A",
        "product_label": "Meningococcal A vaccine",
        "synonyms": ["MenA"],
    },
    "td": {
        "canonical_name": "Td",
        "antigen": "Tetanus-Diphtheria",
        "product_label": "Td vaccine",
        "synonyms": ["Td"],
    },
    "tdap": {
        "canonical_name": "Tdap",
        "antigen": "Tetanus-Diphtheria-Pertussis",
        "product_label": "Tdap vaccine",
        "synonyms": ["Tdap"],
    },
    "hepb": {
        "canonical_name": "HepB",
        "antigen": "Hepatitis B",
        "product_label": "Hepatitis B vaccine",
        "synonyms": ["HepB", "التهاب كبدي ب"],
    },
}


_INDEX: dict[str, dict[str, Any]] = {}
for entry in VACCINE_SYNONYMS.values():
    for synonym in entry["synonyms"]:
        _INDEX[synonym.casefold().strip()] = entry


def lookup_vaccine_synonym(label: str) -> dict[str, Any] | None:
    """Look up a local card label without changing legacy trade-name logic."""

    return _INDEX.get(label.casefold().strip())
