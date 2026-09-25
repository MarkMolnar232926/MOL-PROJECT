"""Result models of a reconciliation run (PLAN.md section 7.1)."""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

from pydantic import BaseModel, Field, computed_field


class MatchStatus(StrEnum):
    MATCHED = "Matched"
    LOCATION_MISMATCH = "Matched – location mismatch"
    NEEDS_DECISION = "Needs decision"
    MANUAL = "Manually resolved"
    PHYSICAL_ONLY = "Physical only"
    SAP_ONLY = "SAP only"
    DEFECTIVE = "Defective – excluded"
    DUPLICATE = "Duplicate entry"
    UNCLASSIFIED = "Unclassified"


class Confidence(StrEnum):
    HIGH = "High"
    HIGH_QR = "High (QR)"
    MEDIUM = "Medium"
    MANUAL = "Manual"
    NEEDS_DECISION = "Needs decision"


class DiscrepancyKind(StrEnum):
    PHYSICAL_ONLY = "Physical only"
    SAP_ONLY = "SAP only"
    DUPLICATE = "Duplicate"
    LOCATION_MISMATCH = "Location mismatch"
    UNCLASSIFIED = "Unclassified"
    UNRESOLVED_TIE = "Unresolved tie"
    DEACTIVATED = "Deactivated warning"
    QR_DISAGREEMENT = "QR disagreement"
    YEAR_GAP = "Year gap"
    DATA_QUALITY = "Data quality"


class PhysicalRow(BaseModel):
    excel_row: int
    asset_id: str | None
    item_name: str | None
    description: str | None
    color: str | None
    width_cm: int | None
    size_word: str | None
    city: str | None
    building: str | None
    custodian: str | None
    activation_date: dt.date | None
    deactivation_date: dt.date | None
    gross_value: float | None
    status: str | None  # the sheet's own Status text
    sap_type: str | None  # classification result
    match_status: MatchStatus
    confidence: Confidence | None = None
    matched_sap_row: int | None = None
    tie_group_id: str | None = None
    duplicate_of: int | None = None
    notes: list[str] = Field(default_factory=list)


class SapRow(BaseModel):
    excel_row: int
    item_name: str | None
    color: str | None
    material: str | None
    width_cm: int | None
    serial_no: str | None
    serial_year: int | None
    building: str | None
    city: str | None
    remarks: str | None
    qr_code: str | None
    qr_asset_id: str | None
    asset_id: str | None  # final value to write into SAP (empty while a decision is pending)
    suggested_asset_id: str | None = None  # tie suggestion, never written on export
    match_status: MatchStatus
    confidence: Confidence | None = None
    matched_physical_row: int | None = None
    qr_agrees: bool | None = None
    tie_group_id: str | None = None
    duplicate_of: int | None = None
    notes: list[str] = Field(default_factory=list)


class Pair(BaseModel):
    """A physical↔SAP pairing, including provisional tie suggestions."""

    sap_row: int
    physical_row: int
    asset_id: str
    confidence: Confidence
    location_mismatch: bool
    year_gap: int | None
    tie_group_id: str | None = None
    provisional: bool = False  # True for an unconfirmed tie suggestion


class TieAssignment(BaseModel):
    sap_row: int
    physical_asset_id: str | None


class TieSlot(BaseModel):
    sap_row: int
    serial_no: str | None
    building: str | None
    remarks: str | None
    qr_code: str | None
    suggested_asset_id: str | None
    chosen_asset_id: str | None = None
    decided: bool = False
    confidence: Confidence


class TieCandidate(BaseModel):
    physical_row: int
    asset_id: str
    activation_date: dt.date | None
    city: str | None
    building: str | None
    custodian: str | None
    gross_value: float | None


class TieGroup(BaseModel):
    group_id: str
    sap_type: str
    color: str | None
    width_cm: int | None
    year: int | None
    locations: list[str]
    physical_rows: list[int]
    sap_rows: list[int]
    candidates: list[TieCandidate]
    slots: list[TieSlot]
    proposed_pairs: list[TieAssignment]  # the deterministic FIFO suggestion

    @computed_field
    @property
    def pending_slots(self) -> int:
        return sum(not s.decided for s in self.slots)


class ManualDecision(BaseModel):
    group_id: str
    sap_row: int
    asset_id: str | None
    proposed_asset_id: str | None
    decided_at: dt.datetime


class Discrepancy(BaseModel):
    kind: DiscrepancyKind
    physical_row: int | None = None
    sap_row: int | None = None
    asset_id: str | None = None
    message: str


class QrAssessment(BaseModel):
    column_present: bool
    total_rows: int
    parseable: int
    present_in_physical: int
    compared: int  # fuzzy pairs (QR off) whose SAP row has a parseable QR
    agreeing: int
    compared_outside_ties: int
    agreeing_outside_ties: int
    looks_reliable: bool

    @staticmethod
    def _pct(n: int, d: int) -> float | None:
        return round(100 * n / d, 1) if d else None

    @computed_field
    @property
    def parseable_pct(self) -> float | None:
        return self._pct(self.parseable, self.total_rows)

    @computed_field
    @property
    def present_pct(self) -> float | None:
        return self._pct(self.present_in_physical, self.total_rows)

    @computed_field
    @property
    def agreement_pct(self) -> float | None:
        return self._pct(self.agreeing, self.compared)

    @computed_field
    @property
    def agreement_outside_ties_pct(self) -> float | None:
        return self._pct(self.agreeing_outside_ties, self.compared_outside_ties)


class Summary(BaseModel):
    physical_total: int
    sap_total: int
    pairs: int
    physical_status_counts: dict[str, int]
    sap_status_counts: dict[str, int]
    confidence_counts: dict[str, int]
    location_mismatches: int
    tie_groups: int
    tie_slots: int
    tie_slots_pending: int
    manual_decisions: int
    use_qr: bool
    rules_version: str


class ReconResult(BaseModel):
    summary: Summary
    physical_rows: list[PhysicalRow]
    sap_rows: list[SapRow]
    pairs: list[Pair]
    tie_groups: list[TieGroup]
    discrepancies: list[Discrepancy]
    qr_assessment: QrAssessment
    decisions: list[ManualDecision]
    warnings: list[str]
