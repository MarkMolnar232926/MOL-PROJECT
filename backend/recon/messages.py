"""Every sentence the engine produces, as a code plus parameters.

The web app translates messages by ``code`` (see frontend/src/i18n); the English ``text`` is
used by the Excel export and as a fallback for clients that do not know a code.
"""

from __future__ import annotations

from collections.abc import Callable

from pydantic import BaseModel, Field

Param = str | int | float | None


def _or(v: Param, fallback: str) -> str:
    return fallback if v is None or v == "" else str(v)


EN: dict[str, Callable[[dict[str, Param]], str]] = {
    # normalisation issues
    "unknown_city": lambda p: f"City '{p['city']}' is not in the location mapping.",
    "site_city_conflict": lambda p: (
        f"Site code {p['site_code']} does not belong to city '{p['city']}'."
    ),
    "bad_activation_date": lambda p: f"Activation date '{p['value']}' could not be read.",
    "missing_asset_id": lambda p: "Asset ID is empty.",
    "unknown_building": lambda p: f"Building '{p['building']}' is not in the location mapping.",
    "bad_serial": lambda p: f"Serial No. '{p['serial']}' has no SN-YYYY- year.",
    "bad_width": lambda p: f"Width '{p['value']}' is not a whole number.",
    # loading
    "files_swapped": lambda p: (
        f"{p['sheet']} was found in '{p['file']}', which was uploaded as the {p['role']} file. "
        "The files may have been swapped."
    ),
    # data quality
    "asset_id_conflict": lambda p: (
        f"Asset ID {p['value']} appears on rows {p['rows']} whose other values differ "
        "(not a plain double entry)."
    ),
    "qr_code_conflict": lambda p: (
        f"QR code {p['value']} appears on rows {p['rows']} whose other values differ "
        "(not a plain double entry)."
    ),
    # duplicates, exclusions, classification
    "sap_duplicate": lambda p: f"Identical to SAP row {p['first']} (double data entry).",
    "physical_duplicate": lambda p: f"Identical to physical row {p['first']} (double data entry).",
    "defective_excluded": lambda p: "Defective – excluded (expected to be absent from SAP).",
    "unclassified_note": lambda p: "No type rule matches this item name and description.",
    "unclassified": lambda p: f"'{p['item']}: {p['description']}' matches no type rule.",
    # leftovers
    "sap_only": lambda p: f"No physical unit found for this {p['item']} (missing / lost asset).",
    "physical_only": lambda p: (
        f"No SAP row found for this {p['sap_type']} (asset {p['asset_id']})."
    ),
    # ties
    "tie_pick": lambda p: (
        f"Tie group {p['group']}: pick the physical unit "
        f"(suggested {_or(p['suggested'], 'leave unmatched')})."
    ),
    "tie_unresolved": lambda p: (
        f"{p['sap_type']} ({_or(p['year'], '?')}) in tie group {p['group']}: the attributes "
        "cannot tell these units apart; a decision is needed "
        f"(suggested: {_or(p['suggested'], 'leave unmatched')})."
    ),
    "tie_candidate": lambda p: f"Candidate in tie group {p['group']}.",
    "manual_unmatched": lambda p: "Manually left unmatched.",
    "manual_left_physical": lambda p: "Left unmatched by the manual tie decisions.",
    "decision_invalid": lambda p: (
        f"Manual decision for SAP row {p['sap_row']} (asset {p['asset_id']}) no longer fits "
        "its tie group and was dropped."
    ),
    "decision_stale": lambda p: (
        f"Manual decision for SAP row {p['sap_row']} was dropped: "
        "that row no longer needs a decision."
    ),
    # pair flags
    "location_mismatch": lambda p: f"Physical says {p['city']}, SAP says {p['building']}.",
    "deactivated": lambda p: "Deactivated but present in SAP (has a deactivation date).",
    "year_gap": lambda p: f"Activation year and serial year differ by {p['gap']}.",
}


class Note(BaseModel):
    """One message: ``code`` + ``params`` for translation, ``text`` in English."""

    code: str
    params: dict[str, Param] = Field(default_factory=dict)
    text: str


def note(code: str, **params: Param) -> Note:
    return Note(code=code, params=params, text=EN[code](params))
