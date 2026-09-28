"""FastAPI wrapper around the recon engine (PLAN.md section 7.3)."""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, FastAPI, File, Form, Request, UploadFile
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
from recon.errors import StepOrderError
from recon.export import export_filename, export_workbook
from recon.intake import (
    SourceUpload,
    read_upload,
    sheet_info,
    summarize_incoming,
    summarize_original,
)
from recon.models import ManualDecision, TieGroup

from .schemas import (
    ConfigResponse,
    DetectedSheet,
    ErrorResponse,
    HealthResponse,
    IncomingUpload,
    IncomingUploaded,
    OriginalUpload,
    OriginalUploaded,
    SessionCreated,
    SessionResult,
    SessionState,
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
STEP_ERRORS = {
    **ERRORS,
    409: {"model": ErrorResponse, "description": "A previous step is not done yet"},
}
UPLOAD_ERRORS = {**STEP_ERRORS, 413: {"model": ErrorResponse, "description": "File too large"}}


def _original(session: Session) -> OriginalUpload | None:
    up = session.original
    if up is None:
        return None
    return OriginalUpload(sheet=sheet_info(up), summary=summarize_original(up, session.cfg))


def _incoming(session: Session) -> IncomingUpload | None:
    up = session.incoming
    if up is None:
        return None
    return IncomingUpload(sheet=sheet_info(up), summary=summarize_incoming(up))


def _state(session: Session) -> SessionState:
    return SessionState(
        session_id=session.session_id,
        original=_original(session),
        incoming=_incoming(session),
        matched=session.matched,
    )


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

    def matched_session(session: Session = Depends(get_session)) -> Session:
        if session.result is None:
            raise StepOrderError(
                "Matching has not run yet: upload the original inventory and the incoming list."
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
        status = 409 if isinstance(exc, StepOrderError) else 422
        return _error(status, exc.code, exc.message, exc.details)

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
        response_model=SessionState | SessionCreated,
        status_code=201,
        responses={**ERRORS, 413: {"model": ErrorResponse, "description": "File too large"}},
        summary="Create an empty session (legacy: upload one workbook or physical + SAP)",
    )
    async def create_session(
        workbook: UploadFile | None = File(None, description="Legacy: one workbook"),
        physical: UploadFile | None = File(None, description="Legacy: Physical_Inventory file"),
        sap: UploadFile | None = File(None, description="Legacy: SAP_Export file"),
        store: SessionStore = Depends(get_store),
    ) -> SessionState | SessionCreated:
        """Without files: a new, empty session; upload the original inventory next.

        The legacy multipart upload (``workbook``, or ``physical`` + ``sap``) still works until
        the new UI replaces it.
        """
        c: AppConfig = app.state.cfg
        if workbook is None and physical is None and sap is None:
            return _state(store.create(c))
        if workbook is not None and physical is None and sap is None:
            files = [await _read_upload(workbook, None)]
        elif workbook is None and physical is not None and sap is not None:
            files = [await _read_upload(physical, "physical"), await _read_upload(sap, "sap")]
        else:
            raise InvalidFileError(
                "Upload either one file as 'workbook', or two files as 'physical' and 'sap'."
            )
        loaded = load_inputs(files, c)
        data = normalize(loaded, c)
        session = store.create(c)
        for source, frame in (("physical", data.physical), ("sap", data.sap)):
            sheet = loaded.sheet(source)
            file = next((f for f in files if f.name == sheet.file_name), files[0])
            upload = SourceUpload(
                file=file,
                sheet=sheet,
                frame=frame,
                issues=[i for i in data.issues if i.source == source],
            )
            if source == "physical":
                session.set_original(upload)
            else:
                session.set_incoming(upload)
        session.result.warnings[:0] = loaded.warnings
        store.save(session)
        return SessionCreated(
            session_id=session.session_id,
            detected=_detected(session),
            warnings=session.result.warnings,
            summary=session.result.summary,
        )

    @router.get("/sessions/{session_id}", response_model=SessionState, responses=ERRORS)
    def get_state(session: Session = Depends(get_session)) -> SessionState:
        """Which steps are done: the uploads (with their summaries) and whether matching ran."""
        return _state(session)

    @router.post(
        "/sessions/{session_id}/original",
        response_model=OriginalUploaded,
        responses=UPLOAD_ERRORS,
        summary="Step 1: upload the original inventory (read only, never modified)",
    )
    async def upload_original(
        file: UploadFile = File(description="The original inventory workbook"),
        sheet: str | None = Form(None, description="Sheet to read; needed if several fit"),
        session: Session = Depends(get_session),
        store: SessionStore = Depends(get_store),
    ) -> OriginalUploaded:
        """Uploading again replaces the original inventory and discards the incoming list and
        every decision (the UI asks for confirmation first). A failed upload changes nothing."""
        upload = read_upload(await _read_upload(file, None), "physical", sheet, session.cfg)
        discarded = session.set_original(upload)
        store.save(session)
        return OriginalUploaded(
            session_id=session.session_id,
            original=_original(session),
            discarded_later_steps=discarded,
        )

    @router.post(
        "/sessions/{session_id}/incoming",
        response_model=IncomingUploaded,
        responses=UPLOAD_ERRORS,
        summary="Step 2: upload the incoming furniture list; matching runs right away",
    )
    async def upload_incoming(
        file: UploadFile = File(description="The incoming furniture list workbook"),
        sheet: str | None = Form(None, description="Sheet to read; needed if several fit"),
        session: Session = Depends(get_session),
        store: SessionStore = Depends(get_store),
    ) -> IncomingUploaded:
        """409 until the original inventory is uploaded. Uploading again replaces the list and
        discards every decision."""
        if session.original is None:
            raise StepOrderError(
                "Upload the original inventory first; the incoming list is matched against it."
            )
        upload = read_upload(await _read_upload(file, None), "sap", sheet, session.cfg)
        discarded = session.set_incoming(upload)
        store.save(session)
        return IncomingUploaded(
            session_id=session.session_id,
            incoming=_incoming(session),
            discarded_decisions=discarded,
            summary=session.result.summary,
            warnings=session.result.warnings,
        )

    @router.get(
        "/sessions/{session_id}/result", response_model=SessionResult, responses=STEP_ERRORS
    )
    def get_result(session: Session = Depends(matched_session)) -> SessionResult:
        return result_of(session)

    @router.put("/sessions/{session_id}/ties/{group_id}", response_model=TieGroup, responses=ERRORS)
    def decide_tie(
        group_id: str,
        body: TieDecisionRequest,
        session: Session = Depends(matched_session),
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
        session: Session = Depends(matched_session),
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
            **STEP_ERRORS,
            200: {"content": {XLSX_MEDIA_TYPE: {}}, "description": "The reconciled workbook"},
        },
        response_class=Response,
    )
    def export(session: Session = Depends(matched_session)) -> Response:
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
