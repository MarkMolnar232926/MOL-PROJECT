# Master Prompt — Inventory Reconciliation Web App

> Execute phase by phase. Stop at each checkpoint. The practice workbook lives in `tests/fixtures/Inventory_Reconciliation_Practice_1.xlsx`.

---

## 0. Role and working agreement

You are building a small, production-quality web app that reconciles two inventory data sources and fills in a missing Asset ID column. Work in phases (section 9). At the end of every phase: run the tests, show me a short summary of what changed, and **stop and wait for my OK** before starting the next phase. If anything in this document is ambiguous or contradicts what you see in the data, ask me instead of guessing. Items marked **[DECISION]** are defaults I have chosen provisionally — implement them as configurable where noted.

---

## 1. Goal

A user uploads two Excel files:

1. **Physical_Inventory** — an on-site stocktake digitised from paper. Vague item names, a short free-text description, location as a *city*, and a real **Asset ID** per unit.
2. **SAP_Export** — the official fixed-asset system export. Precise item names and attributes (colour, material, dimensions, serial no.), location as a *building code* — but the **Asset ID column is empty**.

The app matches each SAP row to the physical unit it represents, writes the physical Asset ID into the SAP row, and reports every discrepancy. The user can review the result in the browser and download it as Excel.

For development, both tables live in **one workbook** (sheets `Physical_Inventory` and `SAP_Export`). The app must accept **either** one workbook containing both sheets **or** two separate files (one per source). Detect which sheet is which by sheet name first, then by header signature (section 3), and show the user what was detected.

---

## 2. Tech stack (decided)

**Backend — Python 3.11+**
- `backend/recon/`: the matching engine as a pure, framework-free package (`pandas`, `openpyxl`, `scipy` for `linear_sum_assignment`, `pydantic` models for config and results). It must not import FastAPI.
- `backend/api/`: **FastAPI** app that wraps the engine. `uvicorn` to run.
- `pytest` + `httpx` for engine and API tests; `ruff` for lint/format.

**Frontend — React + TypeScript**
- **Vite + React + TypeScript**, **TanStack Table** for the result grids, **TanStack Query** for API calls, **Tailwind CSS** for styling. Keep dependencies minimal.
- `vitest` + React Testing Library for component tests.
- Types for API payloads generated from the FastAPI OpenAPI schema (`openapi-typescript`) so front and back never drift.

**Runtime**
- `docker-compose.yml` with two services (api, web); the Vite dev server proxies `/api` to FastAPI. A single `make dev` (or npm script) starts both.
- Local use for v1: no authentication, no database. Uploaded data is kept **in memory per reconciliation session** (`session_id` UUID, expires after 2 h idle). Design the session store behind an interface so it can later be swapped for Redis/DB if the app gets hosted for colleagues.
- No data leaves the machine.

**Repo layout**
```
backend/  recon/  api/  config/  tests/  pyproject.toml
frontend/ src/  (pages, components, api client)  package.json
tests/fixtures/Inventory_Reconciliation_Practice_1.xlsx   (shared by both)
docker-compose.yml  README.md  PLAN.md
```

---

## 3. Input data — observed facts (from the practice file)

### Physical_Inventory (header on row 1, 84 data rows)
| Column | Notes |
|---|---|
| Asset ID | 8-digit integer. **Not unique** — exact duplicate rows exist (double data entry). |
| Item name | Vague: `sofa, cabinet, table, stool, chair, shelf, armchair, bin, coat rack, screen, counter` |
| Description | Comma-separated. **Last token is always the colour.** May contain `NNcm wide` or the words `small` / `large`. |
| Custodian | Name |
| Site code | `4021` = Riverside, `4087` = Lakeside (consistent with City in all rows) |
| City | `Riverside` / `Lakeside` |
| Activation date | Date — used for FIFO |
| Deactivation date | Mostly empty; 3 rows filled (84213492, 84200684, 84241548) |
| Gross value ($), Monthly depr. ($) | Numbers (not used for matching) |
| Status | Empty or `Defective - pending write-off` |

### SAP_Export (header on row 1, 84 data rows)
| Column | Notes |
|---|---|
| Asset ID | **Empty — this is what we fill.** |
| Asset Group, Asset Category | e.g. `> Movable Furniture`, `Seating/Desks/Storage/Other` |
| Item Name | Precise type, e.g. `Swivel Chair`, `Wardrobe`, `Filing Cabinet` |
| Color, Material | Color compared case-insensitively to the description's last token |
| Width / Height / Depth (cm) | Integers. Width is used for size disambiguation |
| Serial No. | Format `SN-YYYY-NNNN`. The **year** is used for FIFO. **Serials are not globally unique** (e.g. `SN-2025-3396` appears on a Trash Bin and a Coat Rack) — never use serial alone as a key. |
| Remarks | Free text, informational |
| QR Code | Format `INV00` + 8 digits — see **section 6.7, this is critical** |
| Building | `RVS` = Riverside, `LKS` = Lakeside |

The workbook also contains a `Task` sheet (instructions) and a **hidden `Answer_Key` sheet**. The engine must **never read `Answer_Key`** at runtime; it is used only by the test suite.

Cell highlights on Physical_Inventory (pink/green/yellow) mark duplicates and defective rows. They are hints for humans; **do not use cell formatting as matching input.**

### Column mapping must be configurable
Real exports may use different header text. Put all expected column names in `config/columns.yaml` and match headers case-/whitespace-insensitively. On upload, validate that all required columns exist and show a clear error listing any missing ones.

---

## 4. Business rules (source: the `Task` sheet)

1. Use Item name + Description on Physical_Inventory to find the most accurate SAP match for every SAP row. The description distinguishes items sharing a vague name and ends with the colour, which must agree with SAP `Color`.
   - **1b.** Some types exist in two sizes. If the description states `NNcm wide`, match it exactly against SAP `Width (cm)`. If it says only `small` / `large`, compare against the SAP rows of the **same item type and same location** and take the one with the smaller / larger width.
2. **FIFO tie-break:** when several identical units of one type share a location, sort physical items by Activation date (oldest first) and SAP rows by the year in Serial No. (oldest first), and pair in that order.
3. Write the matched physical Asset ID into the SAP row's Asset ID column.
4. Physical rows with Status `Defective - pending write-off` are deliberately absent from SAP — exclude them from matching and report them as "Defective – excluded (expected)".
5. Leftovers are genuine discrepancies: a non-defective physical row with no SAP match, or a SAP row with no physical match.
6. Also detect: an identical row appearing twice in one sheet (double data entry), and matched pairs whose locations disagree.

---

## 5. Item-type classification rules (`config/type_rules.yaml`)

Classify each physical row into a SAP `Item Name` by `(item name, description keyword)`. First matching rule wins; keyword match is case-insensitive substring. An empty keyword means "any description". These 25 rules cover 100% of the practice data (verified) — see `backend/config/type_rules.yaml`.

A physical row that matches no rule gets status **Unclassified** and is listed in the discrepancy report (never silently dropped). The UI must show the rules table read-only in v1 (editable is phase 5, optional).

Location mapping in `config/locations.yaml`: `Riverside ↔ RVS ↔ 4021`, `Lakeside ↔ LKS ↔ 4087`.

---

## 6. Matching algorithm (engine spec)

### 6.1 Normalise
Trim strings, lowercase for comparisons, parse dates, extract from Description: `color` = last comma token; `width_cm` = regex `(\d+)\s*cm wide`; `size_word` = `\b(small|large)\b`. Extract `serial_year` from `SN-(\d{4})-`. Map City → building code. Keep the original Excel row number of every row (header = row 1) for reporting.

### 6.2 Duplicate detection (both sheets)
A duplicate = a row whose values in **all** original columns equal an earlier row in the same sheet. Keep the first occurrence as the "real" row; mark later ones `Duplicate entry` and exclude them from matching. Also warn separately if the same Asset ID (physical) or same QR code (SAP) appears on rows that are *not* fully identical — that is a data-quality issue, not a double entry.

### 6.3 Exclusions
Exclude physical rows with Status `Defective - pending write-off` (configurable list of excluded statuses).

### 6.4 Candidate constraints (hard)
A physical row P can pair with SAP row S only if:
- `P.sap_type == S.Item Name`
- `P.color == lower(S.Color)`
- if `P.width_cm` is set: `P.width_cm == S.Width`
- if `P.size_word` is set: compute the widths of SAP rows with the same type **and P's location** (fall back to all locations if none); `small` → min width, `large` → max width; require `S.Width` to equal it. If only one width exists, the size word is not restrictive.

### 6.5 Assignment (why not naive grouping)
**Do not** implement rule 2 as "group by type + location, then FIFO within the group, then match leftovers". It fails on the practice data: when a pair has a location mismatch, the mismatched unit sits in the wrong location group and shifts the whole FIFO chain, producing ~14 wrong pairs.

Instead, per SAP item type, solve a **minimum-cost bipartite assignment** (`scipy.optimize.linear_sum_assignment`) between eligible physical rows and SAP rows, with cost:

```
cost = 1000 * |activation_year - serial_year|     # FIFO: years should line up
     +  100 * (location differs)                    # prefer same location, allow mismatch
     + 0.001 * (fifo_rank_P - fifo_rank_S)^2        # deterministic FIFO order within ties
     + INF if any hard constraint fails
```
where `fifo_rank_P` = rank by Activation date and `fifo_rank_S` = rank by (serial_year, full serial string) within the type. Discard assigned pairs whose cost ≥ INF. Keep weights in config.

On the practice data this yields 74 pairs, every pair has `activation_year == serial_year`, exactly the 5 expected location mismatches, zero unmatched physical rows and exactly the 7 expected SAP-only rows.

### 6.6 Confidence per pair
- **High** — the pair is the only possibility (unique candidate on both sides after constraints), or years differ from every alternative.
- **Medium** — resolved by FIFO across different years.
- **Ambiguous tie** — two or more candidates on both sides have identical type, colour, width *and* the same year; the data cannot distinguish them.

**Tie handling (decided): the user picks in the UI.** The engine outputs each tie group as an explicit object — `{group_id, sap_type, location(s), year, physical_rows[], sap_rows[], proposed_pairs[]}` — where `proposed_pairs` is the deterministic FIFO tie-break, shown as a *suggestion only*. Pairs in a tie group start with status **Needs decision** and their SAP Asset ID is **not** considered final until the user confirms or changes it (section 7.3). Choices within a group must stay one-to-one (picking an ID for one SAP row removes it from the other rows' options; offer "none / leave unmatched" as well). A confirmed user choice gets confidence **Manual** and is recorded in an audit trail (who/when is out of scope for v1 — just "manually resolved" + timestamp).

In the practice data, 5 tie groups exist (11 assets). The Answer_Key pairs them differently from any deterministic rule, which proves they are genuinely undecidable from the attributes alone:

| Type | Location | Year | Physical Asset IDs | SAP serials |
|---|---|---|---|---|
| Swivel Chair (60cm) | RVS | 2019 | 84219511, 84247161 | SN-2019-3032, SN-2019-6040 |
| Work Desk (120cm) | LKS | 2021 | 84298003, 84214252, 84236836 | SN-2021-3808, -3498, -4894 |
| Large Storage Cabinet | RVS | 2019 | 84293764, 84205150 | SN-2019-8043, SN-2019-4589 |
| Conference Chair | LKS | 2025 | 84264116, 84245414 | SN-2025-4806, SN-2025-3911 |
| Shelf Unit | RVS/LKS | 2024 | 84287104, 84271689 | SN-2024-8750 (LKS), SN-2024-5113 (RVS) |

### 6.7 QR Code — optional, auto-assessed (it is unknown whether real exports fill it)
The SAP `QR Code` column (`INV00` + 8 digits) **contains the physical Asset ID** for every row in the practice file (verified: 100% agreement with Answer_Key). Whether real SAP exports populate it reliably is **not known yet**, so the app must handle all cases: column absent, partly empty, malformed, or fully populated.

Always run a **QR assessment** after loading and show it on the results page: % of SAP rows with a parseable QR, % whose ID exists in Physical_Inventory, and % agreement with the fuzzy match (computed with QR off). If coverage ≥ 90 % and agreement ≥ 95 %, show a hint "QR codes look reliable — consider enabling QR matching". Never switch it on automatically.

QR matching is a *default-off* pass controlled by a toggle "Use QR code as direct match" (re-runs matching for the session):
- **On:** before fuzzy matching, pair SAP rows whose QR-derived ID exists in Physical_Inventory (non-defective, non-duplicate) and whose type/colour are consistent; those become **High (QR)**. The fuzzy engine handles the rest. SAP rows whose QR ID has no physical row remain SAP-only discrepancies (do not write that ID into Asset ID; show it as "QR references missing asset").
- **Off:** QR is ignored entirely by matching, but after matching, show a **validation column** "QR agrees?" so users see where the fuzzy match and the QR disagree.
- **QR and ties:** when QR is on, a QR-confirmed pair inside a tie group resolves that slot automatically (confidence **High (QR)**); only the slots still undecided remain **Needs decision**.
- **Robustness:** a missing QR column, empty cells or malformed values must never raise an error — they simply count as "no QR" in the assessment.

### 6.8 Other flags (informational, do not block matching)
- Physical row has a Deactivation date but is still matched to an active SAP row → warning "Deactivated but present in SAP".
- Pair year gap > 0 → warning (does not occur in practice data).

---

## 7. Outputs

### 7.1 Result statuses
| Status | Meaning |
|---|---|
| Matched | 1:1 pair, locations agree |
| Matched – location mismatch | pair found, City ≠ Building |
| Needs decision | part of an unresolved tie group (6.6) |
| Manually resolved | tie slot confirmed/changed by the user |
| Physical only | non-defective physical row, no SAP match (discrepancy) |
| SAP only | SAP row with no physical match (missing/lost asset) |
| Defective – excluded | expected absence from SAP |
| Duplicate entry | later copy of an identical row (either sheet) |
| Unclassified | no type rule matched |

Confidence values: `High`, `High (QR)`, `Medium`, `Manual`, `Needs decision`.

### 7.2 Downloadable Excel (`reconciled_<timestamp>.xlsx`)
1. **SAP_Export_Completed** — the original SAP sheet, same columns and order, with Asset ID filled; plus appended columns `Match status`, `Confidence`, `Matched physical row`, `QR agrees?`, `Notes`. Keep the pale-yellow fill on Asset ID.
2. **Physical_Inventory_Annotated** — original columns plus `Match status`, `Matched SAP row`, `SAP Item Name`, `Notes`.
3. **Discrepancies** — one row per issue (Physical only, SAP only, Duplicate, Location mismatch, Unclassified, Unresolved tie, Deactivated warning, QR disagreement), with row references from both sheets and a plain-English explanation.
4. **Summary** — counts per status and confidence, QR assessment figures, input file names, timestamp, rule-set version, whether QR matching was on, number of manual decisions.
5. **Decisions_Log** — every manual tie decision: group, SAP row, chosen Asset ID, proposed Asset ID, timestamp.

**Unresolved ties at export:** allow the download, but the UI shows a confirmation dialog ("3 tie slots still need a decision — export anyway?"). Unresolved slots are exported with an **empty** Asset ID and status `Needs decision`, never with the provisional suggestion.

Use openpyxl, Arial font, frozen header rows, autofilter, sensible column widths. Write values, not formulas.

### 7.3 REST API (FastAPI, prefix `/api`)
| Method & path | Purpose |
|---|---|
| `POST /sessions` | multipart upload: either `workbook` (one file) or `physical` + `sap` (two files). Returns `session_id`, detected sheets, row counts, validation errors (HTTP 422 with a readable list of missing columns). Runs matching immediately with QR off. |
| `GET /sessions/{id}/result` | full result: summary, rows for both sheets with statuses, discrepancies, tie groups, QR assessment |
| `POST /sessions/{id}/rematch` | body `{use_qr: bool}` — reruns matching; manual decisions are **kept** where still valid, dropped with a warning otherwise |
| `PUT /sessions/{id}/ties/{group_id}` | body `{assignments: [{sap_row, physical_asset_id or null}]}` — server validates one-to-one within the group and that each choice was a candidate; returns the updated group |
| `DELETE /sessions/{id}/ties/{group_id}` | reset group to the suggestion |
| `GET /sessions/{id}/export` | streams the Excel file (7.2) |
| `GET /config` | type rules, location mapping, cost weights (read-only) |
| `GET /health` | liveness |

Upload limit 20 MB, only `.xlsx`/`.xlsm`; reject other types clearly. All engine errors map to structured JSON errors, never stack traces.

### 7.4 Web UI (React)
- **Upload page:** toggle "One workbook / Two files", drag-and-drop zones, then a confirmation panel with detected sheets and row counts, or the validation errors.
- **Results page:**
  - KPI tiles: matched, location mismatches, **needs decision**, SAP only, physical only, defective excluded, duplicates.
  - QR panel: assessment figures, the "looks reliable" hint when applicable, and the QR toggle (triggers `/rematch`, shows a spinner).
  - Tabs with sortable/filterable tables (TanStack Table): *All SAP rows*, *All physical rows*, *Discrepancies*, *Ties*. Colour-coded status/confidence badges. Clicking a row shows its matched counterpart side-by-side (all attributes, with differing fields highlighted).
- **Ties view (core of the "user picks" decision):** one card per tie group showing the shared attributes (type, colour, width, year, locations) and a small grid: each SAP row (serial, building, remarks, QR) with a dropdown of the candidate physical units (Asset ID, activation date, city, custodian, value). Pre-filled with the suggestion and labelled "suggested"; choosing an ID removes it from the other dropdowns in the group; "Accept suggestion" and "Reset" buttons per group; an "Accept all suggestions" button at the top with a confirmation. Show remaining count ("3 of 11 slots need a decision").
- **Rules page:** read-only view of type rules, location mapping and cost weights.
- **Export button** (always visible in the header), with the unresolved-ties dialog from 7.2.
- UI text in one `src/i18n/en.ts` file so a Dutch translation can be added later. Accessible (keyboard-navigable dropdowns, labelled controls). Works on a laptop screen; mobile is not a goal.

---

## 8. Testing (golden tests against the practice file)

Write `backend/tests/test_practice_file.py` that runs the engine on the fixture and compares to the hidden `Answer_Key` (the only place that sheet is read). The Answer_Key's `SAP_Export row(s)` / `Physical_Inventory row(s)` columns use Excel row numbers (header = row 1).

Required assertions with **QR off**:
- 84 physical rows, 84 SAP rows loaded; 25 rules classify all physical rows.
- Physical duplicates detected at rows **31, 44, 83**; SAP duplicates at rows **68, 77, 79**.
- 7 defective excluded: physical rows **42, 43, 45, 51, 57, 79, 82**.
- **74** pairs (incl. tie suggestions); **0** physical-only; **7** SAP-only at SAP rows **27, 32, 38, 50, 52, 72, 74**.
- Location mismatches exactly for Asset IDs **84208743, 84261222, 84283321, 84285415** plus one of the Shelf Unit tie pair (84287104 / 84271689).
- Every pair outside the 5 tie groups in 6.6 equals the Answer_Key (**63/63**, counting FIFO suggestions of the other tie groups).
- **[DECISION, phase 2]** Ties follow the attribute-based definition in 6.6, which yields **7 tie groups / 17 SAP slots** with status Needs decision on the practice file: the 5 groups listed in 6.6 (each contained in a detected group) plus Coat Rack 2021 (2 slots), Computer Desk 2024 RVS (2) and two more Shelf Units 2024 (84257423, 84229044) in the Shelf Unit group. The table in 6.6 lists only the slots where FIFO disagrees with the Answer_Key, which the engine cannot know. Suggestions pair only within their group.
- Totals reconcile: physical 74 + 7 + 3 = 84; SAP 74 + 7 + 3 = 84.

With **QR on**: 74/74 pairs equal the Answer_Key and **0** tie slots remain undecided. QR assessment on the fixture reports 100 % parseable, 91.7 % (77/84) IDs present in Physical_Inventory (the 7 SAP-only rows reference absent assets), and 100 % agreement outside tie groups.

Also test:
- Engine units: description parsing, size resolution (`small`/`large` with one vs two widths), duplicate detection, header detection, missing-column errors, QR edge cases (column missing, empty, malformed).
- Tie resolution: one-to-one enforcement, "none" choice, invalid candidate rejected, decisions surviving a `/rematch`.
- API: every endpoint incl. both upload modes, 422 on bad files, export round-trip (re-read the Excel; Asset IDs in the right rows; unresolved slots empty).
- Frontend: tie-picker component (options shrink as IDs are chosen), upload flow, export dialog.
- One Playwright end-to-end test: upload fixture → resolve all ties by accepting suggestions → export → file downloads.

---

## 9. Phased plan (stop after each checkpoint)

**Phase 1 — Scaffold & data loading.** Repo layout from section 2, pyproject, ruff, pytest, Vite app skeleton, docker-compose, `make dev`. Loaders for one-workbook and two-file input, header validation, normalisation, description parsing. *Checkpoint: print a parsed preview of both sheets; loading/parsing tests green; both dev servers start.*

**Phase 2 — Matching engine.** Duplicates, exclusions, classification, hard constraints, assignment, confidence, tie-group objects, QR assessment + QR pass, flags, manual-decision application. *Checkpoint: golden tests in section 8 pass; show me a console summary of counts, the QR assessment and the tie groups.*

**Phase 3 — Excel export.** The 5-sheet output in 7.2. *Checkpoint: generate the output from the fixture (once with ties unresolved, once with suggestions accepted) and summarise each sheet.*

**Phase 4 — API.** Endpoints in 7.3, in-memory session store, OpenAPI schema, API tests. *Checkpoint: show me the endpoint list from `/docs` and a curl walk-through (upload → result → resolve one tie → export).*

**Phase 5 — React UI.** Pages in 7.4 using generated types. *Checkpoint: I test it manually with the practice file; Playwright test green.*

**Phase 6 (optional, ask first) — Enhancements.** Editable rules in the UI (saved to YAML), manual override of any pair (not only ties), import of a previous Decisions_Log to reapply choices, Redis-backed sessions + login for hosted use, LLM-assisted suggestions for unclassified item descriptions.

---

## 10. Non-goals for v1
No authentication, no persistent database, no SAP write-back, no multi-user collaboration on one session. Don't over-engineer: a clear engine, good tests, a clean UI.

## 11. Definition of done
All backend, frontend and e2e tests green; `make dev` (or `docker compose up`) works from a fresh clone following the README; uploading the practice workbook produces the counts in section 8; ties can be resolved in the UI; the downloaded Excel contains the completed SAP sheet; every SAP row ends up with an Asset ID, a pending decision, or an explicit reason why not.
