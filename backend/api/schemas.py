"""Request/response bodies of the REST API (the engine's models are reused where possible)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from recon.config import Location, ScoringConfig, TypeRule
from recon.intake import IncomingSummary, OriginalSummary, SheetInfo
from recon.match_models import MatchResult, NoMatchReason


class HealthResponse(BaseModel):
    status: str


class ConfigResponse(BaseModel):
    rules_version: str
    type_rules: list[TypeRule]
    locations: list[Location]
    scoring: ScoringConfig
    excluded_statuses: list[str]


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
        description="True if an incoming list (and its decisions) existed and was discarded."
    )


class IncomingUploaded(BaseModel):
    session_id: str
    incoming: IncomingUpload
    discarded_decisions: bool = Field(
        description="True if an earlier matching result (and its decisions) was discarded."
    )


class SessionResult(MatchResult):
    session_id: str


class AssignmentRequest(BaseModel):
    asset_id: str | None = Field(
        description="Asset ID from the original inventory; null = the item has no existing pair."
    )
    reason: NoMatchReason | None = Field(
        None, description="Required when asset_id is null; 'other' also needs a note."
    )
    note: str | None = None
    confirm_swap: bool = Field(
        False, description="Take the unit even if another row holds it (that row is released)."
    )


class AssignmentResponse(BaseModel):
    row: int
    released_row: int | None = Field(
        description="Row that lost its unit in a swap and is back among the items to resolve."
    )
    result: SessionResult


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[dict[str, Any]] = []


class ErrorResponse(BaseModel):
    error: ErrorBody
