# Inventory Reconciliation

Matches an on-site stocktake (**Physical_Inventory**) against an SAP fixed-asset export
(**SAP_Export**), fills in the SAP Asset ID column and reports every discrepancy.
Everything runs locally; no data leaves the machine. See [PLAN.md](PLAN.md) for the full spec
and phase plan.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, loading, header validation, normalisation | done |
| 2 | Matching engine + golden tests | done |
| 3 | Excel export | next |
| 4 | REST API + sessions | – |
| 5 | React UI | – |

## Layout

```
backend/   recon/   framework-free engine (pandas, openpyxl, scipy, pydantic)
           api/     FastAPI wrapper (prefix /api)
           config/  columns.yaml, type_rules.yaml, locations.yaml, matching.yaml
           tests/   pytest
frontend/  Vite + React + TypeScript + Tailwind + TanStack Query/Table
tests/fixtures/Inventory_Reconciliation_Practice_1.xlsx   (add this file yourself)
```

## Getting started

Requirements: Python 3.11+, Node 22+.

```bash
make install     # pip install -e backend[dev] + npm install
make dev         # API on :8000, web on :5173 (Vite proxies /api to the API)
make test        # pytest + vitest
make lint        # ruff + tsc
make preview     # parsed preview of the practice workbook
make preview FILE=path/to/other.xlsx
make report      # matching summary: counts, QR assessment, tie groups
make report QR=--qr   # same with QR matching switched on
```

With Docker instead: `docker compose up --build`, then open http://localhost:5173.

### Practice workbook

Copy `Inventory_Reconciliation_Practice_1.xlsx` to `tests/fixtures/`. Tests that need it are
skipped when it is missing. The hidden `Answer_Key` sheet is only ever read by the test suite;
the engine skips it (`ignored_sheets` in `columns.yaml`).

## Configuration

All files live in `backend/config/` (override the directory with `RECON_CONFIG_DIR`).

- **columns.yaml** – expected sheet names and column headers per source. Headers match
  case-/whitespace-insensitively; each column can list aliases. Missing *required* columns
  reject the upload with a list of what is missing; optional ones (e.g. `QR Code`) may be absent.
- **type_rules.yaml** – `(item name, description keyword) → SAP Item Name`, first match wins.
- **locations.yaml** – City ↔ Building ↔ Site code.
- **matching.yaml** – excluded statuses, assignment cost weights, QR hint thresholds.

## Input detection

Upload either one workbook containing both sheets, or two files. Each source is found by
sheet name first (`Physical_Inventory` / `SAP_Export`), then by header signature (a sheet that
has all required columns of that source). With two files, a swapped upload is still detected
and reported as a warning.

## API types

The frontend's API types are generated from the FastAPI OpenAPI schema:

```bash
make gen-api     # writes frontend/openapi.json and frontend/src/api/schema.d.ts
```
