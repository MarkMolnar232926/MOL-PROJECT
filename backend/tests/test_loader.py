import pytest
from conftest import PHYSICAL_HEADERS, SAP_HEADERS, build_workbook

from recon import (
    InputFile,
    InvalidFileError,
    MissingColumnsError,
    SheetChoiceRequiredError,
    SheetDetectionError,
    load_inputs,
    load_source,
)


def test_one_workbook_detected_by_sheet_name(combined_workbook):
    loaded = load_inputs([InputFile("book.xlsx", combined_workbook)])
    assert loaded.physical.sheet_name == "Physical_Inventory"
    assert loaded.sap.sheet_name == "SAP_Export"
    assert loaded.physical.detected_by == loaded.sap.detected_by == "sheet_name"
    assert loaded.physical.row_count == 4
    assert loaded.sap.row_count == 3
    assert loaded.physical.frame["excel_row"].tolist() == [2, 3, 4, 5]
    assert loaded.physical.column_map["asset_id"] == "Asset ID"
    assert loaded.sap.column_map["serial_no"] == "Serial No."
    assert loaded.warnings == []


def test_answer_key_is_never_used(physical_sheet, sap_sheet):
    # Neither real sheet has a recognisable name; Answer_Key comes first and fits the signature.
    data = build_workbook(
        {
            "Answer_Key": [PHYSICAL_HEADERS, [1, "x", "y", None, None, "Riverside", None]],
            "Sheet A": physical_sheet,
            "Sheet B": sap_sheet,
        }
    )
    loaded = load_inputs([InputFile("book.xlsx", data)])
    assert loaded.physical.sheet_name == "Sheet A"
    assert loaded.physical.detected_by == "header_signature"
    assert loaded.sap.sheet_name == "Sheet B"


def test_header_matching_is_case_and_whitespace_insensitive(physical_sheet, sap_sheet):
    physical_sheet[0] = [f"  {h.upper()}  ".replace(" ", "   ") for h in PHYSICAL_HEADERS]
    data = build_workbook({"Physical_Inventory": physical_sheet, "SAP_Export": sap_sheet})
    loaded = load_inputs([InputFile("book.xlsx", data)])
    assert set(loaded.physical.column_map) >= {"asset_id", "description", "activation_date"}
    assert loaded.physical.missing_optional == []


def test_two_files(physical_sheet, sap_sheet):
    phys = build_workbook({"Stocktake": physical_sheet})
    sap = build_workbook({"Export": sap_sheet})
    loaded = load_inputs([InputFile("p.xlsx", phys, "physical"), InputFile("s.xlsx", sap, "sap")])
    assert (loaded.physical.file_name, loaded.sap.file_name) == ("p.xlsx", "s.xlsx")
    assert loaded.warnings == []


def test_two_files_swapped_are_detected_with_warning(physical_sheet, sap_sheet):
    phys = build_workbook({"Stocktake": physical_sheet})
    sap = build_workbook({"Export": sap_sheet})
    loaded = load_inputs([InputFile("s.xlsx", sap, "physical"), InputFile("p.xlsx", phys, "sap")])
    assert loaded.physical.file_name == "p.xlsx"
    assert loaded.sap.file_name == "s.xlsx"
    assert [w.code for w in loaded.warnings] == ["files_swapped", "files_swapped"]


def test_missing_required_columns_are_listed(physical_sheet, sap_sheet):
    drop = SAP_HEADERS.index("Serial No.")
    sap_sheet = [[v for i, v in enumerate(r) if i != drop] for r in sap_sheet]
    sap_sheet[0][sap_sheet[0].index("Building")] = "Location"
    data = build_workbook({"Physical_Inventory": physical_sheet, "SAP_Export": sap_sheet})
    with pytest.raises(MissingColumnsError) as err:
        load_inputs([InputFile("book.xlsx", data)])
    detail = err.value.details[0]
    assert detail["source"] == "sap"
    assert detail["missing_columns"] == ["Serial No.", "Building"]
    assert "Serial No." in err.value.message


def test_optional_columns_may_be_absent(physical_sheet, sap_sheet):
    qr = SAP_HEADERS.index("QR Code")
    sap_sheet = [[v for i, v in enumerate(r) if i != qr] for r in sap_sheet]
    data = build_workbook({"Physical_Inventory": physical_sheet, "SAP_Export": sap_sheet})
    loaded = load_inputs([InputFile("book.xlsx", data)])
    assert "QR Code" in loaded.sap.missing_optional


def test_no_matching_sheet():
    data = build_workbook({"Notes": [["hello", "world"]]})
    with pytest.raises(SheetDetectionError) as err:
        load_inputs([InputFile("book.xlsx", data)])
    assert {d["source"] for d in err.value.details} == {"physical", "sap"}


def test_blank_rows_skipped_and_row_numbers_kept(physical_sheet, sap_sheet):
    physical_sheet.insert(2, [None] * len(PHYSICAL_HEADERS))
    data = build_workbook({"Physical_Inventory": physical_sheet, "SAP_Export": sap_sheet})
    loaded = load_inputs([InputFile("book.xlsx", data)])
    assert loaded.physical.frame["excel_row"].tolist() == [2, 4, 5, 6]


@pytest.mark.parametrize(
    ("name", "data"),
    [("data.csv", b"a,b\n1,2"), ("fake.xlsx", b"not a zip"), ("old.xls", b"\xd0\xcf\x11\xe0")],
)
def test_rejects_non_xlsx(name, data):
    with pytest.raises(InvalidFileError):
        load_inputs([InputFile(name, data)])


# --- load_source: one file, one source (two-step upload) -----------------------------------


def test_load_source_picks_the_sheet_by_name(practice_file):
    file = InputFile(practice_file.name, practice_file.read_bytes())
    original = load_source(file, "physical")
    incoming = load_source(file, "sap")
    assert (original.sheet_name, original.detected_by) == ("Physical_Inventory", "sheet_name")
    assert (incoming.sheet_name, incoming.detected_by) == ("SAP_Export", "sheet_name")
    assert "Answer_Key" not in original.sheets_available
    assert original.sheets_available == ["Task", "Physical_Inventory", "SAP_Export"]


def test_load_source_by_header_signature(physical_sheet):
    data = build_workbook({"Notes": [["hello"]], "Stocktake": physical_sheet})
    sheet = load_source(InputFile("p.xlsx", data), "physical")
    assert (sheet.sheet_name, sheet.detected_by) == ("Stocktake", "header_signature")


def test_load_source_asks_when_several_sheets_fit(physical_sheet):
    data = build_workbook({"Jan": physical_sheet, "Feb": physical_sheet})
    with pytest.raises(SheetChoiceRequiredError) as err:
        load_source(InputFile("p.xlsx", data), "physical")
    assert err.value.details[0]["matching_sheets"] == ["Jan", "Feb"]
    sheet = load_source(InputFile("p.xlsx", data), "physical", sheet="feb")
    assert (sheet.sheet_name, sheet.detected_by) == ("Feb", "user_choice")


def test_load_source_unknown_or_unfit_sheet(physical_sheet, sap_sheet):
    data = build_workbook({"Stocktake": physical_sheet, "Export": sap_sheet})
    with pytest.raises(SheetDetectionError) as err:
        load_source(InputFile("p.xlsx", data), "physical", sheet="Nope")
    assert err.value.details[0]["sheets_seen"] == ["Stocktake", "Export"]
    with pytest.raises(MissingColumnsError):
        load_source(InputFile("p.xlsx", data), "physical", sheet="Export")
    with pytest.raises(SheetDetectionError):
        load_source(InputFile("p.xlsx", data), "physical", sheet="Answer_Key")


def test_load_source_hints_at_the_wrong_step(sap_sheet):
    data = build_workbook({"Export": sap_sheet})
    with pytest.raises(SheetDetectionError) as err:
        load_source(InputFile("s.xlsx", data), "physical")
    assert err.value.details[0]["looks_like"] == "sap"
    assert "right step" in err.value.message


def test_load_source_rejects_non_xlsx():
    with pytest.raises(InvalidFileError):
        load_source(InputFile("data.csv", b"a,b"), "physical")
