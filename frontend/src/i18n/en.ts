// All user-facing text lives here so a Dutch translation can be added later.
export const en = {
  appTitle: "Inventory Reconciliation",
  apiStatus: "API status",
  apiOk: "connected",
  apiDown: "not reachable",
  checking: "checking…",
  placeholder: "Upload and results pages arrive in phase 5.",
} as const;

export type Messages = typeof en;
export const t: Messages = en;
