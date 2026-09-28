"""API basics: health, config, the endpoint list, upload validation, session lifetime."""

import datetime as dt

import pytest
from conftest import PHYSICAL_HEADERS, SAP_HEADERS, build_workbook, phys
from fastapi.testclient import TestClient

import api.main as api_main
from api.main import create_app
from api.sessions import InMemorySessionStore


@pytest.fixture
def client():
    return TestClient(create_app(store=InMemorySessionStore()))


def new_session(client) -> str:
    return client.post("/api/sessions").json()["session_id"]


def upload_original(client, sid, data, name="o.xlsx"):
    return client.post(f"/api/sessions/{sid}/original", files={"file": (name, data)})


def test_health_and_config(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    body = client.get("/api/config").json()
    assert len(body["type_rules"]) == 25
    assert {loc["building"] for loc in body["locations"]} == {"RVS", "LKS"}
    assert "weights" not in body["scoring"]  # every criterion counts equally
    assert body["scoring"]["auto_match_threshold"] == 100


def test_openapi_lists_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert set(paths) == {
        "/api/health",
        "/api/config",
        "/api/sessions",
        "/api/sessions/{session_id}",
        "/api/sessions/{session_id}/original",
        "/api/sessions/{session_id}/incoming",
        "/api/sessions/{session_id}/match",
        "/api/sessions/{session_id}/result",
        "/api/sessions/{session_id}/incoming/{row}/candidates",
        "/api/sessions/{session_id}/incoming/{row}/assignment",
        "/api/sessions/{session_id}/export",
    }


@pytest.mark.parametrize(
    ("name", "data"),
    [("notes.csv", b"a,b\n1,2"), ("fake.xlsx", b"not a zip")],
)
def test_bad_uploads_are_422(client, name, data):
    r = upload_original(client, new_session(client), data, name)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_file"
    assert "Traceback" not in r.text


def test_upload_without_file_is_422(client):
    r = client.post(f"/api/sessions/{new_session(client)}/original")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_missing_columns_are_listed(client):
    drop = SAP_HEADERS.index("Serial No.")
    sap_sheet = [[v for i, v in enumerate(SAP_HEADERS) if i != drop]]
    sid = new_session(client)
    rows = [PHYSICAL_HEADERS, phys(1, "chair", "on wheels, black")]
    upload_original(client, sid, build_workbook({"Stock": rows}))
    r = client.post(
        f"/api/sessions/{sid}/incoming",
        files={"file": ("s.xlsx", build_workbook({"SAP_Export": sap_sheet}))},
    )
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "missing_columns"
    assert err["details"][0]["missing_columns"] == ["Serial No."]


def test_upload_limit(client, monkeypatch):
    monkeypatch.setattr(api_main, "MAX_UPLOAD_BYTES", 10)
    r = upload_original(client, new_session(client), b"x" * 11, "big.xlsx")
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"


def test_unknown_session(client):
    for r in (
        client.get("/api/sessions/nope"),
        client.get("/api/sessions/nope/result"),
        client.put("/api/sessions/nope/incoming/2/assignment", json={"asset_id": "1"}),
    ):
        assert r.status_code == 404 and r.json()["error"]["code"] == "session_not_found"


def test_delete_session(client):
    sid = new_session(client)
    assert client.delete(f"/api/sessions/{sid}").status_code == 204
    assert client.get(f"/api/sessions/{sid}").status_code == 404


def test_sessions_expire_after_idle_time():
    now = [dt.datetime(2026, 1, 1, tzinfo=dt.UTC)]
    store = InMemorySessionStore(idle_ttl=dt.timedelta(hours=2), clock=lambda: now[0])
    client = TestClient(create_app(store=store))
    sid = new_session(client)
    now[0] += dt.timedelta(hours=1, minutes=59)
    assert client.get(f"/api/sessions/{sid}").status_code == 200  # access renews
    now[0] += dt.timedelta(hours=1, minutes=59)
    assert client.get(f"/api/sessions/{sid}").status_code == 200
    now[0] += dt.timedelta(hours=2, minutes=1)
    assert client.get(f"/api/sessions/{sid}").status_code == 404
    assert len(store) == 0
