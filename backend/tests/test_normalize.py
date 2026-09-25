import datetime as dt

import pandas as pd
import pytest

from recon import InputFile, load_inputs, normalize
from recon.normalize import (
    normalize_asset_id,
    parse_date,
    parse_description,
    parse_int,
    serial_year,
)


@pytest.mark.parametrize(
    ("text", "color", "width", "size"),
    [
        ("office chair on wheels, 60cm wide, black", "black", 60, None),
        ("office desk with 4 drawers, large, Oak ", "oak", None, "large"),
        ("metal bin, Small, grey", "grey", None, "small"),
        ("wall shelf, 80 cm wide, white", "white", 80, None),
        ("plain", "plain", None, None),
        ("smallish thing, largely unused, red", "red", None, None),  # whole words only
        ("", None, None, None),
        (None, None, None, None),
    ],
)
def test_parse_description(text, color, width, size):
    info = parse_description(text)
    assert (info.color, info.width_cm, info.size_word) == (color, width, size)


def test_serial_year():
    assert serial_year("SN-2019-3032") == 2019
    assert serial_year(" sn-2025-0001 ") == 2025
    assert serial_year("2019-3032") is None
    assert serial_year(None) is None


def test_asset_id_and_int_parsing():
    assert normalize_asset_id(84213492) == "84213492"
    assert normalize_asset_id(84213492.0) == "84213492"
    assert normalize_asset_id(" 84213492 ") == "84213492"
    assert normalize_asset_id(None) is None
    assert parse_int("60 cm") == 60
    assert parse_int(60.5) is None
    assert parse_int("wide") is None


def test_parse_date():
    assert parse_date(dt.datetime(2019, 3, 1)) == pd.Timestamp(2019, 3, 1)
    assert parse_date("2019-03-01") == pd.Timestamp(2019, 3, 1)
    assert parse_date("2021/12/31") == pd.Timestamp(2021, 12, 31)
    assert parse_date("2021/03/04") == pd.Timestamp(2021, 3, 4)  # never Y-D-M
    assert parse_date("2021.3.4") == pd.Timestamp(2021, 3, 4)
    assert parse_date("2021/02/30") is None
    assert parse_date("03/04/2021", dayfirst=True) == pd.Timestamp(2021, 4, 3)
    assert parse_date(43525) == pd.Timestamp(2019, 3, 1)  # Excel serial
    assert parse_date("not a date") is None
    assert parse_date(None) is None


def test_normalize_synthetic(combined_workbook):
    data = normalize(load_inputs([InputFile("book.xlsx", combined_workbook)]))
    p, s = data.physical, data.sap

    first = p.iloc[0]
    assert first["asset_id"] == "84219511"
    assert first["item_name"] == "chair"
    assert (first["color"], first["width_cm"], first["building"]) == ("black", 60, "RVS")
    assert first["activation_year"] == 2019
    assert type(first["width_cm"]) is int
    assert p.iloc[1]["width_cm"] is None
    assert p.iloc[1]["size_word"] == "large"
    assert p.iloc[2]["status"] == "Defective - pending write-off"
    assert p["excel_row"].tolist() == [2, 3, 4, 5]

    assert s["item_name"].tolist() == ["Swivel Chair", "Work Desk", "Trash Bin"]
    assert s["color"].tolist() == ["black", "oak", "grey"]
    assert s["serial_year"].tolist() == [2019, 2021, 2025]
    assert s["qr_code"].tolist() == ["INV0084219511", "INV0084200001", "garbage"]
    assert s["city"].tolist() == ["Riverside", "Lakeside", "Lakeside"]
    assert all(v is None for v in s["asset_id"])
    assert data.issues == []


def test_normalize_reports_issues(physical_sheet, sap_sheet):
    from conftest import build_workbook

    physical_sheet[1][5] = "Atlantis"  # unknown city
    physical_sheet[2][4] = 4021  # Lakeside row with Riverside site code
    physical_sheet[3][6] = "someday"  # bad activation date
    sap_sheet[1][9] = "no-serial"
    data = normalize(
        load_inputs(
            [
                InputFile(
                    "b.xlsx",
                    build_workbook({"Physical_Inventory": physical_sheet, "SAP_Export": sap_sheet}),
                )
            ]
        )
    )
    codes = {(i.source, i.excel_row, i.code) for i in data.issues}
    assert codes == {
        ("physical", 2, "unknown_city"),
        ("physical", 3, "site_city_conflict"),
        ("physical", 4, "bad_activation_date"),
        ("sap", 2, "bad_serial"),
    }
