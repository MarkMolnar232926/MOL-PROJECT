"""Request/response bodies of the REST API (the engine's models are reused where possible)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from recon.config import CostWeights, Location, TypeRule
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
    detected_by: Literal["sheet_name", "header_signature"]
    row_count: int
    missing_optional_columns: list[str]


class SessionCreated(BaseModel):
    session_id: str
    detected: list[DetectedSheet]
    warnings: list[str]
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
