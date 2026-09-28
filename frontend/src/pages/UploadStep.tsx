import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  type IncomingSummary,
  type OriginalSummary,
  type SessionState,
  type SheetInfo,
} from "../api/client";
import { ConfirmDialog } from "../components/Dialog";
import { DropZone } from "../components/DropZone";
import { Guide } from "../components/Guide";
import { Icon, type IconName } from "../components/Icon";
import { errorText, noteText, useT, type Messages } from "../i18n";

export type UploadKind = "original" | "incoming";

type Props = {
  kind: UploadKind;
  state: SessionState | undefined;
  ensureSession: () => Promise<string>;
  onUploaded: () => void;
  onContinue: () => void;
};

function Stat({ label, value, tone = "slate" }: { label: string; value: ReactNode; tone?: "slate" | "amber" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function SheetLine({ sheet }: { sheet: SheetInfo }) {
  const t = useT();
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <Icon name="file" className="h-4 w-4 text-slate-500" />
      <strong>{t.upload.sheetLine(sheet.file_name, sheet.sheet_name, t.upload.detectedBy[sheet.detected_by] ?? sheet.detected_by)}</strong>
      {" – "}
      {t.upload.rows(sheet.row_count)}
      {sheet.missing_optional_columns.length > 0 && (
        <span className="block w-full text-slate-600">
          {t.upload.missingOptional(sheet.missing_optional_columns.join(", "))}
        </span>
      )}
    </p>
  );
}

function Issues({ t, issues }: { t: Messages; issues: OriginalSummary["issues"] }) {
  if (issues.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
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
    <div className="space-y-3" data-testid="original-summary">
      <SheetLine sheet={sheet} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t.upload.statRows} value={summary.rows} />
        <Stat label={t.upload.locations} value={summary.locations.length} />
        <Stat label={t.upload.statDuplicateIds} value={summary.duplicate_asset_ids.length} tone={summary.duplicate_asset_ids.length ? "amber" : "slate"} />
        <Stat label={t.upload.statDefective} value={summary.defective_rows.length} tone={summary.defective_rows.length ? "amber" : "slate"} />
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
        <li>
          {t.upload.locations}:{" "}
          {summary.locations.map((l) => `${l.location} (${l.building ?? "?"}): ${l.rows}`).join(", ")}
        </li>
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
    <div className="space-y-3" data-testid="incoming-summary">
      <SheetLine sheet={sheet} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t.upload.statRows} value={summary.rows} />
        <Stat label={t.upload.statItemTypes} value={summary.item_types} />
        <Stat label={t.upload.statDuplicateRows} value={summary.duplicate_rows.length} tone={summary.duplicate_rows.length ? "amber" : "slate"} />
        <Stat label={t.upload.statPrefilled} value={summary.prefilled_asset_ids.length} tone={summary.prefilled_asset_ids.length ? "amber" : "slate"} />
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
        <li>
          {t.upload.locations}: {summary.locations.map((l) => `${l.location}: ${l.rows}`).join(", ")}
        </li>
        <li>
          {t.upload.duplicateRows(summary.duplicate_rows.length)}
          {summary.duplicate_rows.length > 0 &&
            ` (${t.upload.rowsList(summary.duplicate_rows.map((d) => d.row).join(", "))})`}
        </li>
        {summary.prefilled_asset_ids.length > 0 && <li>{t.upload.prefilled(summary.prefilled_asset_ids.length)}</li>}
      </ul>
      <Issues t={t} issues={summary.issues} />
    </div>
  );
}

function ErrorPanel({ error }: { error: unknown }) {
  const t = useT();
  const details = error instanceof ApiError ? error.details : [];
  const missing = details.filter((d) => Array.isArray(d.missing_columns) && d.missing_columns.length);
  const hints = details
    .map((d) => (typeof d.looks_like === "string" ? t.upload.looksLike[d.looks_like] : null))
    .filter(Boolean);
  return (
    <section role="alert" className="animate-fade-up flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <Icon name="alert" className="h-6 w-6 shrink-0 text-red-600" />
      <div>
        <h3 className="font-semibold">{t.upload.errorTitle}</h3>
        <p className="mt-1">{errorText(t, error)}</p>
        {hints.map((hint, i) => (
          <p key={i} className="mt-1 font-medium">
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
        <p className="mt-2 text-red-800">{t.upload.errorFix}</p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const t = useT();
  const steps: [IconName, string, string][] = [
    ["file", t.how.original, t.how.originalText],
    ["upload", t.how.incoming, t.how.incomingText],
    ["link", t.how.matching, t.how.matchingText],
    ["download", t.how.export, t.how.exportText],
  ];
  return (
    <section className="card animate-fade-up p-5" aria-labelledby="how-title">
      <h3 id="how-title" className="flex items-center gap-2 font-semibold">
        <Icon name="sparkles" className="h-5 w-5 text-indigo-600" />
        {t.how.title}
      </h3>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([icon, title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Icon name={icon} />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {i + 1}. {title}
              </p>
              <p className="text-sm text-slate-600">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function UploadStep({ kind, state, ensureSession, onUploaded, onContinue }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const sheetId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [sheetChoice, setSheetChoice] = useState<{ sheets: string[]; value: string } | null>(null);

  const existing = kind === "original" ? state?.original : state?.incoming;
  // Replacing discards later steps: the original drops the incoming list, the list drops the matching.
  const needsConfirm = kind === "original" ? Boolean(state?.incoming) : Boolean(state?.matched);
  const texts = kind === "original" ? t.upload.original : t.upload.incoming;

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

  return (
    <section className="mx-auto max-w-4xl space-y-5" aria-labelledby={`${sheetId}-title`}>
      <header>
        <p className="text-sm font-semibold text-indigo-700">{texts.eyebrow}</p>
        <h2 id={`${sheetId}-title`} className="text-2xl font-bold tracking-tight">
          {texts.title}
        </h2>
        <p className="mt-1 max-w-3xl text-slate-600">{texts.intro}</p>
      </header>

      {existing && !replacing ? (
        <Guide
          tone="done"
          title={texts.doneTitle}
          action={
            <button type="button" className="btn-primary btn-lg" onClick={onContinue}>
              {texts.next}
              <Icon name="arrow" />
            </button>
          }
        >
          {texts.doneText}
        </Guide>
      ) : (
        <Guide title={texts.todoTitle}>{texts.todoText}</Guide>
      )}

      {kind === "original" && !existing && <HowItWorks />}

      {existing && (
        <div className="card animate-fade-up space-y-4 p-5">
          <p className="flex items-center gap-2 font-semibold text-emerald-800">
            <span className="animate-pop flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Icon name="check" className="h-4 w-4" />
            </span>
            {t.upload.uploaded}
          </p>
          {kind === "original" && state?.original ? (
            <OriginalSummaryView sheet={state.original.sheet} summary={state.original.summary} />
          ) : state?.incoming ? (
            <IncomingSummaryView sheet={state.incoming.sheet} summary={state.incoming.summary} />
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {!replacing && (
              <button type="button" className="btn-secondary" onClick={() => setReplacing(true)}>
                <Icon name="refresh" className="h-4 w-4" />
                {t.upload.replace}
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form
          className="card space-y-4 p-5"
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
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary btn-lg" disabled={!file || mutation.isPending}>
              <Icon name="upload" />
              {mutation.isPending ? t.upload.submitting : t.upload.submit}
            </button>
            {!file && <span className="text-sm text-slate-500">{t.upload.pickFirst}</span>}
            {replacing && (
              <button type="button" className="btn-secondary" onClick={() => setReplacing(false)}>
                {t.cancel}
              </button>
            )}
          </div>
        </form>
      )}

      {sheetChoice && (
        <div className="animate-fade-up rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium">{t.upload.sheetChoice}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
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
