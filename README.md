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
| 3 | Excel export | done |
| 4 | REST API + sessions | done |
| 5 | React UI | done |

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
make test-e2e    # Playwright end-to-end (upload → accept ties → export)
make lint        # ruff + tsc
make preview     # parsed preview of the practice workbook
make preview FILE=path/to/other.xlsx
make report      # matching summary: counts and tie groups
make export OUT=out.xlsx                          # reconciled workbook (ties left pending)
make export OUT=out.xlsx ARGS=--accept-suggestions  # ... with all tie suggestions accepted
```

With Docker instead: `docker compose up --build`, then open http://localhost:5173.

### Practice workbook

Copy `Inventory_Reconciliation_Practice_1.xlsx` to `tests/fixtures/`. Tests that need it are
skipped when it is missing. The hidden `Answer_Key` sheet is only ever read by the test suite;
the engine skips it (`ignored_sheets` in `columns.yaml`).

## Using the app

1. `make dev`, then open http://localhost:5173.
2. **Upload**: choose *One workbook* or *Two files*, drop the file(s), then *Upload and reconcile*.
   The panel shows which sheets were found and how, or lists missing columns.
3. **Results**: KPI tiles and tabs for all SAP rows, all physical rows, discrepancies and ties. Click a row to see it
   side by side with its matched counterpart; differing fields are highlighted.
4. **Ties**: one card per tie group. Each SAP row has a dropdown of the candidate units,
   pre-filled with the FIFO suggestion; a unit picked for one row disappears from the other
   rows' dropdowns. *Save choices*, *Accept suggestion* or *Reset* per group, or
   *Accept all suggestions* at the top.
5. **Export Excel** (top right) downloads the 5-sheet workbook. If tie slots are still open,
   you are asked first; those rows are exported with an empty Asset ID.
6. **Rules** shows the type rules, locations and cost weights (read-only).

### Languages

The header has a language picker (English / Magyar). The choice is remembered in the browser;
on the first visit Hungarian is picked automatically if the browser is set to Hungarian.

- UI text: one file per language in `frontend/src/i18n/` (`en.ts`, `hu.ts`). `hu.ts` must have
  the same shape as `en.ts` (TypeScript checks this).
- Server messages (notes, discrepancy explanations, warnings) are sent as a `code` plus
  `params`; their wording lives in `backend/recon/messages.py` (English, used by the Excel
  export) and in the `messages` section of each UI language file. A test fails if a code is
  missing from a language.
- To add a language: copy `en.ts` to e.g. `de.ts`, translate it, and register it in
  `frontend/src/i18n/index.tsx` (`LANGUAGES`).
- The Excel export is always in English.

## Configuration

All files live in `backend/config/` (override the directory with `RECON_CONFIG_DIR`).

- **columns.yaml** – expected sheet names and column headers per source. Headers match
  case-/whitespace-insensitively; each column can list aliases. Missing *required* columns
  reject the upload with a list of what is missing; optional ones (e.g. `QR Code`) may be absent.
  The QR code is shown as a label only; it is not an Asset ID and is never used for matching.
- **type_rules.yaml** – `(item name, description keyword) → SAP Item Name`, first match wins.
- **locations.yaml** – City ↔ Building ↔ Site code.
- **matching.yaml** – excluded statuses and assignment cost weights.

## Input detection

Upload either one workbook containing both sheets, or two files. Each source is found by
sheet name first (`Physical_Inventory` / `SAP_Export`), then by header signature (a sheet that
has all required columns of that source). With two files, a swapped upload is still detected
and reported as a warning.

## REST API

Interactive docs at http://localhost:8000/docs while `make api` (or `make dev`) runs.

| Method & path | Purpose |
|---|---|
| `POST /api/sessions` | multipart upload: `workbook`, or `physical` + `sap`; runs matching |
| `GET /api/sessions/{id}/result` | full result: summary, rows, pairs, tie groups, discrepancies |
| `PUT /api/sessions/{id}/ties/{group_id}` | `{"assignments": [{"sap_row": 2, "physical_asset_id": "84247161"}]}` (`null` = leave unmatched) |
| `DELETE /api/sessions/{id}/ties/{group_id}` | reset a tie group to the suggestion |
| `GET /api/sessions/{id}/export` | download `reconciled_<timestamp>.xlsx` |
| `DELETE /api/sessions/{id}` | discard a session |
| `GET /api/config`, `GET /api/health` | rules/locations/weights; liveness |

Sessions live in memory and expire after 2 h without access (`api/sessions.py`; swap
`InMemorySessionStore` for another `SessionStore` to host it). Uploads are limited to 20 MB,
`.xlsx`/`.xlsm` only. Errors are JSON: `{"error": {"code", "message", "details"}}`.

```bash
curl -F workbook=@tests/fixtures/Inventory_Reconciliation_Practice_1.xlsx localhost:8000/api/sessions
```

## API types

The frontend's API types are generated from the FastAPI OpenAPI schema:

```bash
make gen-api     # writes frontend/openapi.json and frontend/src/api/schema.d.ts
```
