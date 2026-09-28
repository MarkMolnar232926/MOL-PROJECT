"""Structured engine errors. The API maps these to JSON; they never carry stack traces."""

from __future__ import annotations

from typing import Any


class ReconError(Exception):
    """Base class for all expected, user-facing engine errors."""

    code = "recon_error"

    def __init__(self, message: str, details: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or []

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


class InvalidFileError(ReconError):
    code = "invalid_file"


class SheetDetectionError(ReconError):
    code = "sheet_not_found"


class MissingColumnsError(ReconError):
    code = "missing_columns"


class SheetChoiceRequiredError(ReconError):
    """Several sheets fit; the user has to say which one to use."""

    code = "sheet_choice_required"


class StepOrderError(ReconError):
    """A step of the upload flow was attempted before the step it depends on."""

    code = "step_order"
