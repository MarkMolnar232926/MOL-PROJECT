import { useState } from "react";
import { api, type SessionResult } from "../api/client";
import { Guide } from "../components/Guide";
import { Icon } from "../components/Icon";
import { errorText, useT } from "../i18n";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The name the server gives the export (see backend recon/writeback.py). */
export function exportName(uploaded: string | undefined) {
  const name = uploaded || "incoming.xlsx";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = name.toLowerCase().endsWith(".xlsm") ? ".xlsm" : ".xlsx";
  return `${stem}_asset_id${ext}`;
}

type Props = {
  sessionId: string;
  result: SessionResult;
  incomingName: string | undefined;
  onQueue: () => void;
  onStartOver: () => void;
};

/** The only download: the incoming file with its Asset IDs, once every item is resolved. */
export function ExportStep({ sessionId, result, incomingName, onQueue, onStartOver }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = result.summary.unresolved;
  const filled = result.rows.filter((r) => r.asset_id).length;
  const empty = result.rows.length - filled;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.exportWorkbook(sessionId);
      download(blob, filename);
      setDone(filename);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-sm font-semibold text-indigo-700">{t.exportStep.eyebrow}</p>
        <h2 className="text-2xl font-bold tracking-tight">{t.exportStep.title}</h2>
        <p className="mt-1 text-slate-600">{t.exportStep.intro}</p>
      </header>

      {left > 0 ? (
        <Guide
          tone="warn"
          title={t.exportStep.notReadyTitle(left)}
          action={
            <button type="button" className="btn-primary btn-lg" onClick={onQueue}>
              {t.exportStep.toQueue}
              <Icon name="arrow" />
            </button>
          }
        >
          <span data-testid="export-remaining">{t.exportStep.remaining(left)}</span>
        </Guide>
      ) : done ? (
        <Guide
          tone="done"
          title={t.exportStep.doneTitle}
          action={
            <button type="button" className="btn-secondary" onClick={onStartOver}>
              <Icon name="refresh" className="h-4 w-4" />
              {t.exportStep.startOver}
            </button>
          }
        >
          <span data-testid="export-done">{t.exportStep.doneText(done)}</span>
        </Guide>
      ) : (
        <Guide title={t.exportStep.readyTitle}>{t.exportStep.ready}</Guide>
      )}

      <div className={`card p-6 ${left > 0 ? "opacity-60" : "animate-fade-up"}`}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Icon name="file" className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">{t.exportStep.fileLabel}</p>
            <p className="truncate font-mono font-semibold">{exportName(incomingName)}</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-emerald-50 p-3">
            <dt className="text-xs text-emerald-800">{t.exportStep.filled}</dt>
            <dd className="text-2xl font-bold tabular-nums text-emerald-700" data-testid="export-filled">
              {filled}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-600">{t.exportStep.empty}</dt>
            <dd className="text-2xl font-bold tabular-nums">{empty}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">{t.exportStep.untouched}</p>
        <button type="button" className="btn-success btn-lg mt-5 w-full" disabled={left > 0 || busy} onClick={run}>
          <Icon name="download" />
          {busy ? t.exportStep.busy : done ? t.exportStep.again : t.exportStep.button}
        </button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
