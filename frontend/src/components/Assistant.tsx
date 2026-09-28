import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type AssignmentResponse,
  type Candidate,
  type CandidateFilters,
  type ExistingItem,
  type IncomingResult,
  type NoMatchReason,
  type SessionResult,
} from "../api/client";
import { errorText, noteText, useT } from "../i18n";
import { StatusBadge, Tag } from "./Badge";
import { ConfirmDialog, Modal } from "./Dialog";

const REASONS: NoMatchReason[] = ["missing_asset", "new_asset", "duplicate_entry", "other"];

type Props = {
  sessionId: string;
  result: SessionResult;
  queue: number[];
  setQueue: (q: number[]) => void;
  current: number | null;
  setCurrent: (row: number | null) => void;
  active?: boolean;
};

/** The next unresolved row in the queue after ``from`` (wrapping), or null. */
export function nextUnresolved(queue: number[], rows: Map<number, IncomingResult>, from: number | null) {
  const start = from === null ? -1 : queue.indexOf(from);
  for (let i = 1; i <= queue.length; i++) {
    const row = queue[(start + i + queue.length) % queue.length];
    if (row !== from && rows.get(row) && !rows.get(row)!.resolved) return row;
  }
  return null;
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "file"]);

/** Keys typed into a text field (or a select) are not shortcuts; a focused checkbox is fine. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function size(item: IncomingResult["item"]) {
  const parts = [item.width_cm, item.height_cm, item.depth_cm].map((v) => (v == null ? "?" : v));
  return parts.join(" × ");
}

function ItemCard({ row }: { row: IncomingResult }) {
  const t = useT();
  const it = row.item;
  const fields: [string, string | number | null | undefined][] = [
    [t.cols.itemName, it.item_name],
    [t.cols.color, it.color],
    [t.cols.material, it.material],
    [t.cols.size, size(it)],
    [t.cols.serial, it.serial_no],
    [t.cols.building, it.city ? `${it.building} (${it.city})` : it.building],
    [t.cols.remarks, it.remarks],
    [t.cols.qr, it.qr_code],
  ];
  return (
    <section aria-label={t.assistant.item(it.excel_row)} className="rounded-lg border border-slate-200 bg-white p-4" data-testid="item-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{t.assistant.item(it.excel_row)}</h3>
        <StatusBadge status={row.status} />
      </div>
      {it.duplicate_of != null && (
        <p className="mt-1 text-sm text-orange-800">{t.assistant.duplicateOf(it.duplicate_of)}</p>
      )}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd>{value ?? "–"}</dd>
          </div>
        ))}
        <dt className="text-slate-500">{t.assistant.currentAssignment}</dt>
        <dd className="font-medium" data-testid="current-asset-id">
          {row.asset_id ?? t.assistant.none}
          {row.score != null && ` · ${row.score}%`}
        </dd>
        {row.reason && (
          <>
            <dt className="text-slate-500">{t.cols.reason}</dt>
            <dd>
              {t.reasons[row.reason]}
              {row.note && ` – ${row.note}`}
            </dd>
          </>
        )}
      </dl>
      {(row.notes ?? []).length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
          {(row.notes ?? []).map((n, i) => (
            <li key={i}>{noteText(t, n)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidateCard({
  c,
  selected,
  current,
  onSelect,
}: {
  c: Candidate;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const u = c.existing;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-testid="candidate"
        data-asset-id={u.asset_id}
        className={`w-full rounded-lg border p-3 text-left text-sm ${
          selected ? "border-blue-600 bg-blue-50 ring-2 ring-blue-600" : "border-slate-200 bg-white hover:bg-slate-50"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold tabular-nums">{c.score}%</span>
          <span className="font-mono font-medium">{u.asset_id}</span>
          {c.qr_match && <Tag tone="info">{t.assistant.qrMatch}</Tag>}
          {current && <Tag tone="info">{t.assistant.currentPair}</Tag>}
          {c.paired_row != null && !current && <Tag tone="warn">{t.assistant.pairedTo(c.paired_row)}</Tag>}
          {u.defective && <Tag tone="danger">{t.assistant.defective}</Tag>}
        </div>
        <ul className="mt-2 flex flex-wrap gap-1" aria-label={t.cols.score}>
          {c.checks.map((k) => {
            const cls = !k.evaluable
              ? "bg-slate-50 text-slate-500"
              : k.match
                ? "bg-green-50 text-green-800"
                : "bg-red-100 text-red-800 font-medium";
            const mark = !k.evaluable ? "–" : k.match ? "✓" : "✗";
            const detail = !k.evaluable
              ? t.assistant.notJudged
              : k.match
                ? (k.existing ?? "")
                : `${k.existing ?? "?"} ≠ ${k.incoming ?? "?"}`;
            return (
              <li key={k.criterion} className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>
                <span aria-hidden="true">{mark} </span>
                {t.criteria[k.criterion]}
                <span className="sr-only">{!k.evaluable ? "" : k.match ? " ✓" : " ✗"}</span>: {detail}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-slate-800">{u.description}</p>
        <p className="text-xs text-slate-600">
          {[u.city, u.activation_date, u.custodian, u.status].filter(Boolean).join(" · ")}
        </p>
      </button>
    </li>
  );
}

function NoPairDialog({
  row,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  row: number;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: NoMatchReason, note: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const noteId = useId();
  const [reason, setReason] = useState<NoMatchReason | null>(null);
  const [note, setNote] = useState("");
  const noteMissing = reason === "other" && !note.trim();
  return (
    <Modal
      title={t.assistant.noPairTitle}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!reason || noteMissing || busy}
            onClick={() => reason && onConfirm(reason, note)}
          >
            {t.assistant.confirmNoPair}
          </button>
        </>
      }
    >
      <p>{t.assistant.noPairIntro(row)}</p>
      <fieldset className="mt-3 space-y-1">
        <legend className="font-medium">{t.assistant.reasonLabel}</legend>
        {REASONS.map((r, i) => (
          <label key={r} className="flex items-center gap-2">
            <input
              type="radio"
              name="reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              data-autofocus={i === 0 ? true : undefined}
            />
            {t.reasons[r]}
          </label>
        ))}
      </fieldset>
      <label htmlFor={noteId} className="mt-3 block font-medium">
        {t.assistant.noteLabel}
      </label>
      <textarea
        id={noteId}
        className="input mt-1 w-full"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {noteMissing && <p className="text-xs text-red-700">{t.assistant.noteRequired}</p>}
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </Modal>
  );
}

function UnpairedPanel({ units }: { units: ExistingItem[] }) {
  const t = useT();
  const free = units.filter((u) => !u.defective);
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium">{t.assistant.unpaired(free.length)}</summary>
      <p className="mt-1 text-xs text-slate-600">{t.assistant.unpairedHint}</p>
      <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
        {free.map((u) => (
          <li key={u.asset_id} className="flex flex-wrap gap-x-2">
            <span className="font-mono">{u.asset_id}</span>
            <span>{u.sap_type ?? u.item_name}</span>
            <span className="text-slate-600">{u.description}</span>
            <span className="text-slate-500">
              {u.city} · {u.activation_date}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type Swap = { kind: "assign" | "reset"; row: number; assetId: string; holder: number };

export function Assistant({
  sessionId,
  result,
  queue,
  setQueue,
  current,
  setCurrent,
  active = true,
}: Props) {
  const t = useT();
  const qc = useQueryClient();
  const searchId = useId();
  const rows = useMemo(() => new Map(result.rows.map((r) => [r.item.excel_row, r])), [result]);
  const row = current != null ? rows.get(current) : undefined;
  const [filters, setFilters] = useState<CandidateFilters>({
    includePaired: false,
    includeOtherTypes: false,
    includeDefective: false,
    q: "",
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [swap, setSwap] = useState<Swap | null>(null);
  const [noPairOpen, setNoPairOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: ["candidates", sessionId, current, filters],
    queryFn: () => api.candidates(sessionId, current!, filters),
    enabled: current != null,
  });
  const list = useMemo(() => candidates.data ?? [], [candidates.data]);
  // Until the user picks one: the current pair if listed (so Enter never swaps by accident), else the best.
  const selectedIndex = Math.max(
    0,
    list.findIndex((c) => c.existing.asset_id === (selected ?? row?.asset_id)),
  );
  const chosen = list[selectedIndex];

  // Start on the first open item; follow a row opened from elsewhere.
  useEffect(() => {
    if (current == null) setCurrent(nextUnresolved(queue, rows, null));
  }, [current, queue, rows, setCurrent]);
  useEffect(() => {
    setSelected(null);
    setError(null);
  }, [current]);

  const resolvedInQueue = queue.filter((r) => rows.get(r)?.resolved).length;
  const inQueue = current != null && queue.includes(current);

  const goNext = () => setCurrent(nextUnresolved(queue, rows, current) ?? current);

  const applied = (res: AssignmentResponse) => {
    qc.setQueryData(["result", sessionId], res.result);
    void qc.invalidateQueries({ queryKey: ["candidates", sessionId] });
    setSwap(null);
    setNoPairOpen(false);
    setError(null);
    const updated = new Map(res.result.rows.map((r) => [r.item.excel_row, r]));
    const released = res.released_row;
    const q = released != null && !queue.includes(released) ? [...queue, released] : queue;
    if (q !== queue) setQueue(q);
    if (updated.get(res.row)?.resolved && q.includes(res.row)) {
      setCurrent(nextUnresolved(q, updated, res.row) ?? res.row);
    }
  };

  const onFail = (kind: Swap["kind"], row: number, assetId: string | null) => (e: unknown) => {
    if (e instanceof ApiError && e.code === "swap_required" && assetId) {
      setSwap({ kind, row, assetId, holder: Number(e.details[0]?.row) });
    } else {
      setError(errorText(t, e));
    }
  };

  const assign = useMutation({
    mutationFn: (v: { row: number; assetId: string; confirm?: boolean }) =>
      api.assign(sessionId, v.row, { asset_id: v.assetId, confirm_swap: v.confirm ?? false }),
    onSuccess: applied,
    onError: (e, v) => onFail("assign", v.row, v.assetId)(e),
  });
  const noPair = useMutation({
    mutationFn: (v: { row: number; reason: NoMatchReason; note: string }) =>
      api.assign(sessionId, v.row, {
        asset_id: null,
        reason: v.reason,
        note: v.note || null,
        confirm_swap: false,
      }),
    onSuccess: applied,
    onError: (e) => setError(errorText(t, e)),
  });
  const reset = useMutation({
    mutationFn: (v: { row: number; confirm?: boolean }) => api.reset(sessionId, v.row, v.confirm),
    onSuccess: applied,
    onError: (e, v) => onFail("reset", v.row, rows.get(v.row)?.auto_asset_id ?? null)(e),
  });
  const busy = assign.isPending || noPair.isPending || reset.isPending;

  const doAssign = () => {
    if (current != null && chosen && !busy) assign.mutate({ row: current, assetId: chosen.existing.asset_id });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || swap || noPairOpen || current == null || isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!list.length) return;
        e.preventDefault();
        const i = Math.min(list.length - 1, Math.max(0, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)));
        setSelected(list[i].existing.asset_id);
      } else if (e.key === "Enter") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return; // let the focused control act
        e.preventDefault();
        doAssign();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNoPairOpen(true);
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = (key: keyof Omit<CandidateFilters, "q">, label: string) => (
    <label className="flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={filters[key]}
        onChange={(e) => setFilters({ ...filters, [key]: e.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,22rem)_minmax(0,1fr)]">
        {/* queue */}
        <aside aria-label={t.assistant.queue} className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="font-semibold">{t.assistant.queue}</h3>
          <p className="text-sm text-slate-600" data-testid="queue-progress">
            {t.assistant.progress(resolvedInQueue, queue.length)}
          </p>
          <div className="mt-2 h-1.5 rounded bg-slate-100" aria-hidden="true">
            <div
              className="h-1.5 rounded bg-green-600"
              style={{ width: `${queue.length ? (100 * resolvedInQueue) / queue.length : 100}%` }}
            />
          </div>
          {queue.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{t.assistant.emptyQueue}</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {queue.map((r) => {
                const x = rows.get(r);
                if (!x) return null;
                return (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => setCurrent(r)}
                      aria-current={r === current ? "true" : undefined}
                      data-testid="queue-item"
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
                        r === current ? "bg-blue-100" : "hover:bg-slate-100"
                      }`}
                    >
                      <span aria-hidden="true" className={x.resolved ? "text-green-700" : "text-slate-400"}>
                        {x.resolved ? "✓" : "•"}
                      </span>
                      <span className="tabular-nums">{r}</span>
                      <span className="truncate">{x.item.item_name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* item */}
        <div className="space-y-3">
          {row ? (
            <>
              {!inQueue && <p className="text-sm text-blue-800">{t.assistant.overriding}</p>}
              <ItemCard row={row} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={doAssign} disabled={!chosen || busy}>
                  {t.assistant.assign}
                  {chosen && ` ${chosen.existing.asset_id}`}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setNoPairOpen(true)} disabled={busy}>
                  {t.assistant.noPair}
                </button>
                {inQueue && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const q = [...queue.filter((r) => r !== current), current!];
                      setQueue(q);
                      setCurrent(nextUnresolved(q, rows, current) ?? current);
                    }}
                  >
                    {t.assistant.later}
                  </button>
                )}
                <button type="button" className="btn-secondary" onClick={goNext}>
                  {t.assistant.next}
                </button>
                {(row.status === "manual" || row.status === "no_match" || (row.auto_asset_id && !row.asset_id)) && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => reset.mutate({ row: row.item.excel_row })}
                    disabled={busy}
                  >
                    {t.assistant.reset}
                  </button>
                )}
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              <p className="text-xs text-slate-500">{t.assistant.shortcuts}</p>
            </>
          ) : (
            <p className="text-sm text-slate-600">{queue.length ? t.assistant.pick : t.assistant.emptyQueue}</p>
          )}
        </div>

        {/* candidates */}
        {row && (
          <section aria-label={t.assistant.candidates} className="space-y-2">
            <h3 className="font-semibold">{t.assistant.candidates}</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {toggle("includePaired", t.assistant.showPaired)}
              {toggle("includeOtherTypes", t.assistant.showOtherTypes)}
              {toggle("includeDefective", t.assistant.showDefective)}
            </div>
            <label htmlFor={searchId} className="sr-only">
              {t.assistant.search}
            </label>
            <input
              id={searchId}
              type="search"
              className="input w-full"
              placeholder={t.assistant.search}
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
            {candidates.isPending ? (
              <p className="text-sm">{t.loading}</p>
            ) : candidates.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {errorText(t, candidates.error)}
              </p>
            ) : list.length === 0 ? (
              <p className="text-sm text-slate-500">{t.assistant.noCandidates}</p>
            ) : (
              <ul className="max-h-[65vh] space-y-2 overflow-auto pr-1">
                {list.map((c, i) => (
                  <CandidateCard
                    key={c.existing.asset_id}
                    c={c}
                    selected={i === selectedIndex}
                    current={c.existing.asset_id === row.asset_id}
                    onSelect={() => setSelected(c.existing.asset_id)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <UnpairedPanel units={result.unpaired_existing} />

      {swap && (
        <ConfirmDialog
          title={t.assistant.swapTitle}
          message={t.assistant.swap(swap.assetId, swap.holder)}
          confirmLabel={t.assistant.swapConfirm}
          onConfirm={() =>
            swap.kind === "assign"
              ? assign.mutate({ row: swap.row, assetId: swap.assetId, confirm: true })
              : reset.mutate({ row: swap.row, confirm: true })
          }
          onCancel={() => setSwap(null)}
        />
      )}
      {noPairOpen && current != null && (
        <NoPairDialog
          row={current}
          busy={noPair.isPending}
          error={error}
          onConfirm={(reason, note) => noPair.mutate({ row: current, reason, note })}
          onCancel={() => {
            setNoPairOpen(false);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
