import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  api,
  ApiError,
  type Discrepancy,
  type PhysicalRow,
  type SapRow,
  type SessionResult,
  type TieAssignment,
} from "../api/client";
import { ConfidenceBadge, StatusBadge } from "../components/Badge";
import { columnHelper, DataTable, type Columns } from "../components/DataTable";
import { KpiTiles } from "../components/KpiTiles";
import { PairDetail } from "../components/PairDetail";
import { QrPanel } from "../components/QrPanel";
import { suggestionAssignments } from "../components/tieOptions";
import { TiesView } from "../components/TiesView";
import { t } from "../i18n/en";

type Tab = "sap" | "physical" | "discrepancies" | "ties";

const sapCol = columnHelper<SapRow>();
const sapColumns: Columns<SapRow> = sapCol.columns([
  sapCol.accessor("excel_row", { header: t.cols.row }),
  sapCol.accessor((r) => r.asset_id ?? "", { id: "asset_id", header: t.cols.assetId }),
  sapCol.accessor("item_name", { header: t.cols.sapItem }),
  sapCol.accessor("color", { header: t.cols.color }),
  sapCol.accessor("width_cm", { header: t.cols.width }),
  sapCol.accessor("serial_no", { header: t.cols.serial }),
  sapCol.accessor("building", { header: t.cols.building }),
  sapCol.accessor("match_status", {
    header: t.cols.status,
    cell: (c) => <StatusBadge status={c.getValue()} />,
  }),
  sapCol.accessor((r) => r.confidence ?? "", {
    id: "confidence",
    header: t.cols.confidence,
    cell: (c) => <ConfidenceBadge confidence={c.row.original.confidence} />,
  }),
  sapCol.accessor((r) => r.matched_physical_row ?? "", { id: "matched", header: t.cols.matchedRow }),
  sapCol.accessor((r) => (r.qr_agrees == null ? "" : r.qr_agrees ? t.yes : t.no), {
    id: "qr_agrees",
    header: t.cols.qrAgrees,
  }),
  sapCol.accessor((r) => (r.notes ?? []).join(" "), { id: "notes", header: t.cols.notes }),
]);

const physCol = columnHelper<PhysicalRow>();
const physicalColumns: Columns<PhysicalRow> = physCol.columns([
  physCol.accessor("excel_row", { header: t.cols.row }),
  physCol.accessor((r) => r.asset_id ?? "", { id: "asset_id", header: t.cols.assetId }),
  physCol.accessor("item_name", { header: t.cols.itemName }),
  physCol.accessor("description", { header: t.cols.description }),
  physCol.accessor((r) => r.sap_type ?? "", { id: "sap_type", header: t.cols.sapItem }),
  physCol.accessor("city", { header: t.cols.city }),
  physCol.accessor((r) => r.activation_date ?? "", { id: "activation", header: t.cols.activation }),
  physCol.accessor("match_status", {
    header: t.cols.status,
    cell: (c) => <StatusBadge status={c.getValue()} />,
  }),
  physCol.accessor((r) => r.matched_sap_row ?? "", { id: "matched", header: t.cols.matchedRow }),
  physCol.accessor((r) => (r.notes ?? []).join(" "), { id: "notes", header: t.cols.notes }),
]);

const discCol = columnHelper<Discrepancy & { id: string }>();
const discrepancyColumns: Columns<Discrepancy & { id: string }> = discCol.columns([
  discCol.accessor("kind", { header: t.cols.issue }),
  discCol.accessor((r) => r.physical_row ?? "", { id: "physical_row", header: t.cols.physicalRow }),
  discCol.accessor((r) => r.sap_row ?? "", { id: "sap_row", header: t.cols.sapRow }),
  discCol.accessor((r) => r.asset_id ?? "", { id: "asset_id", header: t.cols.assetId }),
  discCol.accessor("message", { header: t.cols.explanation }),
]);

type Props = { sessionId: string; onExpired: () => void };

export function ResultsPage({ sessionId, onExpired }: Props) {
  const qc = useQueryClient();
  const key = ["result", sessionId];
  const result = useQuery({
    queryKey: key,
    queryFn: () => api.result(sessionId),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const [tab, setTab] = useState<Tab>("sap");
  const [qrTarget, setQrTarget] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<{ sap: number | null; physical: number | null } | null>(null);

  const rematch = useMutation({
    mutationFn: (useQr: boolean) => api.rematch(sessionId, useQr),
    onSuccess: (data) => qc.setQueryData(key, data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const decide = useMutation({
    mutationFn: ({ groupId, assignments }: { groupId: string; assignments: TieAssignment[] }) =>
      api.decideTie(sessionId, groupId, assignments),
    onSettled: refresh,
  });
  const reset = useMutation({
    mutationFn: (groupId: string) => api.resetTie(sessionId, groupId),
    onSettled: refresh,
  });
  const acceptAll = useMutation({
    mutationFn: async (data: SessionResult) => {
      for (const g of data.tie_groups.filter((g) => g.pending_slots > 0)) {
        await api.decideTie(sessionId, g.group_id, suggestionAssignments(g));
      }
    },
    onSettled: refresh,
  });

  const data = result.data;
  const sapByRow = useMemo(() => new Map(data?.sap_rows.map((r) => [r.excel_row, r])), [data]);
  const physByRow = useMemo(() => new Map(data?.physical_rows.map((r) => [r.excel_row, r])), [data]);
  const discrepancies = useMemo(
    () => (data?.discrepancies ?? []).map((d, i) => ({ ...d, id: String(i) })),
    [data],
  );

  if (result.isPending) return <p>{t.loading}</p>;
  if (result.isError) {
    const expired = result.error instanceof ApiError && result.error.status === 404;
    return (
      <div role="alert" className="space-y-2">
        <p>{expired ? t.results.expired : result.error.message}</p>
        {expired && (
          <button type="button" className="btn-primary" onClick={onExpired}>
            {t.nav.upload}
          </button>
        )}
      </div>
    );
  }

  if (!data) return <p>{t.loading}</p>;

  const busy = decide.isPending || reset.isPending || acceptAll.isPending || rematch.isPending;
  const tieError = [decide.error, reset.error, acceptAll.error, rematch.error].find(Boolean);
  const tabs: [Tab, string][] = [
    ["sap", t.results.tabs.sap],
    ["physical", t.results.tabs.physical],
    ["discrepancies", `${t.results.tabs.discrepancies} (${data.discrepancies.length})`],
    ["ties", `${t.results.tabs.ties} (${data.summary.tie_slots_pending})`],
  ];

  return (
    <div className="space-y-4">
      <KpiTiles summary={data.summary} />
      <QrPanel
        qr={data.qr_assessment}
        useQr={qrTarget ?? data.summary.use_qr}
        busy={rematch.isPending}
        onToggle={(v) => {
          setQrTarget(v); // show the requested state at once, until the rematch returns
          rematch.mutate(v, { onSettled: () => setQrTarget(null) });
        }}
      />
      {data.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium">{t.results.warnings}</p>
          <ul className="list-disc pl-5">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {tieError && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">
          {tieError.message}
        </p>
      )}

      <div role="tablist" aria-label="Result views" className="flex gap-1 border-b border-slate-200">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${
              tab === id
                ? "border-slate-200 border-b-white bg-white font-semibold"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-4">
        {tab === "sap" && (
          <DataTable
            label={t.results.tabs.sap}
            data={data.sap_rows}
            columns={sapColumns}
            getRowId={(r) => String(r.excel_row)}
            statusOf={(r) => r.match_status}
            selectedId={selected?.sap != null ? String(selected.sap) : null}
            onRowClick={(r) => setSelected({ sap: r.excel_row, physical: r.matched_physical_row ?? null })}
          />
        )}
        {tab === "physical" && (
          <DataTable
            label={t.results.tabs.physical}
            data={data.physical_rows}
            columns={physicalColumns}
            getRowId={(r) => String(r.excel_row)}
            statusOf={(r) => r.match_status}
            selectedId={selected?.physical != null ? String(selected.physical) : null}
            onRowClick={(r) => setSelected({ sap: r.matched_sap_row ?? null, physical: r.excel_row })}
          />
        )}
        {tab === "discrepancies" && (
          <DataTable
            label={t.results.tabs.discrepancies}
            data={discrepancies}
            columns={discrepancyColumns}
            getRowId={(r) => r.id}
            statusOf={(r) => r.kind}
            onRowClick={(r) => setSelected({ sap: r.sap_row ?? null, physical: r.physical_row ?? null })}
          />
        )}
        {tab === "ties" && (
          <TiesView
            groups={data.tie_groups}
            busy={busy}
            onSave={(groupId, assignments) => decide.mutate({ groupId, assignments })}
            onReset={(groupId) => reset.mutate(groupId)}
            onAcceptAll={() => acceptAll.mutate(data)}
          />
        )}
        {selected && tab !== "ties" && (
          <PairDetail
            sap={selected.sap != null ? (sapByRow.get(selected.sap) ?? null) : null}
            physical={selected.physical != null ? (physByRow.get(selected.physical) ?? null) : null}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
