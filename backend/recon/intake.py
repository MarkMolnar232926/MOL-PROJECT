"""The two uploads of a session: the original inventory, then the incoming furniture list.

Each upload is read with ``load_source``, normalised, and summarised for the user before
matching starts. The uploaded bytes are kept unchanged: the original inventory is only ever
read, and the incoming file is later written back with nothing but its Asset ID cells filled.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import pandas as pd
from pydantic import BaseModel, Field

from .config import AppConfig, Source, default_config
from .loader import EXCEL_ROW, DetectedBy, InputFile, LoadedInput, SheetData, load_source
from .messages import Param
from .normalize import Issue, NormalizedInput, normalize_physical, normalize_sap


@dataclass
class SourceUpload:
    """One uploaded file, the sheet read from it and its normalised rows."""

    file: InputFile
    sheet: SheetData
    frame: pd.DataFrame
    issues: list[Issue] = field(default_factory=list)


def read_upload(
    file: InputFile, source: Source, sheet: str | None = None, cfg: AppConfig | None = None
) -> SourceUpload:
    cfg = cfg or default_config()
    data = load_source(file, source, sheet, cfg)
    normalizer = normalize_physical if source == "physical" else normalize_sap
    frame, issues = normalizer(data, cfg)
    return SourceUpload(file=file, sheet=data, frame=frame, issues=issues)


def combine(original: SourceUpload, incoming: SourceUpload) -> NormalizedInput:
    """Both uploads as the engine's input."""
    return NormalizedInput(
        physical=original.frame,
        sap=incoming.frame,
        loaded=LoadedInput(physical=original.sheet, sap=incoming.sheet),
        issues=original.issues + incoming.issues,
    )


# --- summaries shown after each upload ------------------------------------------------------


class SheetInfo(BaseModel):
    file_name: str
    sheet_name: str
    detected_by: DetectedBy
    sheets_available: list[str]
    row_count: int
    missing_optional_columns: list[str]


class RowIssue(BaseModel):
    row: int | None
    code: str
    params: dict[str, Param] = Field(default_factory=dict)
    message: str


class LocationCount(BaseModel):
    location: str  # City (original) or Building (incoming) as written in the file
    building: str | None  # mapped building code, None if unknown
    rows: int


class RepeatedValue(BaseModel):
    value: str
    rows: list[int]


class DuplicateRow(BaseModel):
    row: int
    duplicate_of: int


class OriginalSummary(BaseModel):
    rows: int
    locations: list[LocationCount]
    duplicate_asset_ids: list[RepeatedValue]  # Asset IDs on more than one row
    duplicate_rows: list[DuplicateRow]  # rows identical to an earlier row
    defective_rows: list[int]
    issues: list[RowIssue]


class IncomingSummary(BaseModel):
    rows: int
    locations: list[LocationCount]
    item_types: int
    duplicate_rows: list[DuplicateRow]
    prefilled_asset_ids: list[int]  # rows whose Asset ID is already filled (will be overwritten)
    issues: list[RowIssue]


def sheet_info(upload: SourceUpload) -> SheetInfo:
    s = upload.sheet
    return SheetInfo(
        file_name=s.file_name,
        sheet_name=s.sheet_name,
        detected_by=s.detected_by,
        sheets_available=s.sheets_available or [s.sheet_name],
        row_count=s.row_count,
        missing_optional_columns=s.missing_optional,
    )


def find_duplicate_rows(sheet: SheetData) -> dict[int, int]:
    """Map excel_row -> excel_row of the first identical row (all original columns equal)."""
    first_seen: dict[tuple, int] = {}
    dup_of: dict[int, int] = {}
    cols = [c for c in sheet.frame.columns if c != EXCEL_ROW]
    for values, excel_row in zip(
        sheet.frame[cols].itertuples(index=False, name=None), sheet.frame[EXCEL_ROW], strict=True
    ):
        key = tuple(None if pd.isna(v) else v for v in values)
        if key in first_seen:
            dup_of[int(excel_row)] = first_seen[key]
        else:
            first_seen[key] = int(excel_row)
    return dup_of


def _issues(upload: SourceUpload) -> list[RowIssue]:
    return [
        RowIssue(row=i.excel_row, code=i.code, params=i.note.params, message=i.message)
        for i in upload.issues
    ]


def _locations(frame: pd.DataFrame, col: str) -> list[LocationCount]:
    counts: Counter[tuple[str, str | None]] = Counter(
        (str(r[col]) if r[col] else "(empty)", r["building"]) for r in frame.to_dict("records")
    )
    return [
        LocationCount(location=loc, building=b, rows=n) for (loc, b), n in sorted(counts.items())
    ]


def _duplicates(sheet: SheetData) -> list[DuplicateRow]:
    return [
        DuplicateRow(row=r, duplicate_of=f) for r, f in sorted(find_duplicate_rows(sheet).items())
    ]


def summarize_original(upload: SourceUpload, cfg: AppConfig | None = None) -> OriginalSummary:
    cfg = cfg or default_config()
    frame = upload.frame
    excluded = {s.casefold() for s in cfg.matching.excluded_statuses}
    by_id: dict[str, list[int]] = defaultdict(list)
    defective: list[int] = []
    for r in frame.to_dict("records"):
        if r["asset_id"]:
            by_id[r["asset_id"]].append(r[EXCEL_ROW])
        if r["status"] and r["status"].casefold() in excluded:
            defective.append(r[EXCEL_ROW])
    return OriginalSummary(
        rows=len(frame),
        locations=_locations(frame, "city"),
        duplicate_asset_ids=[
            RepeatedValue(value=v, rows=rows) for v, rows in sorted(by_id.items()) if len(rows) > 1
        ],
        duplicate_rows=_duplicates(upload.sheet),
        defective_rows=defective,
        issues=_issues(upload),
    )


def summarize_incoming(upload: SourceUpload) -> IncomingSummary:
    frame = upload.frame
    records = frame.to_dict("records")
    return IncomingSummary(
        rows=len(frame),
        locations=_locations(frame, "building"),
        item_types=len({r["item_name"] for r in records if r["item_name"]}),
        duplicate_rows=_duplicates(upload.sheet),
        prefilled_asset_ids=[r[EXCEL_ROW] for r in records if r["asset_id"]],
        issues=_issues(upload),
    )
