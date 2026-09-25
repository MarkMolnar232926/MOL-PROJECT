import { useState } from "react";
import { api } from "../api/client";
import { errorText, useT } from "../i18n";
import { ConfirmDialog } from "./Dialog";

type Props = { sessionId: string | null; pendingSlots: number };

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

export function ExportButton({ sessionId, pendingSlots }: Props) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!sessionId) return;
    setConfirming(false);
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
    <>
      <button
        type="button"
        className="btn-primary"
        disabled={!sessionId || busy}
        onClick={() => (pendingSlots > 0 ? setConfirming(true) : run())}
      >
        {busy ? t.exporting : t.exportButton}
      </button>
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
      {confirming && (
        <ConfirmDialog
          title={t.exportConfirmTitle}
          message={t.exportConfirm(pendingSlots)}
          confirmLabel={t.exportAnyway}
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
