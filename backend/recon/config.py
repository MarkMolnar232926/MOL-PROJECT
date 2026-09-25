"""Load the YAML configuration into typed models."""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

Source = Literal["physical", "sap"]

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


def normalize_header(text: object) -> str:
    """Case-fold and collapse whitespace so headers compare loosely."""
    if text is None:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip().casefold()


class ColumnSpec(BaseModel):
    headers: list[str] = Field(min_length=1)
    required: bool = False

    @property
    def display_name(self) -> str:
        return self.headers[0]


class SourceSpec(BaseModel):
    sheet_names: list[str]
    columns: dict[str, ColumnSpec]

    @property
    def required_keys(self) -> list[str]:
        return [k for k, c in self.columns.items() if c.required]


class ColumnsConfig(BaseModel):
    physical: SourceSpec
    sap: SourceSpec
    ignored_sheets: list[str] = ["Answer_Key"]
    date_dayfirst: bool = True

    def source(self, source: Source) -> SourceSpec:
        return self.physical if source == "physical" else self.sap


class TypeRule(BaseModel):
    item: str
    keyword: str = ""
    sap_type: str


class TypeRulesConfig(BaseModel):
    version: str = "1"
    rules: list[TypeRule]


class Location(BaseModel):
    city: str
    building: str
    site_code: str


class CostWeights(BaseModel):
    year_gap: float = 1000
    location_mismatch: float = 100
    fifo_rank: float = 0.001


class MatchingConfig(BaseModel):
    excluded_statuses: list[str] = ["Defective - pending write-off"]
    cost_weights: CostWeights = CostWeights()


class AppConfig(BaseModel):
    columns: ColumnsConfig
    type_rules: TypeRulesConfig
    locations: list[Location]
    matching: MatchingConfig

    def city_to_building(self) -> dict[str, str]:
        return {loc.city.casefold(): loc.building.upper() for loc in self.locations}

    def site_to_building(self) -> dict[str, str]:
        return {loc.site_code: loc.building.upper() for loc in self.locations}


def _read_yaml(path: Path):
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_config(config_dir: str | Path | None = None) -> AppConfig:
    """Read all config files from ``config_dir`` (default: $RECON_CONFIG_DIR or backend/config)."""
    base = Path(config_dir or os.environ.get("RECON_CONFIG_DIR") or DEFAULT_CONFIG_DIR)
    return AppConfig(
        columns=ColumnsConfig.model_validate(_read_yaml(base / "columns.yaml")),
        type_rules=TypeRulesConfig.model_validate(_read_yaml(base / "type_rules.yaml")),
        locations=[Location.model_validate(x) for x in _read_yaml(base / "locations.yaml")],
        matching=MatchingConfig.model_validate(_read_yaml(base / "matching.yaml") or {}),
    )


@lru_cache(maxsize=1)
def default_config() -> AppConfig:
    return load_config()
