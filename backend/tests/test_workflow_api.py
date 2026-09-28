"""The two-step upload flow: original inventory first, then the incoming list."""

import hashlib

import pytest
from conftest import (
    INCOMING_FILE,
    ORIGINAL_FILE,
    PHYSICAL_HEADERS,
    SAP_HEADERS,
    build_workbook,
    phys,
    sap,
)
from fastapi.testclient import TestClient

from api.main import create_app
from api.sessions import InMemorySessionStore


@pytest.fixture
def client():
    return TestClient(create_app(store=InMemorySessionStore()))


@pytest.fixture(scope="module")
def fixtures():
    if not (ORIGINAL_FILE.exists() and INCOMING_FILE.exists()):
        pytest.skip("sample files missing from tests/fixtures")
    return ORIGINAL_FILE.read_bytes(), INCOMING_FILE.read_bytes()


def new_session(client) -> str:
    r = client.post("/api/sessions")
    assert r.status_code == 201, r.text
    return r.json()["session_id"]


def upload(client, sid, step, data, name=None, sheet=None):
    return client.post(
        f"/api/sessions/{sid}/{step}",
        files={"file": (name or f"{step}.xlsx", data)},
        data={"sheet": sheet} if sheet else None,
    )


def no_pair(client, sid, row):
    r = client.put(
        f"/api/sessions/{sid}/incoming/{row}/assignment",
        json={"asset_id": None, "reason": "new_asset"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def small_files():
    original = build_workbook(
        {
            "Stocktake": [
                PHYSICAL_HEADERS,
                phys(11111111, "chair", "on wheels, black", date=(2019, 5, 1)),
                phys(22222222, "chair", "on wheels, black", date=(2019, 2, 1)),
            ]
        }
    )
    incoming = build_workbook(
        {
            "Export": [
                SAP_HEADERS,
                sap("Swivel Chair", "Black", 60, "SN-2019-9000"),
                sap("Swivel Chair", "Black", 60, "SN-2019-1000"),
            ]
        }
    )
    return original, incoming


def test_new_session_is_empty(client):
    sid = new_session(client)
    state = client.get(f"/api/sessions/{sid}").json()
    assert state == {"session_id": sid, "original": None, "incoming": None, "matched": False}


def test_incoming_before_original_is_409(client):
    sid = new_session(client)
    _, incoming = small_files()
    r = upload(client, sid, "incoming", incoming)
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "step_order"
    assert "original inventory first" in err["message"]
    assert client.get(f"/api/sessions/{sid}").json()["incoming"] is None


def test_result_and_export_before_matching_are_409(client):
    sid = new_session(client)
    assert client.get(f"/api/sessions/{sid}/result").status_code == 409
    upload(client, sid, "original", small_files()[0])
    for path in ("result", "export"):
        r = client.get(f"/api/sessions/{sid}/{path}")
        assert r.status_code == 409 and r.json()["error"]["code"] == "step_order"


def test_unknown_session_is_404(client):
    r = upload(client, "nope", "original", small_files()[0])
    assert r.status_code == 404


def test_fixture_flow_and_summaries(client, fixtures):
    original, incoming = fixtures
    sid = new_session(client)

    r = upload(client, sid, "original", original, "physical_inventory.xlsx")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["discarded_later_steps"] is False
    sheet, summary = body["original"]["sheet"], body["original"]["summary"]
    # the sheet is called "Munka1": found by its headers
    assert (sheet["sheet_name"], sheet["detected_by"], sheet["row_count"]) == (
        "Munka1",
        "header_signature",
        84,
    )
    assert [(loc["location"], loc["building"], loc["rows"]) for loc in summary["locations"]] == [
        ("Lakeside", "LKS", 42),
        ("Riverside", "RVS", 42),
    ]
    assert {d["value"]: d["rows"] for d in summary["duplicate_asset_ids"]} == {
        "84220682": [22, 31],
        "84278510": [3, 44],
        "84297390": [23, 83],
    }
    assert summary["defective_rows"] == [42, 43, 45, 51, 57, 79, 82]
    assert summary["issues"] == []
    assert client.get(f"/api/sessions/{sid}").json()["matched"] is False

    r = upload(client, sid, "incoming", incoming, "sap_export.xlsx")
    assert r.status_code == 200, r.text
    body = r.json()
    summary = body["incoming"]["summary"]
    assert summary["rows"] == 20
    assert summary["duplicate_rows"] == []  # rows 19/20 differ in their QR code
    assert summary["prefilled_asset_ids"] == []
    assert body["summary"]["resolved"] == 18  # matching ran right after the upload
    assert body["summary"]["unresolved"] == 2

    state = client.get(f"/api/sessions/{sid}").json()
    assert state["matched"] is True
    assert state["original"]["sheet"]["file_name"] == "physical_inventory.xlsx"
    assert state["incoming"]["sheet"]["file_name"] == "sap_export.xlsx"
    assert client.get(f"/api/sessions/{sid}/result").status_code == 200


def test_one_workbook_can_serve_both_steps(client, physical_sheet, sap_sheet):
    """A workbook holding both sheets can be uploaded twice: each step takes its own sheet."""
    data = build_workbook(
        {"Physical_Inventory": physical_sheet, "SAP_Export": sap_sheet, "Answer_Key": [["x"]]}
    )
    sid = new_session(client)
    r = upload(client, sid, "original", data)
    assert r.json()["original"]["sheet"]["sheet_name"] == "Physical_Inventory"
    assert "Answer_Key" not in r.json()["original"]["sheet"]["sheets_available"]
    r = upload(client, sid, "incoming", data)
    assert r.json()["incoming"]["sheet"]["sheet_name"] == "SAP_Export"


def test_reuploading_original_discards_incoming_and_decisions(client):
    original, incoming = small_files()
    sid = new_session(client)
    upload(client, sid, "original", original)
    upload(client, sid, "incoming", incoming)
    no_pair(client, sid, 2)
    assert len(client.get(f"/api/sessions/{sid}/result").json()["log"]) == 1

    r = upload(client, sid, "original", original)
    assert r.status_code == 200 and r.json()["discarded_later_steps"] is True
    state = client.get(f"/api/sessions/{sid}").json()
    assert state["incoming"] is None and state["matched"] is False
    assert client.get(f"/api/sessions/{sid}/result").status_code == 409

    # the decisions are gone for good: a fresh incoming upload starts clean
    upload(client, sid, "incoming", incoming)
    assert client.get(f"/api/sessions/{sid}/result").json()["log"] == []


def test_reuploading_incoming_discards_decisions(client):
    original, incoming = small_files()
    sid = new_session(client)
    upload(client, sid, "original", original)
    upload(client, sid, "incoming", incoming)
    no_pair(client, sid, 2)
    r = upload(client, sid, "incoming", incoming)
    assert r.json()["discarded_decisions"] is True
    assert client.get(f"/api/sessions/{sid}/result").json()["log"] == []


def test_failed_upload_changes_nothing(client):
    original, incoming = small_files()
    sid = new_session(client)
    upload(client, sid, "original", original)
    upload(client, sid, "incoming", incoming)
    r = upload(client, sid, "original", b"not a zip", "bad.xlsx")
    assert r.status_code == 422
    state = client.get(f"/api/sessions/{sid}").json()
    assert state["matched"] is True and state["incoming"] is not None


def test_wrong_file_in_a_step_is_422_with_hint(client):
    original, incoming = small_files()
    sid = new_session(client)
    r = upload(client, sid, "original", incoming)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "sheet_not_found"
    assert err["details"][0]["looks_like"] == "sap"


def test_sheet_choice(client):
    original, _ = small_files()
    rows = [PHYSICAL_HEADERS, phys(11111111, "chair", "on wheels, black")]
    two = build_workbook({"Jan": rows, "Feb": rows})
    sid = new_session(client)
    r = upload(client, sid, "original", two)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "sheet_choice_required"
    assert err["details"][0]["matching_sheets"] == ["Jan", "Feb"]
    r = upload(client, sid, "original", two, sheet="Feb")
    assert r.status_code == 200
    assert r.json()["original"]["sheet"]["detected_by"] == "user_choice"
    r = upload(client, sid, "original", two, sheet="Mar")
    assert r.status_code == 422 and r.json()["error"]["code"] == "sheet_not_found"


def test_original_file_is_only_read(client, fixtures):
    before = hashlib.sha256(ORIGINAL_FILE.read_bytes()).hexdigest()
    original, incoming = fixtures
    sid = new_session(client)
    upload(client, sid, "original", original)
    upload(client, sid, "incoming", incoming)
    client.get(f"/api/sessions/{sid}/result")
    assert hashlib.sha256(ORIGINAL_FILE.read_bytes()).hexdigest() == before


# --- candidates and assignments -------------------------------------------------------------


def matched_small(client) -> str:
    original, incoming = small_files()
    sid = new_session(client)
    upload(client, sid, "original", original)
    upload(client, sid, "incoming", incoming)
    return sid


def row_status(client, sid):
    res = client.get(f"/api/sessions/{sid}/result").json()
    return {r["item"]["excel_row"]: (r["asset_id"], r["status"]) for r in res["rows"]}


def test_candidates_endpoint(client):
    sid = matched_small(client)
    r = client.get(f"/api/sessions/{sid}/incoming/2/candidates")
    assert r.status_code == 200
    assert [c["existing"]["asset_id"] for c in r.json()] == ["11111111"]  # own unit only
    r = client.get(f"/api/sessions/{sid}/incoming/2/candidates", params={"include_paired": True})
    cands = r.json()
    assert [c["existing"]["asset_id"] for c in cands] == ["11111111", "22222222"]
    assert cands[1]["paired_row"] == 3
    assert {c["criterion"] for c in cands[0]["checks"]} == {
        "type",
        "color",
        "size",
        "location",
        "material",
    }
    assert client.get(f"/api/sessions/{sid}/incoming/99/candidates").status_code == 404


def test_swap_flow(client):
    sid = matched_small(client)
    assert row_status(client, sid) == {
        2: ("11111111", "auto_newest"),
        3: ("22222222", "auto_newest"),
    }
    url = f"/api/sessions/{sid}/incoming/2/assignment"
    r = client.put(url, json={"asset_id": "22222222"})
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "swap_required" and err["details"][0]["row"] == 3
    assert "row 3 goes back" in err["message"]

    r = client.put(url, json={"asset_id": "22222222", "confirm_swap": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["released_row"] == 3
    assert body["result"]["summary"]["unresolved"] == 1
    assert row_status(client, sid) == {2: ("22222222", "manual"), 3: (None, "no_candidate")}
    log = body["result"]["log"]
    assert [(e["row"], e["action"]) for e in log] == [(3, "released"), (2, "assign")]
    assert log[1]["old_asset_id"] == "11111111" and log[1]["new_asset_id"] == "22222222"

    # the released row now finds the freed unit
    r = client.get(f"/api/sessions/{sid}/incoming/3/candidates")
    assert [c["existing"]["asset_id"] for c in r.json()] == ["11111111"]


def test_no_pair_needs_a_reason(client):
    sid = matched_small(client)
    url = f"/api/sessions/{sid}/incoming/2/assignment"
    r = client.put(url, json={"asset_id": None})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_assignment"
    r = client.put(url, json={"asset_id": None, "reason": "other"})
    assert r.status_code == 422
    r = client.put(url, json={"asset_id": None, "reason": "nonsense"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    r = client.put(url, json={"asset_id": None, "reason": "other", "note": "sold"})
    assert r.status_code == 200
    row = next(x for x in r.json()["result"]["rows"] if x["item"]["excel_row"] == 2)
    assert (row["status"], row["reason"], row["note"]) == ("no_match", "other", "sold")


def test_reset_assignment(client):
    sid = matched_small(client)
    client.put(
        f"/api/sessions/{sid}/incoming/2/assignment",
        json={"asset_id": None, "reason": "missing_asset"},
    )
    r = client.delete(f"/api/sessions/{sid}/incoming/2/assignment")
    assert r.status_code == 200
    assert row_status(client, sid)[2] == ("11111111", "auto_newest")
    assert [e["action"] for e in r.json()["result"]["log"]] == ["no_match", "reset"]


def test_assignment_before_matching_is_409(client):
    sid = new_session(client)
    r = client.put(f"/api/sessions/{sid}/incoming/2/assignment", json={"asset_id": "1"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "step_order"
