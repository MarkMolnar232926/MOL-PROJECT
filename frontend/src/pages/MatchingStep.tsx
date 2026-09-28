import { useEffect, useMemo, useState } from "react";
import type { IncomingResult, SessionResult } from "../api/client";
import { Assistant } from "../components/Assistant";
import { StatusBadge, Tag } from "../components/Badge";
import { columnHelper, DataTable, type Columns } from "../components/DataTable";
import { noteText, useLanguage, useT, type Messages } from "../i18n";

export type MatchingTab = "overview" | "resolve" | "all";

type Props = {
  sessionId: string;
  result: SessionResult;
  tab: MatchingTab;
  setTab: (tab: MatchingTab) => void;
  active: boolean; // false while another step is shown (keyboard shortcuts off)
};

function Kpis({ result }: { result: SessionResult }) {
  const t = useT();
  const c = result.summary.status_counts;
  const n = (k: string) => c[k] ?? 0;
  // [test id, label, value, colour]; the id stays the same in every language.
  const tiles: [string, string, number, string][] = [
    ["auto", t.matching.kpi.auto, n("auto"), "text-green-700"],
    ["newest", t.matching.kpi.newest, n("auto_newest"), "text-emerald-700"],
    ["location", t.matching.kpi.location, result.summary.location_mismatches, "text-amber-700"],
    ["unresolved", t.matching.kpi.unresolved, result.summary.unresolved, "text-red-700"],
    ["manual", t.matching.kpi.manual, n("manual"), "text-blue-700"],
    ["no-match", t.matching.kpi.noMatch, n("no_match"), "text-slate-700"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map(([id, label, value, color]) => (
        <div key={id} className="rounded-lg border border-slate-200 bg-white p-3">
          <dt className="text-xs text-slate-600">{label}</dt>
          <dd className={`text-2xl font-semibold ${color}`} data-testid={`kpi-${id}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Remaining({ result, onQueue }: { result: SessionResult; onQueue: () => void }) {
  const t = useT();
  const left = result.summary.unresolved;
  return left > 0 ? (
    <p className="text-sm">
      <span data-testid="remaining">{t.matching.remaining(left)}</span>{" "}
      <button type="button" className="link" onClick={onQueue}>
        {t.matching.toQueue}
      </button>
    </p>
  ) : (
    <p className="text-sm text-green-800">{t.matching.allResolved}</p>
  );
}

function Overview({ result, onQueue }: { result: SessionResult; onQueue: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  return (
    <div className="space-y-4">
      <Kpis result={result} />
      <Remaining result={result} onQueue={onQueue} />
      {result.warnings.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <h3 className="font-medium">{t.matching.warnings}</h3>
          <ul className="list-disc pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{noteText(t, w)}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-1 font-semibold">{t.matching.log}</h3>
        {result.log.length === 0 ? (
          <p className="text-sm text-slate-500">{t.matching.logEmpty}</p>
        ) : (
          <table className="min-w-full rounded-lg bg-white text-sm" data-testid="decision-log">
            <thead className="bg-slate-100 text-left">
              <tr>
                {[t.cols.time, t.cols.row, t.cols.action, t.cols.oldValue, t.cols.newValue, t.cols.reason].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.log.map((e, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1">{new Date(e.at).toLocaleTimeString(language)}</td>
                  <td className="px-2 py-1">{e.row}</td>
                  <td className="px-2 py-1">{t.matching.logAction[e.action] ?? e.action}</td>
                  <td className="px-2 py-1 font-mono">{e.old_asset_id ?? "–"}</td>
                  <td className="px-2 py-1 font-mono">{e.new_asset_id ?? "–"}</td>
                  <td className="px-2 py-1">
                    {[e.reason ? t.reasons[e.reason] : null, e.note].filter(Boolean).join(" – ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const col = columnHelper<IncomingResult>();
const allColumns = (t: Messages, open: (row: number) => void): Columns<IncomingResult> =>
  col.columns([
    col.accessor((r) => r.item.excel_row, { id: "row", header: t.cols.row }),
    col.accessor((r) => r.item.item_name ?? "", { id: "item", header: t.cols.itemName }),
    col.accessor((r) => r.item.color ?? "", { id: "color", header: t.cols.color }),
    col.accessor((r) => r.item.width_cm ?? "", { id: "width", header: t.cols.width }),
    col.accessor((r) => r.item.building ?? "", { id: "building", header: t.cols.building }),
    col.accessor((r) => r.item.serial_no ?? "", { id: "serial", header: t.cols.serial }),
    // The status column holds the translated label, so the text filter works in any language.
    col.accessor((r) => t.status[r.status], {
      id: "status",
      header: t.cols.status,
      cell: (c) => (
        <span className="flex flex-wrap gap-1">
          <StatusBadge status={c.row.original.status} />
          {c.row.original.tie_resolved && c.row.original.status !== "auto_newest" && (
            <Tag tone="muted">{t.status.auto_newest}</Tag>
          )}
        </span>
      ),
    }),
    col.accessor((r) => r.asset_id ?? "", { id: "asset_id", header: t.cols.assetId }),
    col.accessor((r) => r.score ?? "", { id: "score", header: t.cols.score }),
    col.accessor((r) => (r.notes ?? []).map((n) => noteText(t, n)).join(" "), { id: "notes", header: t.cols.notes }),
    col.display({
      id: "open",
      header: "",
      cell: (c) => (
        <button
          type="button"
          className="link"
          onClick={(e) => {
            e.stopPropagation();
            open(c.row.original.item.excel_row);
          }}
        >
          {t.matching.open}
        </button>
      ),
    }),
  ]);

/** Rows to work through: every row that is (or became) unresolved, in file order first. */
function useQueue(result: SessionResult) {
  const [queue, setQueue] = useState<number[]>(() =>
    result.rows.filter((r) => !r.resolved).map((r) => r.item.excel_row),
  );
  useEffect(() => {
    setQueue((q) => {
      const add = result.rows.filter((r) => !r.resolved && !q.includes(r.item.excel_row));
      return add.length ? [...q, ...add.map((r) => r.item.excel_row)] : q;
    });
  }, [result]);
  return [queue, setQueue] as const;
}

export function MatchingStep({ sessionId, result, tab, setTab, active }: Props) {
  const t = useT();
  const [queue, setQueue] = useQueue(result);
  const [current, setCurrent] = useState<number | null>(null);
  const columns = useMemo(
    () =>
      allColumns(t, (row) => {
        setCurrent(row);
        setTab("resolve");
      }),
    [t, setTab],
  );
  const tabs: [MatchingTab, string][] = [
    ["overview", t.matching.tabs.overview],
    ["resolve", `${t.matching.tabs.resolve} (${result.summary.unresolved})`],
    ["all", t.matching.tabs.all],
  ];
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t.matching.tabsLabel} className="flex gap-1 border-b border-slate-200">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === id ? "border-blue-700 font-semibold text-blue-800" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <Overview result={result} onQueue={() => setTab("resolve")} />}
        {tab === "resolve" && (
          <Assistant
            sessionId={sessionId}
            result={result}
            queue={queue}
            setQueue={setQueue}
            current={current}
            setCurrent={setCurrent}
            active={active}
          />
        )}
        {tab === "all" && (
          <DataTable
            label={t.matching.tabs.all}
            data={result.rows}
            columns={columns}
            getRowId={(r) => String(r.item.excel_row)}
            statusOf={(r) => r.status}
            statusLabel={(s) => t.status[s as IncomingResult["status"]] ?? s}
            onRowClick={(r) => {
              setCurrent(r.item.excel_row);
              setTab("resolve");
            }}
          />
        )}
      </div>
    </div>
  );
}
