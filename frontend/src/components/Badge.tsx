import type { RowStatus } from "../api/client";
import { useT } from "../i18n";

const STATUS_CLASSES: Record<RowStatus, string> = {
  auto: "bg-green-100 text-green-800 ring-green-600/20",
  auto_newest: "bg-emerald-50 text-emerald-800 ring-emerald-600/30",
  location_mismatch: "bg-amber-100 text-amber-900 ring-amber-600/30",
  manual: "bg-blue-100 text-blue-800 ring-blue-600/20",
  no_match: "bg-slate-100 text-slate-700 ring-slate-500/20",
  no_candidate: "bg-red-100 text-red-800 ring-red-600/20",
  duplicate: "bg-orange-100 text-orange-900 ring-orange-600/30",
};

export const BADGE =
  "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset";

export function StatusBadge({ status }: { status: RowStatus }) {
  const t = useT();
  return <span className={`${BADGE} ${STATUS_CLASSES[status]}`}>{t.status[status] ?? status}</span>;
}

export function Tag({
  tone,
  children,
}: {
  tone: "info" | "warn" | "danger" | "muted" | "success";
  children: string;
}) {
  const tones = {
    success: "bg-emerald-50 text-emerald-800 ring-emerald-600/30",
    info: "bg-blue-50 text-blue-800 ring-blue-600/20",
    warn: "bg-amber-50 text-amber-900 ring-amber-600/30",
    danger: "bg-red-50 text-red-800 ring-red-600/20",
    muted: "bg-slate-50 text-slate-700 ring-slate-500/20",
  };
  return <span className={`${BADGE} ${tones[tone]}`}>{children}</span>;
}
