"""Shared fixtures: a small synthetic workbook shaped like the practice file."""

from __future__ import annotations

import datetime as dt
import io
from pathlib import Path

import pytest
from openpyxl import Workbook

REPO_ROOT = Path(__file__).resolve().parents[2]
PRACTICE_FILE = REPO_ROOT / "tests" / "fixtures" / "Inventory_Reconciliation_Practice_1.xlsx"

PHYSICAL_HEADERS = [
    "Asset ID",
    "Item name",
    "Description",
    "Custodian",
    "Site code",
    "City",
    "Activation date",
    "Deactivation date",
    "Gross value ($)",
    "Monthly depr. ($)",
    "Status",
]
SAP_HEADERS = [
    "Asset ID",
    "Asset Group",
    "Asset Category",
    "Item Name",
    "Color",
    "Material",
    "Width (cm)",
    "Height (cm)",
    "Depth (cm)",
    "Serial No.",
    "Remarks",
    "QR Code",
    "Building",
]

PHYSICAL_ROWS = [
    [
        84219511,
        "chair",
        "office chair on wheels, 60cm wide, black",
        "A. Jansen",
        4021,
        "Riverside",
        dt.datetime(2019, 3, 1),
        None,
        250,
        4.2,
        None,
    ],
    [
        84200001,
        "table",
        "office desk with 4 drawers, large, oak",
        "B. de Vries",
        4087,
        "Lakeside",
        dt.datetime(2021, 6, 15),
        None,
        600,
        10,
        None,
    ],
    [
        84200002,
        "bin",
        "metal bin, small, Grey",
        "C. Bakker",
        4087,
        "Lakeside",
        dt.datetime(2025, 1, 10),
        None,
        20,
        0.5,
        "Defective - pending write-off",
    ],
    [
        84200001,
        "table",
        "office desk with 4 drawers, large, oak",
        "B. de Vries",
        4087,
        "Lakeside",
        dt.datetime(2021, 6, 15),
        None,
        600,
        10,
        None,
    ],  # double entry
]
SAP_ROWS = [
    [
        None,
        "> Movable Furniture",
        "Seating",
        "Swivel Chair",
        "Black",
        "Mesh",
        60,
        110,
        60,
        "SN-2019-3032",
        None,
        "INV0084219511",
        "RVS",
    ],
    [
        None,
        "> Movable Furniture",
        "Desks",
        "Work Desk",
        "Oak",
        "Wood",
        160,
        75,
        80,
        "SN-2021-3808",
        "near window",
        "INV0084200001",
        "LKS",
    ],
    [
        None,
        "> Movable Furniture",
        "Other",
        "Trash Bin",
        "grey",
        "Metal",
        30,
        40,
        30,
        "SN-2025-3396",
        None,
        "garbage",
        "LKS",
    ],
]


def build_workbook(sheets: dict[str, list[list]], hidden: tuple[str, ...] = ()) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for row in rows:
            ws.append(row)
        if name in hidden:
            ws.sheet_state = "hidden"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def physical_sheet() -> list[list]:
    return [PHYSICAL_HEADERS, *[list(r) for r in PHYSICAL_ROWS]]


@pytest.fixture
def sap_sheet() -> list[list]:
    return [SAP_HEADERS, *[list(r) for r in SAP_ROWS]]


@pytest.fixture
def combined_workbook(physical_sheet, sap_sheet) -> bytes:
    return build_workbook(
        {
            "Task": [["Instructions go here"]],
            "Physical_Inventory": physical_sheet,
            "SAP_Export": sap_sheet,
            # Answer_Key deliberately carries a valid physical signature: it must still be ignored.
            "Answer_Key": [PHYSICAL_HEADERS, [1, "x", "y", None, None, "Riverside", None]],
        },
        hidden=("Answer_Key",),
    )


@pytest.fixture
def practice_file() -> Path:
    if not PRACTICE_FILE.exists():
        pytest.skip(f"practice workbook not present at {PRACTICE_FILE}")
    return PRACTICE_FILE
