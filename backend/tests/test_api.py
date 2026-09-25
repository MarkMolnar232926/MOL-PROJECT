from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_config():
    body = client.get("/api/config").json()
    assert len(body["type_rules"]) == 25
    assert {loc["building"] for loc in body["locations"]} == {"RVS", "LKS"}
    assert body["cost_weights"]["year_gap"] == 1000
