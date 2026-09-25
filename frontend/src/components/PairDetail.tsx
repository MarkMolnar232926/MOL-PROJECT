import type { PhysicalRow, SapRow } from "../api/client";
import { noteText, useT } from "../i18n";
import { ConfidenceBadge, StatusBadge } from "./Badge";

type Props = { sap: SapRow | null; physical: PhysicalRow | null; onClose: () => void };

type Field = { label: string; sap: unknown; physical: unknown; compare?: boolean };

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : String(v));
const norm = (v: unknown) => show(v).toLowerCase();

/** Side-by-side view of a SAP row and its matched physical unit; differing fields highlighted. */
export function PairDetail({ sap, physical, onClose }: Props) {
  const t = useT();
  const year = physical?.activation_date ? Number(physical.activation_date.slice(0, 4)) : null;
  const fields: Field[] = [
    { label: t.cols.row, sap: sap?.excel_row, physical: physical?.excel_row },
    { label: t.cols.assetId, sap: sap?.asset_id ?? sap?.suggested_asset_id, physical: physical?.asset_id, compare: true },
    { label: t.cols.sapItem, sap: sap?.item_name, physical: physical?.sap_type, compare: true },
    { label: t.cols.itemName, sap: null, physical: physical?.item_name },
    { label: t.cols.description, sap: sap?.remarks, physical: physical?.description },
    { label: t.cols.color, sap: sap?.color, physical: physical?.color, compare: true },
    { label: t.cols.width, sap: sap?.width_cm, physical: physical?.width_cm ?? physical?.size_word },
    { label: t.cols.building, sap: sap?.building, physical: physical?.building, compare: true },
    { label: t.cols.city, sap: sap?.city, physical: physical?.city },
    { label: t.cols.year, sap: sap?.serial_year, physical: year, compare: true },
    { label: t.cols.serial, sap: sap?.serial_no, physical: null },
    { label: t.cols.activation, sap: null, physical: physical?.activation_date },
    { label: t.cols.deactivation, sap: null, physical: physical?.deactivation_date },
    { label: t.cols.custodian, sap: null, physical: physical?.custodian },
    { label: t.cols.material, sap: sap?.material, physical: null },
    { label: t.cols.qr, sap: sap?.qr_code, physical: null },
    { label: t.cols.sheetStatus, sap: null, physical: physical?.status },
  ];

  return (
    <section aria-labelledby="pair-title" className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 id="pair-title" className="font-semibold">{t.detail.title}</h2>
        <button type="button" className="btn-secondary" onClick={onClose}>{t.close}</button>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-slate-600">
          <tr>
            <th className="w-40 py-1" />
            <th className="py-1">
              {t.detail.sap} {sap && <StatusBadge status={sap.match_status} />}{" "}
              <ConfidenceBadge confidence={sap?.confidence} />
            </th>
            <th className="py-1">
              {t.detail.physical} {physical && <StatusBadge status={physical.match_status} />}
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const differs = f.compare && sap && physical && norm(f.sap) !== norm(f.physical);
            return (
              <tr key={f.label} className={`border-t border-slate-100 ${differs ? "bg-amber-50" : ""}`}>
                <th scope="row" className="py-1 pr-2 text-left font-medium text-slate-600">
                  {f.label}
                  {differs && <span className="ml-1 text-xs text-amber-700">({t.detail.differs})</span>}
                </th>
                <td className="py-1 pr-2">{sap ? show(f.sap) : ""}</td>
                <td className="py-1">{physical ? show(f.physical) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(!sap || !physical) && <p className="mt-2 text-sm text-slate-500">{t.detail.noCounterpart}</p>}
      {[...(sap?.notes ?? []), ...(physical?.notes ?? [])].length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {[...(sap?.notes ?? []), ...(physical?.notes ?? [])].map((n, i) => (
            <li key={i}>{noteText(t, n)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
