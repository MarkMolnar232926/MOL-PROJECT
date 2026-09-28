import { useState } from "react";
import { api, type SessionResult } from "../api/client";
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

type Props = { sessionId: string; result: SessionResult; onQueue: () => void };

/** The only download: the incoming file with its Asset IDs, once every item is resolved. */
export function ExportStep({ sessionId, result, onQueue }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = result.summary.unresolved;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await api.exportWorkbook(sessionId);
      download(blob, filename);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-2xl space-y-3">
      <h2 className="text-xl font-semibold">{t.exportStep.title}</h2>
      <p className="text-sm text-slate-600">{t.exportStep.intro}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={left > 0 || busy} onClick={run}>
          {busy ? t.exportStep.busy : t.exportStep.button}
        </button>
        {left > 0 ? (
          <span className="text-sm" data-testid="export-remaining">
            {t.exportStep.remaining(left)}{" "}
            <button type="button" className="link" onClick={onQueue}>
              {t.exportStep.toQueue}
            </button>
          </span>
        ) : (
          <span className="text-sm text-green-800">{t.exportStep.ready}</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
