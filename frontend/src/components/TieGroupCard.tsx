import { useState } from "react";
import type { TieAssignment, TieGroup } from "../api/client";
import { t } from "../i18n/en";
import { initialDraft, optionsFor, suggestionAssignments, type TieDraft } from "./tieOptions";

type Props = {
  group: TieGroup;
  busy?: boolean;
  onSave: (assignments: TieAssignment[]) => void;
  onReset: () => void;
};

const NONE = "";

export function TieGroupCard({ group, busy, onSave, onReset }: Props) {
  // Re-initialise the draft whenever the server's view of the group changes.
  const serverKey = JSON.stringify(group.slots);
  const [draftState, setDraftState] = useState<{ key: string; draft: TieDraft }>({
    key: serverKey,
    draft: initialDraft(group),
  });
  const draft = draftState.key === serverKey ? draftState.draft : initialDraft(group);
  const setDraft = (next: TieDraft) => setDraftState({ key: serverKey, draft: next });

  const dirty = group.slots.some(
    (s) => !s.decided || draft[s.sap_row] !== (s.chosen_asset_id ?? null),
  );
  const shared = t.ties.shared(
    group.sap_type,
    group.color ?? "–",
    group.width_cm != null ? `${group.width_cm} cm` : "–",
    group.year != null ? String(group.year) : "–",
    group.locations.join(" / "),
  );

  return (
    <section
      aria-labelledby={`tie-${group.group_id}`}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="tie-group"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`tie-${group.group_id}`} className="font-semibold">
          {shared}
        </h3>
        <span
          className={`text-sm ${group.pending_slots ? "text-orange-700" : "text-green-700"}`}
        >
          {group.pending_slots ? t.ties.pending(group.pending_slots) : t.ties.allDecided}
        </span>
      </div>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-slate-600">
          <tr>
            <th className="py-1 pr-2 font-medium">{t.cols.serial}</th>
            <th className="py-1 pr-2 font-medium">{t.cols.building}</th>
            <th className="py-1 pr-2 font-medium">{t.cols.remarks}</th>
            <th className="py-1 pr-2 font-medium">{t.cols.qr}</th>
            <th className="py-1 font-medium">{t.cols.assetId}</th>
          </tr>
        </thead>
        <tbody>
          {group.slots.map((slot) => {
            const value = draft[slot.sap_row] ?? NONE;
            const options = optionsFor(group, draft, slot.sap_row);
            return (
              <tr key={slot.sap_row} className="border-t border-slate-100">
                <td className="py-1.5 pr-2">{slot.serial_no}</td>
                <td className="py-1.5 pr-2">{slot.building}</td>
                <td className="py-1.5 pr-2">{slot.remarks ?? ""}</td>
                <td className="py-1.5 pr-2 font-mono text-xs">{slot.qr_code ?? ""}</td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={t.ties.chooseFor(slot.serial_no ?? String(slot.sap_row))}
                      className="input w-[30rem] max-w-full"
                      value={value}
                      disabled={busy}
                      onChange={(e) =>
                        setDraft({ ...draft, [slot.sap_row]: e.target.value || null })
                      }
                    >
                      <option value={NONE}>{t.ties.leaveUnmatched}</option>
                      {options.map((c) => (
                        <option key={c.asset_id} value={c.asset_id}>
                          {t.ties.candidate(
                            c.asset_id,
                            c.activation_date ?? "–",
                            c.city ?? "–",
                            c.custodian ?? "–",
                            c.gross_value != null ? `$${c.gross_value}` : "–",
                          )}
                          {c.asset_id === slot.suggested_asset_id ? ` (${t.ties.suggested})` : ""}
                        </option>
                      ))}
                    </select>
                    <span
                      className={`text-xs ${slot.decided ? "text-blue-700" : "text-orange-700"}`}
                    >
                      {slot.decided
                        ? t.ties.decided
                        : value === (slot.suggested_asset_id ?? NONE)
                          ? t.ties.suggested
                          : ""}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !dirty}
          onClick={() =>
            onSave(
              group.slots.map((s) => ({
                sap_row: s.sap_row,
                physical_asset_id: draft[s.sap_row] ?? null,
              })),
            )
          }
        >
          {t.ties.save}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || group.pending_slots === 0}
          onClick={() => onSave(suggestionAssignments(group))}
        >
          {t.ties.accept}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onReset}>
          {t.ties.reset}
        </button>
      </div>
    </section>
  );
}
