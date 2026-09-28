import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  api,
  ApiError,
  type IncomingSummary,
  type MatchSummary,
  type OriginalSummary,
  type SessionState,
  type SheetInfo,
} from "../api/client";
import { ConfirmDialog } from "../components/Dialog";
import { DropZone } from "../components/DropZone";
import { errorText, noteText, useT, type Messages } from "../i18n";

export type UploadKind = "original" | "incoming";

type Props = {
  kind: UploadKind;
  state: SessionState | undefined;
  match: MatchSummary | undefined;
  ensureSession: () => Promise<string>;
  onUploaded: () => void;
  onContinue: () => void;
};

function SheetLine({ sheet }: { sheet: SheetInfo }) {
  const t = useT();
  return (
    <p>
      <strong>{t.upload.sheetLine(sheet.file_name, sheet.sheet_name, t.upload.detectedBy[sheet.detected_by] ?? sheet.detected_by)}</strong>
      {" – "}
      {t.upload.rows(sheet.row_count)}
      {sheet.missing_optional_columns.length > 0 && (
        <span className="block text-slate-600">
          {t.upload.missingOptional(sheet.missing_optional_columns.join(", "))}
        </span>
      )}
    </p>
  );
}

function Issues({ t, issues }: { t: Messages; issues: OriginalSummary["issues"] }) {
  if (issues.length === 0) return null;
  return (
    <div>
      <p className="font-medium">{t.upload.issues}</p>
      <ul className="list-disc pl-5">
        {issues.map((i, n) => (
          <li key={n}>
            {i.row != null && `${t.cols.row} ${i.row}: `}
            {noteText(t, { code: i.code, params: i.params, text: i.message })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OriginalSummaryView({ sheet, summary }: { sheet: SheetInfo; summary: OriginalSummary }) {
  const t = useT();
  return (
    <div className="space-y-2" data-testid="original-summary">
      <SheetLine sheet={sheet} />
      <p>
        {t.upload.locations}:{" "}
        {summary.locations.map((l) => `${l.location} (${l.building ?? "?"}): ${l.rows}`).join(", ")}
      </p>
      <ul className="list-disc pl-5">
        <li>
          {t.upload.duplicateIds(summary.duplicate_asset_ids.length)}
          {summary.duplicate_asset_ids.length > 0 &&
            `: ${summary.duplicate_asset_ids.map((d) => `${d.value} (${t.upload.rowsList(d.rows.join(", "))})`).join("; ")}`}
        </li>
        <li>{t.upload.duplicateRows(summary.duplicate_rows.length)}</li>
        <li>
          {t.upload.defective(summary.defective_rows.length)}
          {summary.defective_rows.length > 0 && ` (${t.upload.rowsList(summary.defective_rows.join(", "))})`}
        </li>
      </ul>
      <Issues t={t} issues={summary.issues} />
    </div>
  );
}

function IncomingSummaryView({ sheet, summary }: { sheet: SheetInfo; summary: IncomingSummary }) {
  const t = useT();
  return (
    <div className="space-y-2" data-testid="incoming-summary">
      <SheetLine sheet={sheet} />
      <p>
        {t.upload.itemTypes(summary.item_types)} · {t.upload.locations}:{" "}
        {summary.locations.map((l) => `${l.location}: ${l.rows}`).join(", ")}
      </p>
      <ul className="list-disc pl-5">
        <li>
          {t.upload.duplicateRows(summary.duplicate_rows.length)}
          {summary.duplicate_rows.length > 0 &&
            ` (${t.upload.rowsList(summary.duplicate_rows.map((d) => d.row).join(", "))})`}
        </li>
        {summary.prefilled_asset_ids.length > 0 && (
          <li>{t.upload.prefilled(summary.prefilled_asset_ids.length)}</li>
        )}
      </ul>
      <Issues t={t} issues={summary.issues} />
    </div>
  );
}

function ErrorPanel({ error }: { error: unknown }) {
  const t = useT();
  const details = error instanceof ApiError ? error.details : [];
  const missing = details.filter((d) => Array.isArray(d.missing_columns) && d.missing_columns.length);
  return (
    <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <h3 className="font-semibold">{t.upload.errorTitle}</h3>
      <p className="mt-1">{errorText(t, error)}</p>
      {details.map((d) => (typeof d.looks_like === "string" ? t.upload.looksLike[d.looks_like] : null))
        .filter(Boolean)
        .map((hint, i) => (
          <p key={i} className="mt-1">
            {hint}
          </p>
        ))}
      {missing.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {missing.map((d, i) => (
            <li key={i}>
              {t.upload.missingColumns(String(d.sheet ?? d.source), (d.missing_columns as string[]).join(", "))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function UploadStep({ kind, state, match, ensureSession, onUploaded, onContinue }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const sheetId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [sheetChoice, setSheetChoice] = useState<{ sheets: string[]; value: string } | null>(null);

  const existing = kind === "original" ? state?.original : state?.incoming;
  // Replacing discards later steps: the original drops the incoming list, the list drops decisions.
  const needsConfirm = kind === "original" ? Boolean(state?.incoming) : Boolean(state?.matched);

  const mutation = useMutation({
    mutationFn: async ({ f, sheet }: { f: File; sheet?: string }) => {
      const sid = await ensureSession();
      return kind === "original" ? api.uploadOriginal(sid, f, sheet) : api.uploadIncoming(sid, f, sheet);
    },
    onSuccess: async (res) => {
      setFile(null);
      setReplacing(false);
      setSheetChoice(null);
      qc.removeQueries({ queryKey: ["result", res.session_id] });
      qc.removeQueries({ queryKey: ["candidates", res.session_id] });
      await qc.invalidateQueries({ queryKey: ["state", res.session_id] });
      onUploaded();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "sheet_choice_required") {
        const sheets = (e.details[0]?.matching_sheets as string[] | undefined) ?? [];
        setSheetChoice({ sheets, value: sheets[0] ?? "" });
      } else {
        setSheetChoice(null);
      }
    },
  });

  const submit = (sheet?: string) => file && mutation.mutate({ f: file, sheet });
  const showForm = !existing || replacing;
  const title = kind === "original" ? t.upload.originalTitle : t.upload.incomingTitle;
  const intro = kind === "original" ? t.upload.originalIntro : t.upload.incomingIntro;

  return (
    <section className="max-w-3xl space-y-4" aria-labelledby={`${sheetId}-title`}>
      <div>
        <h2 id={`${sheetId}-title`} className="text-xl font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{intro}</p>
      </div>

      {existing && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          {kind === "original" && state?.original ? (
            <OriginalSummaryView sheet={state.original.sheet} summary={state.original.summary} />
          ) : state?.incoming ? (
            <IncomingSummaryView sheet={state.incoming.sheet} summary={state.incoming.summary} />
          ) : null}
          {kind === "incoming" && match && (
            <p className="mt-2 font-medium" data-testid="matched-summary">
              {t.upload.matched(match.resolved, match.incoming_rows)}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={onContinue}>
              {kind === "original" ? t.upload.toIncoming : t.upload.toMatching}
            </button>
            {!replacing && (
              <button type="button" className="btn-secondary" onClick={() => setReplacing(true)}>
                {t.upload.replace}
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (needsConfirm) setConfirming(true);
            else submit();
          }}
        >
          <DropZone
            label={t.upload.fileLabel[kind]}
            file={file}
            onFile={(f) => {
              setFile(f);
              setSheetChoice(null);
              mutation.reset();
            }}
          />
          <button type="submit" className="btn-primary" disabled={!file || mutation.isPending}>
            {mutation.isPending ? t.upload.submitting : t.upload.submit}
          </button>
        </form>
      )}

      {sheetChoice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p>{t.upload.sheetChoice}</p>
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor={sheetId}>{t.upload.sheetLabel}</label>
            <select
              id={sheetId}
              className="input"
              value={sheetChoice.value}
              onChange={(e) => setSheetChoice({ ...sheetChoice, value: e.target.value })}
            >
              {sheetChoice.sheets.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button type="button" className="btn-primary" onClick={() => submit(sheetChoice.value)}>
              {t.upload.useSheet}
            </button>
          </div>
        </div>
      )}

      {mutation.isError && !sheetChoice && <ErrorPanel error={mutation.error} />}

      {confirming && (
        <ConfirmDialog
          title={kind === "original" ? t.upload.replaceOriginalTitle : t.upload.replaceIncomingTitle}
          message={kind === "original" ? t.upload.replaceOriginal : t.upload.replaceIncoming}
          confirmLabel={t.upload.replaceConfirm}
          onConfirm={() => {
            setConfirming(false);
            submit();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
