import type { TieGroup } from "../api/client";

/** SAP row -> chosen physical Asset ID (null = leave unmatched). */
export type TieDraft = Record<number, string | null>;

/** Start from the decided choice, else the suggestion. */
export function initialDraft(group: TieGroup): TieDraft {
  return Object.fromEntries(
    group.slots.map((s) => [s.sap_row, s.decided ? (s.chosen_asset_id ?? null) : (s.suggested_asset_id ?? null)]),
  );
}

/** Candidates a slot may pick: every unit not already chosen by another slot of the group. */
export function optionsFor(group: TieGroup, draft: TieDraft, sapRow: number) {
  const takenElsewhere = new Set(
    Object.entries(draft)
      .filter(([row, id]) => Number(row) !== sapRow && id !== null)
      .map(([, id]) => id),
  );
  return group.candidates.filter((c) => !takenElsewhere.has(c.asset_id));
}

export function suggestionAssignments(group: TieGroup) {
  return group.slots.map((s) => ({
    sap_row: s.sap_row,
    physical_asset_id: s.decided ? (s.chosen_asset_id ?? null) : (s.suggested_asset_id ?? null),
  }));
}
