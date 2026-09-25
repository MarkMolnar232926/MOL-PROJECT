// All user-facing text lives in one file per language (en.ts, hu.ts).
// `Messages` is the shape every translation must follow.
import type { Confidence, Discrepancy, MatchStatus, MessageParams } from "../api/client";

export const en = {
  languageName: "English",
  languageLabel: "Language",
  appTitle: "Inventory Reconciliation",
  nav: { upload: "Upload", results: "Results", rules: "Rules" },
  apiDown: "The server is not reachable. Start it with `make dev`.",
  loading: "Loading…",
  close: "Close",
  cancel: "Cancel",

  upload: {
    title: "Upload inventory data",
    intro:
      "Upload the Physical_Inventory and SAP_Export data, either as one workbook with both sheets or as two files.",
    modeLabel: "Input",
    modeOne: "One workbook",
    modeTwo: "Two files",
    workbook: "Workbook (.xlsx / .xlsm)",
    physical: "Physical_Inventory file",
    sap: "SAP_Export file",
    drop: "Drag a file here or",
    browse: "choose a file",
    chosen: (name: string) => `Selected: ${name}`,
    remove: "Remove",
    submit: "Upload and reconcile",
    submitting: "Reconciling…",
    detectedTitle: "Detected sheets",
    detectedBy: { sheet_name: "by sheet name", header_signature: "by column headers" },
    rows: (n: number) => `${n} rows`,
    missingOptional: (cols: string) => `Optional columns not found: ${cols}`,
    warnings: "Warnings",
    viewResults: "View results",
    errorTitle: "The upload could not be processed",
    missingColumns: (sheet: string, cols: string) => `${sheet}: missing ${cols}`,
    sourceLabel: { physical: "Physical_Inventory", sap: "SAP_Export" },
  },

  results: {
    noSession: "No reconciliation yet. Upload a workbook first.",
    expired: "This session has expired. Please upload the files again.",
    kpi: {
      matched: "Matched",
      locationMismatch: "Location mismatches",
      needsDecision: "Needs decision",
      sapOnly: "SAP only",
      physicalOnly: "Physical only",
      defective: "Defective excluded",
      duplicates: "Duplicates",
    },
    tabs: {
      label: "Result views",
      sap: "All SAP rows",
      physical: "All physical rows",
      discrepancies: "Discrepancies",
      ties: "Ties",
    },
    filter: "Filter rows",
    statusFilter: "Status",
    allStatuses: "All statuses",
    rowCount: (shown: number, total: number) => `${shown} of ${total} rows`,
    noRows: "No rows match.",
    warnings: "Warnings",
  },

  // Labels for the values the server sends (the values themselves stay in English).
  status: {
    Matched: "Matched",
    "Matched – location mismatch": "Matched – location mismatch",
    "Needs decision": "Needs decision",
    "Manually resolved": "Manually resolved",
    "Physical only": "Physical only",
    "SAP only": "SAP only",
    "Defective – excluded": "Defective – excluded",
    "Duplicate entry": "Duplicate entry",
    Unclassified: "Unclassified",
  } as Record<MatchStatus, string>,
  confidence: {
    High: "High",
    Medium: "Medium",
    Manual: "Manual",
    "Needs decision": "Needs decision",
  } as Record<Confidence, string>,
  issue: {
    "Physical only": "Physical only",
    "SAP only": "SAP only",
    Duplicate: "Duplicate",
    "Location mismatch": "Location mismatch",
    Unclassified: "Unclassified",
    "Unresolved tie": "Unresolved tie",
    "Deactivated warning": "Deactivated warning",
    "Year gap": "Year gap",
    "Data quality": "Data quality",
  } as Record<Discrepancy["kind"], string>,

  // Error messages by the server's error code; anything else shows the server's own text.
  errors: {
    network_error: "The server could not be reached.",
    invalid_file: "The file is not a readable Excel workbook (.xlsx or .xlsm).",
    missing_columns: "Required columns are missing.",
    sheet_not_found: "No Physical_Inventory or SAP_Export sheet was found.",
    file_too_large: "The file is larger than 20 MB.",
    session_not_found: "This session has expired. Please upload the files again.",
    invalid_tie_decision: "That choice is not valid for this tie group.",
    export_failed: "The export failed.",
  } as Record<string, string>,

  // Server messages by code (backend/recon/messages.py). p = the message's parameters.
  messages: {
    unknown_city: (p) => `City '${p.city}' is not in the location mapping.`,
    site_city_conflict: (p) => `Site code ${p.site_code} does not belong to city '${p.city}'.`,
    bad_activation_date: (p) => `Activation date '${p.value}' could not be read.`,
    missing_asset_id: () => "Asset ID is empty.",
    unknown_building: (p) => `Building '${p.building}' is not in the location mapping.`,
    bad_serial: (p) => `Serial No. '${p.serial}' has no SN-YYYY- year.`,
    bad_width: (p) => `Width '${p.value}' is not a whole number.`,
    files_swapped: (p) =>
      `${p.sheet} was found in '${p.file}', which was uploaded as the ${p.role} file. The files may have been swapped.`,
    asset_id_conflict: (p) =>
      `Asset ID ${p.value} appears on rows ${p.rows} whose other values differ (not a plain double entry).`,
    qr_code_conflict: (p) =>
      `QR code ${p.value} appears on rows ${p.rows} whose other values differ (not a plain double entry).`,
    sap_duplicate: (p) => `Identical to SAP row ${p.first} (double data entry).`,
    physical_duplicate: (p) => `Identical to physical row ${p.first} (double data entry).`,
    defective_excluded: () => "Defective – excluded (expected to be absent from SAP).",
    unclassified_note: () => "No type rule matches this item name and description.",
    unclassified: (p) => `'${p.item}: ${p.description}' matches no type rule.`,
    sap_only: (p) => `No physical unit found for this ${p.item} (missing / lost asset).`,
    physical_only: (p) => `No SAP row found for this ${p.sap_type} (asset ${p.asset_id}).`,
    tie_pick: (p) =>
      `Tie group ${p.group}: pick the physical unit (suggested ${p.suggested ?? "leave unmatched"}).`,
    tie_unresolved: (p) =>
      `${p.sap_type} (${p.year ?? "?"}) in tie group ${p.group}: the attributes cannot tell these units apart; a decision is needed (suggested: ${p.suggested ?? "leave unmatched"}).`,
    tie_candidate: (p) => `Candidate in tie group ${p.group}.`,
    manual_unmatched: () => "Manually left unmatched.",
    manual_left_physical: () => "Left unmatched by the manual tie decisions.",
    decision_invalid: (p) =>
      `Manual decision for SAP row ${p.sap_row} (asset ${p.asset_id}) no longer fits its tie group and was dropped.`,
    decision_stale: (p) =>
      `Manual decision for SAP row ${p.sap_row} was dropped: that row no longer needs a decision.`,
    location_mismatch: (p) => `Physical says ${p.city}, SAP says ${p.building}.`,
    deactivated: () => "Deactivated but present in SAP (has a deactivation date).",
    year_gap: (p) => `Activation year and serial year differ by ${p.gap}.`,
  } as Record<string, (p: MessageParams) => string>,

  cols: {
    row: "Row",
    assetId: "Asset ID",
    itemName: "Item name",
    sapItem: "SAP Item Name",
    description: "Description",
    color: "Colour",
    width: "Width",
    serial: "Serial No.",
    building: "Building",
    city: "City",
    activation: "Activation date",
    status: "Match status",
    confidence: "Confidence",
    matchedRow: "Matched row",
    notes: "Notes",
    issue: "Issue",
    physicalRow: "Physical row",
    sapRow: "SAP row",
    explanation: "Explanation",
    custodian: "Custodian",
    value: "Gross value",
    remarks: "Remarks",
    qr: "QR Code",
    sheetStatus: "Status (sheet)",
    deactivation: "Deactivation date",
    material: "Material",
    year: "Year (serial / activation)",
  },

  detail: {
    title: "Matched pair",
    sap: "SAP_Export",
    physical: "Physical_Inventory",
    noCounterpart: "No matched counterpart.",
    differs: "Differs",
  },

  ties: {
    remaining: (pending: number, total: number) => `${pending} of ${total} slots need a decision`,
    none: "No tie groups — every pair could be decided from the data.",
    acceptAll: "Accept all suggestions",
    acceptAllConfirm: (n: number) =>
      `Accept the suggested unit for all ${n} undecided slots? You can still change them afterwards.`,
    accept: "Accept suggestion",
    save: "Save choices",
    reset: "Reset",
    suggested: "suggested",
    decided: "decided",
    leaveUnmatched: "None / leave unmatched",
    chooseFor: (serial: string) => `Physical unit for SAP ${serial}`,
    shared: (type: string, color: string, width: string, year: string, locs: string) =>
      `${type} · ${color} · ${width} · ${year} · ${locs}`,
    pending: (n: number) => `${n} pending`,
    allDecided: "All slots decided",
    candidate: (id: string, date: string, city: string, custodian: string, value: string) =>
      `${id} — ${date}, ${city}, ${custodian}, ${value}`,
  },

  exportButton: "Export Excel",
  exporting: "Exporting…",
  exportConfirmTitle: "Unresolved ties",
  exportConfirm: (n: number) =>
    `${n} tie slot${n === 1 ? "" : "s"} still need${n === 1 ? "s" : ""} a decision — export anyway? Those rows are exported with an empty Asset ID.`,
  exportAnyway: "Export anyway",

  rules: {
    title: "Rules and settings (read-only)",
    typeRules: (v: string) => `Type classification rules (version ${v})`,
    ruleItem: "Item name",
    ruleKeyword: "Description contains",
    ruleSapType: "SAP Item Name",
    anyDescription: "(any description)",
    locations: "Locations",
    siteCode: "Site code",
    weights: "Assignment cost weights",
    weightYear: "Per year between activation and serial year",
    weightLocation: "Location mismatch",
    weightFifo: "FIFO rank (squared difference)",
    excluded: "Excluded physical statuses",
  },
};

export type Messages = typeof en;
