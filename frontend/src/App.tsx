import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api/client";
import { ExportButton } from "./components/ExportButton";
import { useStoredState } from "./hooks/useStoredState";
import { LANGUAGES, useLanguage, useT, type Language } from "./i18n";
import { ResultsPage } from "./pages/ResultsPage";
import { RulesPage } from "./pages/RulesPage";
import { UploadPage } from "./pages/UploadPage";

type Page = "upload" | "results" | "rules";

function LanguageSwitcher() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <span>{t.languageLabel}</span>
      <select
        className="input"
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        {(Object.keys(LANGUAGES) as Language[]).map((l) => (
          <option key={l} value={l} lang={l}>
            {LANGUAGES[l].languageName}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function App() {
  const t = useT();
  const [sessionId, setSessionId] = useStoredState("recon.sessionId");
  const [page, setPage] = useState<Page>(sessionId ? "results" : "upload");
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  // Shares the cache entry with the results page, so the export dialog knows the pending count.
  const result = useQuery({
    queryKey: ["result", sessionId],
    queryFn: () => api.result(sessionId!),
    enabled: sessionId !== null,
    retry: false,
  });
  const pending = result.data?.summary.tie_slots_pending ?? 0;

  const nav: [Page, string][] = [
    ["upload", t.nav.upload],
    ["results", t.nav.results],
    ["rules", t.nav.rules],
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold">{t.appTitle}</h1>
        <nav aria-label="Main" className="flex gap-1">
          {nav.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
              disabled={id === "results" && !sessionId}
              className={`rounded-md px-3 py-1.5 text-sm ${
                page === id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              } disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />
          <ExportButton sessionId={sessionId} pendingSlots={pending} />
        </div>
      </header>
      {health.isError && (
        <p role="alert" className="bg-red-600 px-6 py-2 text-sm text-white">
          {t.apiDown}
        </p>
      )}
      <main className="p-6">
        {page === "upload" && (
          <UploadPage
            onUploaded={(created) => setSessionId(created.session_id)}
            onViewResults={() => setPage("results")}
          />
        )}
        {page === "results" && sessionId && (
          <ResultsPage
            sessionId={sessionId}
            onExpired={() => {
              setSessionId(null);
              setPage("upload");
            }}
          />
        )}
        {page === "results" && !sessionId && <p>{t.results.noSession}</p>}
        {page === "rules" && <RulesPage />}
      </main>
    </div>
  );
}
