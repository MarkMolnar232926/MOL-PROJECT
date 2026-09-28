import { useEffect, useMemo, useState } from "react";
import type { IncomingResult, SessionResult } from "../api/client";
import { Assistant } from "../components/Assistant";
import { StatusBadge, Tag } from "../components/Badge";
import { columnHelper, DataTable, type Columns } from "../components/DataTable";
import { Guide } from "../components/Guide";
import { Icon } from "../components/Icon";
import { noteText, useLanguage, useT, type Messages } from "../i18n";

export type MatchingTab = "overview" | "resolve" | "all";

type Props = {
  sessionId: string;
  result: SessionResult;
  tab: MatchingTab;
  setTab: (tab: MatchingTab) => void;
  active: boolean; // false while another step is shown (keyboard shortcuts off)
  onExport: () => void;
};

function Ring({ done, total }: { done: number; total: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const share = total ? done / total : 1;
  return (
    <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90" aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-slate-100" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - share)}
        className={`transition-[stroke-dashoffset] duration-700 ${share === 1 ? "stroke-emerald-500" : "stroke-indigo-600"}`}
      />
    </svg>
  );
}

function Kpis({ result }: { result: SessionResult }) {
  const t = useT();
  const c = result.summary.status_counts;
  const n = (k: string) => c[k] ?? 0;
  // [test id, label, help, value, colour]; the id stays the same in every language.
  const tiles: [string, string, string, number, string][] = [
    ["auto", t.matching.kpi.auto, t.matching.kpiHelp.auto, n("auto"), "text-emerald-700"],
    ["newest", t.matching.kpi.newest, t.matching.kpiHelp.newest, n("auto_newest"), "text-emerald-700"],
    ["unresolved", t.matching.kpi.unresolved, t.matching.kpiHelp.unresolved, result.summary.unresolved, "text-red-700"],
    ["manual", t.matching.kpi.manual, t.matching.kpiHelp.manual, n("manual"), "text-indigo-700"],
    ["no-match", t.matching.kpi.noMatch, t.matching.kpiHelp.noMatch, n("no_match"), "text-slate-700"],
    ["location", t.matching.kpi.location, t.matching.kpiHelp.location, result.summary.location_mismatches, "text-amber-700"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {tiles.map(([id, label, help, value, color]) => (
        <div key={id} className="rounded-xl border border-slate-200 bg-white p-3">
          <dt className="text-xs font-medium text-slate-600">{label}</dt>
          <dd className={`text-2xl font-bold tabular-nums ${color}`} data-testid={`kpi-${id}`}>
            {value}
          </dd>
          <dd className="text-xs text-slate-500">{help}</dd>
        </div>
      ))}
    </dl>
  );
}

function Overview({ result }: { result: SessionResult }) {
  const t = useT();
  const { language } = useLanguage();
  const s = result.summary;
  return (
    <div className="space-y-5">
      <section className="card animate-fade-up flex flex-wrap items-center gap-6 p-5" data-testid="match-reveal">
        <div className="relative">
          <Ring done={s.resolved} total={s.incoming_rows} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tabular-nums">
              {s.resolved}/{s.incoming_rows}
            </span>
            <span className="text-xs text-slate-500">{t.matching.resolvedShort}</span>
          </div>
        </div>
        <div className="min-w-[16rem] flex-1">
          <h3 className="text-lg font-bold">{t.matching.revealTitle((s.status_counts.auto ?? 0) + (s.status_counts.auto_newest ?? 0), s.incoming_rows)}</h3>
          <p className="text-sm text-slate-600">{t.matching.revealText}</p>
          <div className="mt-4">
            <Kpis result={result} />
          </div>
        </div>
      </section>
      {result.warnings.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <h3 className="font-medium">{t.matching.warnings}</h3>
          <ul className="list-disc pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{noteText(t, w)}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="card p-5">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Icon name="list" className="h-5 w-5 text-slate-500" />
          {t.matching.log}
        </h3>
        {result.log.length === 0 ? (
          <p className="text-sm text-slate-500">{t.matching.logEmpty}</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm" data-testid="decision-log">
              <thead className="bg-slate-50 text-left">
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
          </div>
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

/** Always-visible footer: progress, and what to do next. */
function NextStepBar({ result, onResolve, onExport }: { result: SessionResult; onResolve: () => void; onExport: () => void }) {
  const t = useT();
  const s = result.summary;
  const share = s.incoming_rows ? (100 * s.resolved) / s.incoming_rows : 100;
  return (
    <div className="sticky bottom-0 z-30 -mx-6 mt-6 border-t border-slate-200 bg-white/95 px-6 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4">
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm font-medium" data-testid="next-step-status">
            {s.unresolved > 0 ? t.matching.barTodo(s.resolved, s.incoming_rows, s.unresolved) : t.matching.barDone(s.incoming_rows)}
          </p>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${s.unresolved ? "bg-indigo-600" : "bg-emerald-500"}`}
              style={{ width: `${share}%` }}
            />
          </div>
        </div>
        {s.unresolved > 0 && (
          <button type="button" className="btn-secondary" onClick={onResolve}>
            <Icon name="flag" className="h-4 w-4" />
            {t.matching.resolveNext}
          </button>
        )}
        <button type="button" className="btn-success btn-lg" onClick={onExport} disabled={s.unresolved > 0}>
          {t.matching.toExport}
          <Icon name="arrow" />
        </button>
      </div>
    </div>
  );
}

export function MatchingStep({ sessionId, result, tab, setTab, active, onExport }: Props) {
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
  const left = result.summary.unresolved;
  const tabs: [MatchingTab, string][] = [
    ["overview", t.matching.tabs.overview],
    ["resolve", `${t.matching.tabs.resolve} (${left})`],
    ["all", t.matching.tabs.all],
  ];
  const resolve = () => {
    setCurrent(null);
    setTab("resolve");
  };
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-sm font-semibold text-indigo-700">{t.matching.eyebrow}</p>
        <h2 className="text-2xl font-bold tracking-tight">{t.matching.title}</h2>
      </header>
      {left > 0 ? (
        <Guide
          title={t.matching.todoTitle(left)}
          action={
            tab !== "resolve" && (
              <button type="button" className="btn-primary btn-lg" onClick={resolve}>
                {t.matching.todoAction}
                <Icon name="arrow" />
              </button>
            )
          }
        >
          {tab === "resolve" ? t.matching.todoTextResolve : t.matching.todoText}
        </Guide>
      ) : (
        <Guide
          tone="done"
          title={t.matching.doneTitle}
          action={
            <button type="button" className="btn-success btn-lg" onClick={onExport}>
              {t.matching.toExport}
              <Icon name="arrow" />
            </button>
          }
        >
          {t.matching.doneText}
        </Guide>
      )}
      <div role="tablist" aria-label={t.matching.tabsLabel} className="inline-flex gap-1 rounded-xl bg-slate-200/70 p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === id ? "bg-white text-indigo-800 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <Overview result={result} />}
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
          <div className="card p-4">
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
          </div>
        )}
      </div>
      <NextStepBar result={result} onResolve={resolve} onExport={onExport} />
    </div>
  );
}
