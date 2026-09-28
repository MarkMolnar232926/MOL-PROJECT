import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorText, useT } from "../i18n";

export function RulesPage() {
  const t = useT();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  if (config.isPending) return <p>{t.loading}</p>;
  if (config.isError) return <p role="alert">{errorText(t, config.error)}</p>;
  const c = config.data;
  const th = "px-2 py-1.5 text-left font-semibold";
  const td = "px-2 py-1 border-t border-slate-100";
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t.rules.title}</h2>
      <section>
        <h3 className="mb-2 font-semibold">{t.rules.typeRules(c.rules_version)}</h3>
        <table className="w-full max-w-3xl rounded-lg bg-white text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className={th}>#</th>
              <th className={th}>{t.rules.ruleItem}</th>
              <th className={th}>{t.rules.ruleKeyword}</th>
              <th className={th}>{t.rules.ruleSapType}</th>
            </tr>
          </thead>
          <tbody>
            {c.type_rules.map((r, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                <td className={td}>{r.item}</td>
                <td className={td}>{r.keyword ? `“${r.keyword}”` : <em className="text-slate-500">{t.rules.anyDescription}</em>}</td>
                <td className={td}>{r.sap_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">{t.rules.locations}</h3>
        <table className="w-full max-w-md bg-white text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className={th}>{t.cols.city}</th>
              <th className={th}>{t.cols.building}</th>
              <th className={th}>{t.rules.siteCode}</th>
            </tr>
          </thead>
          <tbody>
            {c.locations.map((l) => (
              <tr key={l.building}>
                <td className={td}>{l.city}</td>
                <td className={td}>{l.building}</td>
                <td className={td}>{l.site_code}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">{t.rules.matching}</h3>
        <p className="text-sm">{t.rules.equalCriteria(Object.values(t.criteria).join(", "))}</p>
        <p className="mt-1 text-sm">{t.rules.threshold(c.scoring.auto_match_threshold ?? 100)}</p>
        <p className="mt-1 text-sm">
          {t.rules.materialKeywords}: {(c.scoring.material_keywords ?? []).join(", ")}
        </p>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">{t.rules.excluded}</h3>
        <ul className="list-disc pl-5 text-sm">{c.excluded_statuses.map((s) => <li key={s}>{s}</li>)}</ul>
      </section>
    </div>
  );
}
