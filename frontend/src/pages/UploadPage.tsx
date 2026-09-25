import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, type SessionCreated, type UploadInput } from "../api/client";
import { DropZone } from "../components/DropZone";
import { t } from "../i18n/en";

type Props = { onUploaded: (created: SessionCreated) => void; onViewResults: () => void };

function ErrorPanel({ error }: { error: ApiError }) {
  const missing = error.details.filter((d) => Array.isArray(d.missing_columns));
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-semibold">{t.upload.errorTitle}</p>
      <p className="mt-1">{error.message}</p>
      {missing.length > 0 && (
        <ul className="mt-2 list-disc pl-5">
          {missing.map((d) => (
            <li key={String(d.source)}>
              {t.upload.missingColumns(
                t.upload.sourceLabel[d.source as "physical" | "sap"] ?? String(d.source),
                (d.missing_columns as string[]).join(", "),
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UploadPage({ onUploaded, onViewResults }: Props) {
  const [mode, setMode] = useState<"one" | "two">("one");
  const [workbook, setWorkbook] = useState<File | null>(null);
  const [physical, setPhysical] = useState<File | null>(null);
  const [sap, setSap] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: (input: UploadInput) => api.createSession(input),
    onSuccess: onUploaded,
  });

  const ready = mode === "one" ? workbook !== null : physical !== null && sap !== null;
  const submit = () => {
    if (mode === "one" && workbook) upload.mutate({ workbook });
    else if (mode === "two" && physical && sap) upload.mutate({ physical, sap });
  };
  const created = upload.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{t.upload.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{t.upload.intro}</p>
      </div>
      <fieldset className="flex gap-4">
        <legend className="sr-only">{t.upload.modeLabel}</legend>
        {(["one", "two"] as const).map((m) => (
          <label key={m} className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
            {m === "one" ? t.upload.modeOne : t.upload.modeTwo}
          </label>
        ))}
      </fieldset>
      {mode === "one" ? (
        <DropZone label={t.upload.workbook} file={workbook} onFile={setWorkbook} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <DropZone label={t.upload.physical} file={physical} onFile={setPhysical} />
          <DropZone label={t.upload.sap} file={sap} onFile={setSap} />
        </div>
      )}
      <button type="button" className="btn-primary" disabled={!ready || upload.isPending} onClick={submit}>
        {upload.isPending ? t.upload.submitting : t.upload.submit}
      </button>

      {upload.error && (
        <ErrorPanel
          error={
            upload.error instanceof ApiError
              ? upload.error
              : new ApiError(0, "unknown", String(upload.error))
          }
        />
      )}
      {created && (
        <section aria-labelledby="detected-title" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          <h3 id="detected-title" className="font-semibold">{t.upload.detectedTitle}</h3>
          <ul className="mt-2 space-y-1">
            {created.detected.map((d) => (
              <li key={d.source}>
                <strong>{t.upload.sourceLabel[d.source]}</strong>: {d.file_name} › {d.sheet_name} (
                {t.upload.detectedBy[d.detected_by]}), {t.upload.rows(d.row_count)}
                {d.missing_optional_columns.length > 0 && (
                  <span className="block text-slate-600">
                    {t.upload.missingOptional(d.missing_optional_columns.join(", "))}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {created.warnings.length > 0 && (
            <div className="mt-2">
              <p className="font-medium">{t.upload.warnings}</p>
              <ul className="list-disc pl-5">{created.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <button type="button" className="btn-primary mt-3" onClick={onViewResults}>
            {t.upload.viewResults}
          </button>
        </section>
      )}
    </div>
  );
}
