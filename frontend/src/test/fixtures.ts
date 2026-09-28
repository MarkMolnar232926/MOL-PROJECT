import type {
  Candidate,
  CriterionCheck,
  ExistingItem,
  IncomingResult,
  RowStatus,
  SessionResult,
  SessionState,
} from "../api/client";

export function unit(assetId: string, over: Partial<ExistingItem> = {}): ExistingItem {
  return {
    excel_row: 2,
    asset_id: assetId,
    item_name: "table",
    description: "office desk with 4 drawers, 120cm wide, oak",
    sap_type: "Work Desk",
    color: "oak",
    width_cm: 120,
    size_word: null,
    materials: ["oak"],
    city: "Lakeside",
    building: "LKS",
    custodian: "Marcus Reid",
    activation_date: "2021-05-06",
    deactivation_date: null,
    status: null,
    defective: false,
    ...over,
  };
}

export function row(excelRow: number, status: RowStatus, assetId: string | null = null): IncomingResult {
  const resolved = !["no_candidate", "duplicate"].includes(status);
  return {
    item: {
      excel_row: excelRow,
      asset_id: null,
      asset_group: "> Movable Furniture",
      asset_category: "Desks",
      item_name: "Work Desk",
      color: "oak",
      material: "Oak veneer",
      width_cm: 120,
      height_cm: 75,
      depth_cm: 60,
      serial_no: `SN-2021-${excelRow}`,
      remarks: null,
      qr_code: `INV00000${excelRow}`,
      building: "LKS",
      city: "Lakeside",
      duplicate_of: status === "duplicate" ? 2 : null,
    },
    status,
    resolved,
    asset_id: assetId,
    existing_row: assetId ? 10 : null,
    score: assetId ? 100 : null,
    checks: [],
    location_mismatch: false,
    tie_resolved: status === "auto_newest",
    auto_asset_id: assetId,
    reason: null,
    note: null,
    notes: [],
  };
}

export function result(rows: IncomingResult[], sessionId = "s1"): SessionResult {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const unresolved = rows.filter((r) => !r.resolved).length;
  return {
    session_id: sessionId,
    summary: {
      incoming_rows: rows.length,
      existing_units: 81,
      resolved: rows.length - unresolved,
      unresolved,
      status_counts: counts,
      location_mismatches: 0,
      tie_resolved: 0,
      unpaired_existing: 1,
      auto_match_threshold: 80,
      export_ready: unresolved === 0,
    },
    rows,
    unpaired_existing: [unit("84268852", { city: "Riverside", building: "RVS" })],
    log: [],
    warnings: [],
  };
}

const CHECKS: [CriterionCheck["criterion"], boolean | null][] = [
  ["type", true],
  ["color", true],
  ["size", true],
  ["location", false],
  ["material", null],
];

export function candidate(assetId: string, score: number, over: Partial<Candidate> = {}): Candidate {
  return {
    existing: unit(assetId),
    score,
    checks: CHECKS.map(([criterion, match]) => ({
      criterion,
      evaluable: match !== null,
      match,
      existing: criterion === "location" ? "Riverside" : "x",
      incoming: criterion === "location" ? "LKS" : "x",
    })),
    hard_ok: true,
    qr_match: false,
    paired_row: null,
    ...over,
  };
}

export function sessionState(over: Partial<SessionState> = {}): SessionState {
  return { session_id: "s1", original: null, incoming: null, matched: false, ...over };
}
