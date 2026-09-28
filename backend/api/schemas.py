"""Request/response bodies of the REST API (the engine's models are reused where possible)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from recon.config import CostWeights, Location, TypeRule
from recon.intake import IncomingSummary, OriginalSummary, SheetInfo
from recon.loader import DetectedBy
from recon.messages import Note
from recon.models import ReconResult, Summary, TieAssignment


class HealthResponse(BaseModel):
    status: str


class ConfigResponse(BaseModel):
    rules_version: str
    type_rules: list[TypeRule]
    locations: list[Location]
    cost_weights: CostWeights
    excluded_statuses: list[str]


class DetectedSheet(BaseModel):
    source: Literal["physical", "sap"]
    file_name: str
    sheet_name: str
    detected_by: DetectedBy
    row_count: int
    missing_optional_columns: list[str]


class OriginalUpload(BaseModel):
    sheet: SheetInfo
    summary: OriginalSummary


class IncomingUpload(BaseModel):
    sheet: SheetInfo
    summary: IncomingSummary


class SessionState(BaseModel):
    """Where a session is in the upload → match flow."""

    session_id: str
    original: OriginalUpload | None
    incoming: IncomingUpload | None
    matched: bool


class OriginalUploaded(BaseModel):
    session_id: str
    original: OriginalUpload
    discarded_later_steps: bool = Field(
        description="True if an incoming list and/or decisions existed and were discarded."
    )


class IncomingUploaded(BaseModel):
    session_id: str
    incoming: IncomingUpload
    discarded_decisions: bool
    summary: Summary  # matching summary (matching runs right after the upload)
    warnings: list[Note]


class SessionCreated(BaseModel):
    """Response of the legacy one-shot upload (removed in phase 5)."""

    session_id: str
    detected: list[DetectedSheet]
    warnings: list[Note]
    summary: Summary


class SessionResult(ReconResult):
    session_id: str
    detected: list[DetectedSheet]


class TieDecisionRequest(BaseModel):
    assignments: list[TieAssignment] = Field(
        description="One entry per SAP row to decide; physical_asset_id null = leave unmatched."
    )


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[dict[str, Any]] = []


class ErrorResponse(BaseModel):
    error: ErrorBody
