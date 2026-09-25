"""Turn raw sheet rows into typed, comparison-ready records (PLAN.md section 6.1)."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

import pandas as pd

from .config import AppConfig, default_config
from .loader import EXCEL_ROW, LoadedInput, SheetData

WIDTH_RE = re.compile(r"(\d+)\s*cm\s+wide", re.IGNORECASE)
SIZE_RE = re.compile(r"\b(small|large)\b", re.IGNORECASE)
SERIAL_YEAR_RE = re.compile(r"SN-(\d{4})-", re.IGNORECASE)
YEAR_FIRST_RE = re.compile(r"^(?P<y>\d{4})[-/.](?P<m>\d{1,2})[-/.](?P<d>\d{1,2})(?:[ T].*)?$")
INT_RE = re.compile(r"^\s*(-?\d+)(?:\.0+)?\s*(?:cm)?\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class DescriptionInfo:
    color: str | None
    width_cm: int | None
    size_word: str | None


@dataclass
class Issue:
    """A data-quality observation made while normalising (never blocks loading)."""

    source: str
    excel_row: int | None
    code: str
    message: str


@dataclass
class NormalizedInput:
    physical: pd.DataFrame
    sap: pd.DataFrame
    loaded: LoadedInput
    issues: list[Issue] = field(default_factory=list)


# --- scalar helpers -------------------------------------------------------------------


def clean_str(value: object) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def parse_description(description: object) -> DescriptionInfo:
    """Colour = last comma token; optional ``NNcm wide``; optional ``small``/``large``."""
    text = clean_str(description)
    if not text:
        return DescriptionInfo(None, None, None)
    tokens = [t.strip() for t in text.split(",") if t.strip()]
    color = tokens[-1].casefold() if tokens else None
    width = WIDTH_RE.search(text)
    size = SIZE_RE.search(text)
    return DescriptionInfo(
        color=color,
        width_cm=int(width.group(1)) if width else None,
        size_word=size.group(1).lower() if size else None,
    )


def parse_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if not pd.isna(value) and value.is_integer() else None
    m = INT_RE.match(str(value))
    return int(m.group(1)) if m else None


def normalize_asset_id(value: object) -> str | None:
    """Asset IDs are compared as digit strings (Excel may hand us 84213492 or 84213492.0)."""
    as_int = parse_int(value)
    if as_int is not None:
        return str(as_int)
    return clean_str(value)


def serial_year(serial: object) -> int | None:
    text = clean_str(serial)
    m = SERIAL_YEAR_RE.search(text) if text else None
    return int(m.group(1)) if m else None


def parse_date(value: object, dayfirst: bool = True) -> pd.Timestamp | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime | dt.date):
        return pd.Timestamp(value)
    if isinstance(value, int | float) and not isinstance(value, bool):
        if pd.isna(value):
            return None
        # Excel serial date (1900 system) stored as a plain number.
        return pd.Timestamp("1899-12-30") + pd.to_timedelta(float(value), unit="D")
    text = clean_str(value)
    if not text:
        return None
    # Year-first text (2021/12/31, 2021-12-31, 2021.12.31) is always year-month-day.
    if m := YEAR_FIRST_RE.match(text):
        try:
            return pd.Timestamp(int(m["y"]), int(m["m"]), int(m["d"]))
        except ValueError:
            return None
    try:
        ts = pd.to_datetime(text, dayfirst=dayfirst)
    except (ValueError, TypeError, OverflowError):
        return None
    return None if pd.isna(ts) else ts


# --- sheet normalisation ----------------------------------------------------------------


def _rows(sheet: SheetData, keys) -> list[dict]:
    """Rows keyed by canonical column key (absent optional columns read as None)."""
    out = []
    for _, raw in sheet.frame.iterrows():
        row = {k: (raw[sheet.column_map[k]] if k in sheet.column_map else None) for k in keys}
        row[EXCEL_ROW] = int(raw[EXCEL_ROW])
        out.append(row)
    return out


def normalize_physical(sheet: SheetData, cfg: AppConfig) -> tuple[pd.DataFrame, list[Issue]]:
    issues: list[Issue] = []
    city_map = cfg.city_to_building()
    site_map = cfg.site_to_building()
    dayfirst = cfg.columns.date_dayfirst
    records = []
    for row in _rows(sheet, cfg.columns.physical.columns):
        excel_row, get = row[EXCEL_ROW], row.get
        desc = parse_description(get("description"))
        city = clean_str(get("city"))
        building = city_map.get(city.casefold()) if city else None
        site_code = normalize_asset_id(get("site_code"))
        site_building = site_map.get(site_code) if site_code else None
        activation = parse_date(get("activation_date"), dayfirst)
        deactivation = parse_date(get("deactivation_date"), dayfirst)
        asset_id = normalize_asset_id(get("asset_id"))

        if city and building is None:
            issues.append(
                Issue(
                    "physical",
                    excel_row,
                    "unknown_city",
                    f"City '{city}' is not in the location mapping.",
                )
            )
        if building and site_building and building != site_building:
            issues.append(
                Issue(
                    "physical",
                    excel_row,
                    "site_city_conflict",
                    f"Site code {site_code} does not belong to city '{city}'.",
                )
            )
        if activation is None:
            issues.append(
                Issue(
                    "physical",
                    excel_row,
                    "bad_activation_date",
                    f"Activation date '{get('activation_date')}' could not be read.",
                )
            )
        if asset_id is None:
            issues.append(Issue("physical", excel_row, "missing_asset_id", "Asset ID is empty."))

        records.append(
            {
                EXCEL_ROW: excel_row,
                "asset_id": asset_id,
                "item_name": (clean_str(get("item_name")) or "").casefold() or None,
                "description": clean_str(get("description")),
                "color": desc.color,
                "width_cm": desc.width_cm,
                "size_word": desc.size_word,
                "city": city,
                "building": building,
                "site_code": site_code,
                "custodian": clean_str(get("custodian")),
                "activation_date": activation,
                "activation_year": activation.year if activation is not None else None,
                "deactivation_date": deactivation,
                "gross_value": get("gross_value"),
                "monthly_depr": get("monthly_depr"),
                "status": clean_str(get("status")),
            }
        )
    return _frame(records), issues


def normalize_sap(sheet: SheetData, cfg: AppConfig) -> tuple[pd.DataFrame, list[Issue]]:
    issues: list[Issue] = []
    building_to_city = {loc.building.upper(): loc.city for loc in cfg.locations}
    records = []
    for row in _rows(sheet, cfg.columns.sap.columns):
        excel_row, get = row[EXCEL_ROW], row.get
        building = (clean_str(get("building")) or "").upper() or None
        serial = clean_str(get("serial_no"))
        width = parse_int(get("width_cm"))
        item_name = clean_str(get("item_name"))

        if building and building not in building_to_city:
            issues.append(
                Issue(
                    "sap",
                    excel_row,
                    "unknown_building",
                    f"Building '{building}' is not in the location mapping.",
                )
            )
        if serial_year(serial) is None:
            issues.append(
                Issue(
                    "sap", excel_row, "bad_serial", f"Serial No. '{serial}' has no SN-YYYY- year."
                )
            )
        if width is None and get("width_cm") is not None:
            issues.append(
                Issue(
                    "sap",
                    excel_row,
                    "bad_width",
                    f"Width '{get('width_cm')}' is not a whole number.",
                )
            )

        records.append(
            {
                EXCEL_ROW: excel_row,
                "asset_id": normalize_asset_id(get("asset_id")),
                "asset_group": clean_str(get("asset_group")),
                "asset_category": clean_str(get("asset_category")),
                "item_name": item_name,
                "color": (clean_str(get("color")) or "").casefold() or None,
                "material": clean_str(get("material")),
                "width_cm": width,
                "height_cm": parse_int(get("height_cm")),
                "depth_cm": parse_int(get("depth_cm")),
                "serial_no": serial,
                "serial_year": serial_year(serial),
                "remarks": clean_str(get("remarks")),
                "qr_code": clean_str(get("qr_code")),
                "building": building,
                "city": building_to_city.get(building) if building else None,
            }
        )
    return _frame(records), issues


def _frame(records: list[dict]) -> pd.DataFrame:
    # object dtype keeps ints as ints and missing values as None (no float/NaN coercion).
    return pd.DataFrame(records, dtype=object)


def normalize(loaded: LoadedInput, cfg: AppConfig | None = None) -> NormalizedInput:
    cfg = cfg or default_config()
    physical, p_issues = normalize_physical(loaded.physical, cfg)
    sap, s_issues = normalize_sap(loaded.sap, cfg)
    return NormalizedInput(physical=physical, sap=sap, loaded=loaded, issues=p_issues + s_issues)
