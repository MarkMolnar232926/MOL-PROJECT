import { useState } from "react";
import type { TieAssignment, TieGroup } from "../api/client";
import { useT } from "../i18n";
import { ConfirmDialog } from "./Dialog";
import { TieGroupCard } from "./TieGroupCard";

type Props = {
  groups: TieGroup[];
  busy: boolean;
  onSave: (groupId: string, assignments: TieAssignment[]) => void;
  onReset: (groupId: string) => void;
  onAcceptAll: () => void;
};

export function TiesView({ groups, busy, onSave, onReset, onAcceptAll }: Props) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const total = groups.reduce((n, g) => n + g.slots.length, 0);
  const pending = groups.reduce((n, g) => n + g.pending_slots, 0);
  if (groups.length === 0) return <p className="text-sm text-slate-600">{t.ties.none}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium" data-testid="ties-remaining">
          {t.ties.remaining(pending, total)}
        </p>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || pending === 0}
          onClick={() => setConfirming(true)}
        >
          {t.ties.acceptAll}
        </button>
      </div>
      {groups.map((g) => (
        <TieGroupCard
          key={g.group_id}
          group={g}
          busy={busy}
          onSave={(a) => onSave(g.group_id, a)}
          onReset={() => onReset(g.group_id)}
        />
      ))}
      {confirming && (
        <ConfirmDialog
          title={t.ties.acceptAll}
          message={t.ties.acceptAllConfirm(pending)}
          confirmLabel={t.ties.acceptAll}
          onConfirm={() => {
            setConfirming(false);
            onAcceptAll();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
