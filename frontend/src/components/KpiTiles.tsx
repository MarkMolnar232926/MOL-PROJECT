import type { Summary } from "../api/client";
import { t } from "../i18n/en";

export function KpiTiles({ summary }: { summary: Summary }) {
  const sap = summary.sap_status_counts;
  const phys = summary.physical_status_counts;
  const n = (counts: Record<string, number>, key: string) => counts[key] ?? 0;
  const tiles: [string, number, string][] = [
    [t.results.kpi.matched, n(sap, "Matched") + n(sap, "Matched – location mismatch") + n(sap, "Manually resolved"), "text-green-700"],
    [t.results.kpi.locationMismatch, summary.location_mismatches, "text-amber-700"],
    [t.results.kpi.needsDecision, summary.tie_slots_pending, "text-orange-700"],
    [t.results.kpi.sapOnly, n(sap, "SAP only"), "text-red-700"],
    [t.results.kpi.physicalOnly, n(phys, "Physical only") + n(phys, "Unclassified"), "text-red-700"],
    [t.results.kpi.defective, n(phys, "Defective – excluded"), "text-slate-700"],
    [t.results.kpi.duplicates, n(phys, "Duplicate entry") + n(sap, "Duplicate entry"), "text-slate-700"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {tiles.map(([label, value, color]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
          <dt className="text-xs text-slate-600">{label}</dt>
          <dd className={`text-2xl font-semibold ${color}`} data-testid={`kpi-${label}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
