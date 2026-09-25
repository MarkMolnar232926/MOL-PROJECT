"""Loading/parsing checks against the real practice workbook (skipped if it is absent).

The golden matching tests (PLAN.md section 8) arrive in phase 2 as test_practice_file.py.
"""

from collections import Counter

from recon import InputFile, default_config, load_inputs, normalize


def _load(path):
    return normalize(load_inputs([InputFile(path.name, path.read_bytes())]))


def test_practice_sheets_and_row_counts(practice_file):
    data = _load(practice_file)
    assert data.loaded.physical.sheet_name == "Physical_Inventory"
    assert data.loaded.sap.sheet_name == "SAP_Export"
    assert len(data.physical) == 84
    assert len(data.sap) == 84
    assert data.physical["excel_row"].tolist() == list(range(2, 86))


def test_practice_parsing(practice_file):
    data = _load(practice_file)
    p, s = data.physical, data.sap
    assert set(p["item_name"]) <= {r.item for r in default_config().type_rules.rules}
    assert p["color"].notna().all()
    assert p["building"].notna().all()
    assert p["activation_date"].notna().all()
    assert Counter(p["status"])["Defective - pending write-off"] == 7
    assert int(p["deactivation_date"].notna().sum()) == 3
    assert s["serial_year"].notna().all()
    assert s["width_cm"].notna().all()
    assert s["qr_asset_id"].notna().all()
    assert all(v is None for v in s["asset_id"])
    assert data.issues == []
