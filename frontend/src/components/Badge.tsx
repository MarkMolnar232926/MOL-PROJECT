import type { Confidence, MatchStatus } from "../api/client";

const STATUS_CLASSES: Record<MatchStatus, string> = {
  Matched: "bg-green-100 text-green-800 ring-green-600/20",
  "Matched – location mismatch": "bg-amber-100 text-amber-900 ring-amber-600/30",
  "Needs decision": "bg-orange-100 text-orange-900 ring-orange-600/30",
  "Manually resolved": "bg-blue-100 text-blue-800 ring-blue-600/20",
  "Physical only": "bg-red-100 text-red-800 ring-red-600/20",
  "SAP only": "bg-red-100 text-red-800 ring-red-600/20",
  "Defective – excluded": "bg-slate-100 text-slate-700 ring-slate-500/20",
  "Duplicate entry": "bg-slate-100 text-slate-700 ring-slate-500/20",
  Unclassified: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-600/20",
};

const CONFIDENCE_CLASSES: Record<Confidence, string> = {
  High: "bg-green-50 text-green-700 ring-green-600/20",
  "High (QR)": "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  Medium: "bg-yellow-50 text-yellow-800 ring-yellow-600/20",
  Manual: "bg-blue-50 text-blue-700 ring-blue-600/20",
  "Needs decision": "bg-orange-50 text-orange-800 ring-orange-600/20",
};

const BASE = "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset";

export function StatusBadge({ status }: { status: MatchStatus }) {
  return <span className={`${BASE} ${STATUS_CLASSES[status]}`}>{status}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence | null | undefined }) {
  if (!confidence) return null;
  return <span className={`${BASE} ${CONFIDENCE_CLASSES[confidence]}`}>{confidence}</span>;
}
