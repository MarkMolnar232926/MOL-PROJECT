"""FastAPI wrapper around the recon engine. Session endpoints arrive in phase 4."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from recon import ReconError, default_config
from recon.config import CostWeights, Location, TypeRule

app = FastAPI(title="Inventory Reconciliation API", version="0.1.0")


class HealthResponse(BaseModel):
    status: str


class ConfigResponse(BaseModel):
    rules_version: str
    type_rules: list[TypeRule]
    locations: list[Location]
    cost_weights: CostWeights
    excluded_statuses: list[str]


@app.exception_handler(ReconError)
async def recon_error_handler(_: Request, exc: ReconError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": exc.to_dict()})


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/api/config", response_model=ConfigResponse)
def get_config() -> ConfigResponse:
    cfg = default_config()
    return ConfigResponse(
        rules_version=cfg.type_rules.version,
        type_rules=cfg.type_rules.rules,
        locations=cfg.locations,
        cost_weights=cfg.matching.cost_weights,
        excluded_statuses=cfg.matching.excluded_statuses,
    )
