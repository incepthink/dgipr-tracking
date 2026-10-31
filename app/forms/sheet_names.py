"""How the admin's workbook spells divisions and offices (the names in its डेटा एंट्री and roll-up sheets).

Exports write these spellings so the workbook looks exactly like the one built by hand; scripts/import_sheet.py
reads with them. Office names in exports are the registry's official ones (जिमाका, पुणे …); code_for reads either
spelling, so a workbook exported from here imports back."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

# (sheet division, sheet office) -> office code. Spelled exactly as in the workbook.
OFFICE_MAP: dict[tuple[str, str], str] = {
    ("नागपूर", "नागपूर संचालक"): "nagpur_rio",
    ("नागपूर", "भंडारा"): "bhandara",
    ("नागपूर", "गोंदिया"): "gondia",
    ("नागपूर", "वर्धा"): "wardha",
    ("नागपूर", "नागपूर"): "nagpur",
    ("नागपूर", "चंद्रपूर"): "chandrapur",
    ("नागपूर", "गडचिरोली"): "gadchiroli",
    ("पुणे", "पुणे विमाका"): "pune_rio",
    ("पुणे", "पुणे"): "pune",
    ("पुणे", "सोलापूर"): "solapur",
    ("पुणे", "सातारा"): "satara",
    ("छत्रपती संभाजीनगर", "छ.संभाजीनगर विमाका"): "chh_sambhajinagar_rio",
    ("छत्रपती संभाजीनगर", "छत्रपती संभाजीनगर"): "chh_sambhajinagar",
    ("छत्रपती संभाजीनगर", "जालना"): "jalna",
    ("छत्रपती संभाजीनगर", "परभणी"): "parbhani",
    ("छत्रपती संभाजीनगर", "बीड"): "beed",
    ("कोंकण", "कोकण विमाका"): "konkan_rio",
    ("कोंकण", "रायगड"): "raigad",
    ("कोंकण", "ठाणे"): "thane",
    ("कोंकण", "रत्नागिरी"): "ratnagiri",
    ("कोंकण", "पालघर"): "palghar",
    ("कोल्हापूर", "कोल्हापूर विमाका"): "kolhapur_rio",
    ("कोल्हापूर", "कोल्हापूर"): "kolhapur",
    ("कोल्हापूर", "सांगली"): "sangli",
    ("कोल्हापूर", "सिंधुदुर्ग"): "sindhudurg",
    ("नाशिक", "नाशिक विमाका"): "nashik_rio",
    ("नाशिक", "नाशिक"): "nashik",
    ("नाशिक", "अहिल्यानगर"): "ahilyanagar",
    ("नाशिक", "जळगाव"): "jalgaon",
    ("नाशिक", "धुळे"): "dhule",
    ("नाशिक", "नंदूरबार"): "nandurbar",
    ("अमरावती", "अमरावती विमाका"): "amravati_rio",
    ("अमरावती", "अमरावती"): "amravati",
    ("अमरावती", "अकोला"): "akola",
    ("अमरावती", "वाशिम"): "washim",
    ("अमरावती", "बुलढाणा"): "buldhana",
    ("अमरावती", "यवतमाळ"): "yavatmal",
    ("लातूर", "लातूर विमाका"): "latur_rio",
    ("लातूर", "लातूर"): "latur",
    ("लातूर", "धाराशिव"): "dharashiv",
    ("लातूर", "नांदेड"): "nanded",
    ("लातूर", "हिंगोली"): "hingoli",
    ("मुंबई", "मुख्यालय, मुंबई"): "mumbai_hq",
}

BY_CODE: dict[str, tuple[str, str]] = {code: names for names, code in OFFICE_MAP.items()}


def division_name(division_code: str, office_codes: list[str], fallback: str) -> str:
    """The sheet's name for a division, taken from any of its offices."""
    return next((BY_CODE[c][0] for c in office_codes if c in BY_CODE), fallback)


def office_names(office_code: str, division_fallback: str, office_fallback: str) -> tuple[str, str]:
    return BY_CODE.get(office_code, (division_fallback, office_fallback))


@lru_cache(maxsize=1)
def _official() -> dict[str, str]:
    """Registry name_mr -> office code, from config/organisation.yaml."""
    import yaml
    data = yaml.safe_load((Path(__file__).resolve().parents[2] / "config" / "organisation.yaml").read_text("utf-8"))
    return {o["name_mr"]: o["code"] for d in data["divisions"] for o in d["offices"]}


def code_for(division: str, office: str) -> Optional[str]:
    """Office code for a workbook row: the old sheet spelling, else the registry's official name."""
    return OFFICE_MAP.get((division, office)) or _official().get(office)
