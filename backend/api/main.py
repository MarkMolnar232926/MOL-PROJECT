"""FastAPI wrapper around the recon engine (change request v2, section 7)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, FastAPI, File, Form, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from recon import AppConfig, InputFile, ReconError, default_config, reconcile
from recon.errors import StepOrderError
from recon.export import export_filename, export_workbook
from recon.intake import combine, read_upload, sheet_info, summarize_incoming, summarize_original
from recon.match_models import Candidate
from recon.matching import SwapRequiredError, UnknownRowError

from .schemas import (
    AssignmentRequest,
    AssignmentResponse,
    ConfigResponse,
    ErrorResponse,
    HealthResponse,
    IncomingUpload,
    IncomingUploaded,
    OriginalUpload,
    OriginalUploaded,
    SessionResult,
    SessionState,
)
from .sessions import InMemorySessionStore, Session, SessionStore

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
log = logging.getLogger("recon.api")

CONFLICTS = (StepOrderError, SwapRequiredError)  # -> 409
NOT_FOUND = (UnknownRowError,)  # -> 404


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: list | None = None):
        self.status, self.code, self.message, self.details = status, code, message, details or []


def _error(status: int, code: str, message: str, details: list | None = None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details or []}}
    return JSONResponse(status_code=status, content=body)


ERRORS = {
    404: {"model": ErrorResponse, "description": "Unknown session or row"},
    422: {"model": ErrorResponse, "description": "Invalid input"},
}
STEP_ERRORS = {
    **ERRORS,
    409: {"model": ErrorResponse, "description": "A previous step is not done yet"},
}
UPLOAD_ERRORS = {**STEP_ERRORS, 413: {"model": ErrorResponse, "description": "File too large"}}
ASSIGN_ERRORS = {
    **ERRORS,
    409: {
        "model": ErrorResponse,
        "description": "Matching has not run, or the unit belongs to another row "
        "(code swap_required: repeat with confirm_swap)",
    },
}


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


def _result(session: Session) -> SessionResult:
    res = session.require_matching().result()
    return SessionResult(**dict(res), session_id=session.session_id)


async def _read_upload(upload: UploadFile) -> InputFile:
    name = upload.filename or "upload.xlsx"
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(
            413,
            "file_too_large",
            f"'{name}' is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            [{"file": name}],
        )
    return InputFile(name=name, data=data)


def create_app(store: SessionStore | None = None, cfg: AppConfig | None = None) -> FastAPI:
    app = FastAPI(
        title="Inventory Reconciliation API",
        version="0.5.0",
        description="Fill in the Asset IDs of an incoming furniture list from the original "
        "inventory. The original inventory is only read.",
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

    # -- exception mapping: always structured JSON, never a stack trace --

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return _error(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(ReconError)
    async def _recon_error(_: Request, exc: ReconError):
        status = 409 if isinstance(exc, CONFLICTS) else 404 if isinstance(exc, NOT_FOUND) else 422
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
            scoring=c.scoring,
            excluded_statuses=c.matching.excluded_statuses,
        )

    @router.post("/sessions", response_model=SessionState, status_code=201)
    def create_session(store: SessionStore = Depends(get_store)) -> SessionState:
        """A new, empty session. Upload the original inventory next."""
        return _state(store.create(app.state.cfg))

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
        upload = read_upload(await _read_upload(file), "physical", sheet, session.cfg)
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
        upload = read_upload(await _read_upload(file), "sap", sheet, session.cfg)
        discarded = session.set_incoming(upload)
        store.save(session)
        res = session.require_matching().result()
        return IncomingUploaded(
            session_id=session.session_id,
            incoming=_incoming(session),
            discarded_decisions=discarded,
            summary=res.summary,
            warnings=res.warnings,
        )

    @router.get(
        "/sessions/{session_id}/result", response_model=SessionResult, responses=STEP_ERRORS
    )
    def get_result(session: Session = Depends(get_session)) -> SessionResult:
        """Summary, the status of every incoming row, warnings, unpaired units, decision log."""
        return _result(session)

    @router.get(
        "/sessions/{session_id}/incoming/{row}/candidates",
        response_model=list[Candidate],
        responses=STEP_ERRORS,
    )
    def get_candidates(
        row: int,
        include_paired: bool = Query(False, description="Also units assigned to other rows"),
        include_other_types: bool = Query(False, description="Also units of other types"),
        include_defective: bool = Query(False, description="Also defective units"),
        q: str | None = Query(None, description="Search Asset ID, description, custodian"),
        session: Session = Depends(get_session),
    ) -> list[Candidate]:
        """Existing units for one incoming row, best first (a QR-code match always leads)."""
        return session.require_matching().candidates(
            row, include_paired, include_other_types, include_defective, q
        )

    @router.put(
        "/sessions/{session_id}/incoming/{row}/assignment",
        response_model=AssignmentResponse,
        responses=ASSIGN_ERRORS,
    )
    def put_assignment(
        row: int,
        body: AssignmentRequest,
        session: Session = Depends(get_session),
        store: SessionStore = Depends(get_store),
    ) -> AssignmentResponse:
        """Pair the row with a unit, or mark it as having no pair (reason required).

        If the unit belongs to another row the answer is 409 ``swap_required`` describing the
        swap; with ``confirm_swap`` that row is released back to the items to resolve."""
        released = session.require_matching().assign(
            row, body.asset_id, body.reason, body.note, body.confirm_swap
        )
        store.save(session)
        return AssignmentResponse(row=row, released_row=released, result=_result(session))

    @router.delete(
        "/sessions/{session_id}/incoming/{row}/assignment",
        response_model=AssignmentResponse,
        responses=ASSIGN_ERRORS,
    )
    def delete_assignment(
        row: int,
        confirm_swap: bool = Query(False, description="Take back the unit from another row"),
        session: Session = Depends(get_session),
        store: SessionStore = Depends(get_store),
    ) -> AssignmentResponse:
        """Back to the automatic suggestion."""
        released = session.require_matching().reset(row, confirm_swap)
        store.save(session)
        return AssignmentResponse(row=row, released_row=released, result=_result(session))

    @router.get(
        "/sessions/{session_id}/export",
        responses={
            **STEP_ERRORS,
            200: {"content": {XLSX_MEDIA_TYPE: {}}, "description": "The reconciled workbook"},
        },
        response_class=Response,
    )
    def export(session: Session = Depends(get_session)) -> Response:
        # Interim: the previous multi-sheet report. Replaced by the Asset-ID-only export next.
        session.require_matching()
        data = combine(session.original, session.incoming)
        name = export_filename()
        body = export_workbook(data.loaded, reconcile(data, session.cfg))
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
