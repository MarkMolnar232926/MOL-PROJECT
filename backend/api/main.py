"""FastAPI wrapper around the recon engine (PLAN.md section 7.3)."""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from recon import (
    AppConfig,
    InputFile,
    InvalidFileError,
    ReconError,
    default_config,
    load_inputs,
    normalize,
    validate_tie_assignments,
)
from recon.export import export_filename, export_workbook
from recon.models import ManualDecision, TieGroup

from .schemas import (
    ConfigResponse,
    DetectedSheet,
    ErrorResponse,
    HealthResponse,
    SessionCreated,
    SessionResult,
    TieDecisionRequest,
)
from .sessions import InMemorySessionStore, Session, SessionStore

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
log = logging.getLogger("recon.api")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: list | None = None):
        self.status, self.code, self.message, self.details = status, code, message, details or []


def _error(status: int, code: str, message: str, details: list | None = None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details or []}}
    return JSONResponse(status_code=status, content=body)


ERRORS = {
    404: {"model": ErrorResponse, "description": "Unknown session or tie group"},
    422: {"model": ErrorResponse, "description": "Invalid input"},
}


def _detected(session: Session) -> list[DetectedSheet]:
    loaded = session.data.loaded
    return [
        DetectedSheet(
            source=sheet.source,
            file_name=sheet.file_name,
            sheet_name=sheet.sheet_name,
            detected_by=sheet.detected_by,
            row_count=sheet.row_count,
            missing_optional_columns=sheet.missing_optional,
        )
        for sheet in (loaded.physical, loaded.sap)
    ]


async def _read_upload(upload: UploadFile, role: str | None) -> InputFile:
    name = upload.filename or "upload.xlsx"
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(
            413,
            "file_too_large",
            f"'{name}' is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            [{"file": name}],
        )
    return InputFile(name=name, data=data, role=role)  # type: ignore[arg-type]


def create_app(store: SessionStore | None = None, cfg: AppConfig | None = None) -> FastAPI:
    app = FastAPI(
        title="Inventory Reconciliation API",
        version="0.4.0",
        description="Match a physical stocktake against an SAP export and fill in Asset IDs.",
    )
    app.state.store = store if store is not None else InMemorySessionStore()
    app.state.cfg = cfg if cfg is not None else default_config()
    router = APIRouter(prefix="/api")

    def get_store() -> SessionStore:
        return app.state.store

    def get_session(session_id: str, store: SessionStore = Depends(get_store)) -> Session:
        session = store.get(session_id)
        if session is None:
            raise ApiError(
                404, "session_not_found", "This session does not exist or has expired (2 h idle)."
            )
        return session

    def find_group(session: Session, group_id: str) -> TieGroup:
        for g in session.result.tie_groups:
            if g.group_id == group_id:
                return g
        raise ApiError(404, "tie_group_not_found", f"Tie group '{group_id}' does not exist.")

    def result_of(session: Session) -> SessionResult:
        return SessionResult(
            **dict(session.result),
            session_id=session.session_id,
            detected=_detected(session),
        )

    # -- exception mapping: always structured JSON, never a stack trace --

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return _error(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(ReconError)
    async def _recon_error(_: Request, exc: ReconError):
        return _error(422, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(x) for x in e.get("loc", [])), "problem": e.get("msg", "")}
            for e in exc.errors()
        ]
        return _error(422, "invalid_request", "The request is not valid.", details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        return _error(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception):
        log.exception("unexpected error", exc_info=exc)
        return _error(500, "internal_error", "Something went wrong on the server.")

    # -- endpoints --

    @router.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @router.get("/config", response_model=ConfigResponse)
    def get_config() -> ConfigResponse:
        c: AppConfig = app.state.cfg
        return ConfigResponse(
            rules_version=c.type_rules.version,
            type_rules=c.type_rules.rules,
            locations=c.locations,
            cost_weights=c.matching.cost_weights,
            excluded_statuses=c.matching.excluded_statuses,
        )

    @router.post(
        "/sessions",
        response_model=SessionCreated,
        status_code=201,
        responses={**ERRORS, 413: {"model": ErrorResponse, "description": "File too large"}},
        summary="Upload one workbook, or physical + SAP files, and run matching",
    )
    async def create_session(
        workbook: UploadFile | None = File(None, description="One workbook with both sheets"),
        physical: UploadFile | None = File(None, description="Physical_Inventory file"),
        sap: UploadFile | None = File(None, description="SAP_Export file"),
        store: SessionStore = Depends(get_store),
    ) -> SessionCreated:
        if workbook is not None and physical is None and sap is None:
            files = [await _read_upload(workbook, None)]
        elif workbook is None and physical is not None and sap is not None:
            files = [await _read_upload(physical, "physical"), await _read_upload(sap, "sap")]
        else:
            raise InvalidFileError(
                "Upload either one file as 'workbook', or two files as 'physical' and 'sap'."
            )
        c: AppConfig = app.state.cfg
        session = store.create(normalize(load_inputs(files, c), c), c)
        return SessionCreated(
            session_id=session.session_id,
            detected=_detected(session),
            warnings=session.result.warnings,
            summary=session.result.summary,
        )

    @router.get("/sessions/{session_id}/result", response_model=SessionResult, responses=ERRORS)
    def get_result(session: Session = Depends(get_session)) -> SessionResult:
        return result_of(session)

    @router.put("/sessions/{session_id}/ties/{group_id}", response_model=TieGroup, responses=ERRORS)
    def decide_tie(
        group_id: str,
        body: TieDecisionRequest,
        session: Session = Depends(get_session),
        store: SessionStore = Depends(get_store),
    ) -> TieGroup:
        group = find_group(session, group_id)
        validate_tie_assignments(group, body.assignments)
        proposed = {s.sap_row: s.suggested_asset_id for s in group.slots}
        now = dt.datetime.now(dt.UTC)
        changing = {a.sap_row for a in body.assignments}
        session.decisions = [d for d in session.decisions if d.sap_row not in changing] + [
            ManualDecision(
                group_id=group_id,
                sap_row=a.sap_row,
                asset_id=a.physical_asset_id,
                proposed_asset_id=proposed[a.sap_row],
                decided_at=now,
            )
            for a in body.assignments
        ]
        session.rerun()
        store.save(session)
        return find_group(session, group_id)

    @router.delete(
        "/sessions/{session_id}/ties/{group_id}", response_model=TieGroup, responses=ERRORS
    )
    def reset_tie(
        group_id: str,
        session: Session = Depends(get_session),
        store: SessionStore = Depends(get_store),
    ) -> TieGroup:
        """Forget the decisions for this group; its slots go back to the suggestion."""
        rows = set(find_group(session, group_id).sap_rows)
        session.decisions = [d for d in session.decisions if d.sap_row not in rows]
        session.rerun()
        store.save(session)
        return find_group(session, group_id)

    @router.get(
        "/sessions/{session_id}/export",
        responses={
            **ERRORS,
            200: {"content": {XLSX_MEDIA_TYPE: {}}, "description": "The reconciled workbook"},
        },
        response_class=Response,
    )
    def export(session: Session = Depends(get_session)) -> Response:
        name = export_filename()
        body = export_workbook(session.data.loaded, session.result)
        return Response(
            content=body,
            media_type=XLSX_MEDIA_TYPE,
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    @router.delete("/sessions/{session_id}", status_code=204, responses=ERRORS)
    def delete_session(
        session: Session = Depends(get_session), store: SessionStore = Depends(get_store)
    ) -> Response:
        store.delete(session.session_id)
        return Response(status_code=204)

    app.include_router(router)
    return app


app = create_app()
