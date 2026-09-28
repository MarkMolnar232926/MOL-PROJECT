"""Result models of the score-based matching (change request v2, sections 3–5)."""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

from pydantic import BaseModel, Field

from .messages import Note


class RowStatus(StrEnum):
    """Status of one incoming row (section 4)."""

    AUTO = "auto"  # unique, high-score pair
    AUTO_NEWEST = "auto_newest"  # equal-score tie, resolved by the newest activation date
    LOCATION_MISMATCH = "location_mismatch"  # paired, but City and Building differ
    MANUAL = "manual"  # chosen by the user
    NO_MATCH = "no_match"  # the user confirmed there is no existing unit (with a reason)
    NO_CANDIDATE = "no_candidate"  # unresolved: no candidate reaches the threshold
    DUPLICATE = "duplicate"  # unresolved: repeats an earlier row of the incoming file


RESOLVED_STATUSES = frozenset(
    {
        RowStatus.AUTO,
        RowStatus.AUTO_NEWEST,
        RowStatus.LOCATION_MISMATCH,
        RowStatus.MANUAL,
        RowStatus.NO_MATCH,
    }
)


class NoMatchReason(StrEnum):
    MISSING = "missing_asset"  # missing / not found
    NEW = "new_asset"  # new asset, not in the inventory yet
    DUPLICATE = "duplicate_entry"  # double data entry
    OTHER = "other"  # needs a note


class Criterion(StrEnum):
    TYPE = "type"
    COLOR = "color"
    SIZE = "size"
    LOCATION = "location"
    MATERIAL = "material"


class CriterionCheck(BaseModel):
    criterion: Criterion
    weight: float
    evaluable: bool  # False: this pair gives nothing to compare (left out of the score)
    match: bool | None  # None when not evaluable
    existing: str | None  # the value on the existing unit, for display
    incoming: str | None  # the value on the incoming row


class ExistingItem(BaseModel):
    """A unit of the original inventory (one per Asset ID)."""

    excel_row: int
    asset_id: str
    item_name: str | None
    description: str | None
    sap_type: str | None  # classification by the type rules
    color: str | None
    width_cm: int | None
    size_word: str | None
    materials: list[str]  # material keywords found in the description
    city: str | None
    building: str | None
    custodian: str | None
    activation_date: dt.date | None
    deactivation_date: dt.date | None
    status: str | None
    defective: bool


class IncomingItem(BaseModel):
    excel_row: int
    asset_id: str | None  # as uploaded (normally empty)
    asset_group: str | None
    asset_category: str | None
    item_name: str | None
    color: str | None
    material: str | None
    width_cm: int | None
    height_cm: int | None
    depth_cm: int | None
    serial_no: str | None
    remarks: str | None
    qr_code: str | None
    building: str | None
    city: str | None
    duplicate_of: int | None


class Candidate(BaseModel):
    existing: ExistingItem
    score: float  # 0-100
    checks: list[CriterionCheck]
    hard_ok: bool  # type, colour and size agree
    qr_match: bool  # the incoming QR code names this Asset ID
    paired_row: int | None  # incoming row this unit is assigned to now, if any


class IncomingResult(BaseModel):
    item: IncomingItem
    status: RowStatus
    resolved: bool
    asset_id: str | None  # the Asset ID to write into the incoming file (None = leave empty)
    existing_row: int | None  # original-inventory row of that unit
    score: float | None
    checks: list[CriterionCheck] = Field(default_factory=list)
    location_mismatch: bool = False
    tie_resolved: bool = False  # the automatic pair was chosen by the newest-date rule (3.2)
    auto_asset_id: str | None = None  # the automatic suggestion, kept when overridden
    reason: NoMatchReason | None = None
    note: str | None = None
    notes: list[Note] = Field(default_factory=list)


class LogAction(StrEnum):
    ASSIGN = "assign"
    NO_MATCH = "no_match"
    RESET = "reset"
    RELEASED = "released"  # lost its unit to another row (swap)


class LogEntry(BaseModel):
    at: dt.datetime
    row: int
    action: LogAction
    old_asset_id: str | None
    new_asset_id: str | None
    reason: NoMatchReason | None = None
    note: str | None = None


class MatchSummary(BaseModel):
    incoming_rows: int
    existing_units: int
    resolved: int
    unresolved: int
    status_counts: dict[str, int]  # RowStatus value -> rows
    location_mismatches: int
    tie_resolved: int
    unpaired_existing: int
    auto_match_threshold: float
    export_ready: bool


class MatchResult(BaseModel):
    summary: MatchSummary
    rows: list[IncomingResult]
    unpaired_existing: list[ExistingItem]  # context panel: units with no incoming row
    log: list[LogEntry]
    warnings: list[Note]
