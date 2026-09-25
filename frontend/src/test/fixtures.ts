import type { SessionCreated, TieGroup } from "../api/client";

export function tieGroup(overrides: Partial<TieGroup> = {}): TieGroup {
  const candidate = (asset_id: string, physical_row: number, date: string) => ({
    physical_row,
    asset_id,
    activation_date: date,
    city: "Lakeside",
    building: "LKS",
    custodian: "Tester",
    gross_value: 220,
  });
  const slot = (sap_row: number, serial: string, suggested: string) => ({
    sap_row,
    serial_no: serial,
    building: "LKS",
    remarks: null,
    qr_code: null,
    suggested_asset_id: suggested,
    chosen_asset_id: null,
    decided: false,
    confidence: "Needs decision" as const,
  });
  return {
    group_id: "work-desk-2021-r3",
    sap_type: "Work Desk",
    color: "oak",
    width_cm: 120,
    year: 2021,
    locations: ["LKS"],
    physical_rows: [17, 47, 78],
    sap_rows: [3, 69, 75],
    candidates: [
      candidate("84298003", 78, "2021-03-17"),
      candidate("84214252", 73, "2021-05-06"),
      candidate("84236836", 47, "2021-09-17"),
    ],
    slots: [
      slot(3, "SN-2021-3808", "84214252"),
      slot(69, "SN-2021-4894", "84236836"),
      slot(75, "SN-2021-3498", "84298003"),
    ],
    proposed_pairs: [],
    pending_slots: 3,
    ...overrides,
  };
}

export const created: SessionCreated = {
  session_id: "sess-1",
  detected: [
    { source: "physical", file_name: "book.xlsx", sheet_name: "Physical_Inventory", detected_by: "sheet_name", row_count: 84, missing_optional_columns: [] },
    { source: "sap", file_name: "book.xlsx", sheet_name: "SAP_Export", detected_by: "sheet_name", row_count: 84, missing_optional_columns: ["QR Code"] },
  ],
  warnings: [],
  summary: {
    physical_total: 84, sap_total: 84, pairs: 74,
    physical_status_counts: {}, sap_status_counts: {}, confidence_counts: {},
    location_mismatches: 5, tie_groups: 7, tie_slots: 17, tie_slots_pending: 17,
    manual_decisions: 0, use_qr: false, rules_version: "1",
  },
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
