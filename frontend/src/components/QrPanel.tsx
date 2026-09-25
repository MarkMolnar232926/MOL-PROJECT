import type { QrAssessment } from "../api/client";
import { t } from "../i18n/en";

type Props = {
  qr: QrAssessment;
  useQr: boolean;
  busy: boolean;
  onToggle: (useQr: boolean) => void;
};

const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${v.toFixed(1)} %`);

export function QrPanel({ qr, useQr, busy, onToggle }: Props) {
  return (
    <section aria-labelledby="qr-title" className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="qr-title" className="font-semibold">
          {t.qr.title}
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useQr}
            disabled={busy || !qr.column_present}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4"
          />
          {t.qr.toggle}
          {busy && (
            <span role="status" className="inline-flex items-center gap-1 text-slate-600">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
              {t.qr.rematching}
            </span>
          )}
        </label>
      </div>
      {qr.column_present ? (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-600">{t.qr.parseable}</dt>
            <dd>{qr.parseable}/{qr.total_rows} ({pct(qr.parseable_pct)})</dd>
          </div>
          <div>
            <dt className="text-slate-600">{t.qr.present}</dt>
            <dd>{qr.present_in_physical}/{qr.total_rows} ({pct(qr.present_pct)})</dd>
          </div>
          <div>
            <dt className="text-slate-600">{t.qr.agreement}</dt>
            <dd>
              {qr.agreeing_outside_ties}/{qr.compared_outside_ties} ({pct(qr.agreement_outside_ties_pct)})
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-slate-600">{t.qr.noColumn}</p>
      )}
      {qr.looks_reliable && !useQr && (
        <p className="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{t.qr.reliable}</p>
      )}
    </section>
  );
}
