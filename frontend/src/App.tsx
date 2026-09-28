import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import { ConfirmDialog } from "./components/Dialog";
import { Stepper, type Step } from "./components/Stepper";
import { useStoredState } from "./hooks/useStoredState";
import { LANGUAGES, useLanguage, useT, type Language } from "./i18n";
import { ExportStep } from "./pages/ExportStep";
import { MatchingStep, type MatchingTab } from "./pages/MatchingStep";
import { RulesPage } from "./pages/RulesPage";
import { UploadStep } from "./pages/UploadStep";

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
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useStoredState("recon.sessionId");
  const [step, setStep] = useState<Step>("original");
  const [tab, setTab] = useState<MatchingTab>("overview");
  const [showRules, setShowRules] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [expired, setExpired] = useState(false);
  const [uploads, setUploads] = useState(0); // remounts the matching step after a new upload

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const state = useQuery({
    queryKey: ["state", sessionId],
    queryFn: () => api.state(sessionId!),
    enabled: sessionId !== null,
    retry: false,
  });
  const matched = state.data?.matched ?? false;
  const result = useQuery({
    queryKey: ["result", sessionId],
    queryFn: () => api.result(sessionId!),
    enabled: sessionId !== null && matched,
    retry: false,
  });

  // A stored session that has expired on the server: start again.
  useEffect(() => {
    if (state.error instanceof ApiError && state.error.status === 404) {
      setSessionId(null);
      setExpired(true);
    }
  }, [state.error, setSessionId]);

  // Open on the first step that is not done yet.
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (placed || (sessionId && !state.data)) return;
    setPlaced(true);
    const s = state.data;
    setStep(!s?.original ? "original" : !s.matched ? "incoming" : "matching");
  }, [placed, sessionId, state.data]);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const created = await api.createSession();
    setSessionId(created.session_id);
    setExpired(false);
    return created.session_id;
  };

  const summary = result.data?.summary;
  const available: Record<Step, boolean> = {
    original: true,
    incoming: Boolean(state.data?.original),
    matching: matched,
    export: matched,
  };
  const done: Record<Step, boolean> = {
    original: Boolean(state.data?.original),
    incoming: matched,
    matching: Boolean(summary?.export_ready),
    export: false,
  };
  const current: Step = available[step] ? step : "original";
  const toQueue = () => {
    setTab("resolve");
    setStep("matching");
    setShowRules(false);
  };

  const startOver = () => {
    if (sessionId) void api.deleteSession(sessionId).catch(() => {});
    qc.clear();
    setSessionId(null);
    setStep("original");
    setTab("overview");
    setConfirmNew(false);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold">{t.appTitle}</h1>
        {!showRules && (
          <Stepper
            current={current}
            available={available}
            done={done}
            onSelect={(s) => {
              setStep(s);
              setShowRules(false);
            }}
          />
        )}
        <div className="ml-auto flex items-center gap-3">
          {sessionId && state.data?.original && !showRules && (
            <button type="button" className="btn-secondary" onClick={() => setConfirmNew(true)}>
              {t.nav.newSession}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setShowRules(!showRules)}>
            {showRules ? t.nav.back : t.nav.rules}
          </button>
          <LanguageSwitcher />
        </div>
      </header>
      {health.isError && (
        <p role="alert" className="bg-red-600 px-6 py-2 text-sm text-white">
          {t.apiDown}
        </p>
      )}
      {expired && (
        <p role="status" className="bg-amber-100 px-6 py-2 text-sm text-amber-900">
          {t.expired}
        </p>
      )}
      <main className="p-6">
        {showRules ? (
          <RulesPage />
        ) : (
          <>
            {(current === "original" || current === "incoming") && (
              <UploadStep
                key={current}
                kind={current}
                state={state.data}
                match={summary}
                ensureSession={ensureSession}
                onUploaded={() => setUploads((n) => n + 1)}
                onContinue={() => setStep(current === "original" ? "incoming" : "matching")}
              />
            )}
            {/* Kept mounted while other steps show, so the queue and its progress survive. */}
            {sessionId && result.data && (
              <div hidden={current !== "matching"}>
                <MatchingStep
                  key={uploads}
                  sessionId={sessionId}
                  result={result.data}
                  tab={tab}
                  setTab={setTab}
                  active={current === "matching"}
                />
              </div>
            )}
            {current === "export" && sessionId && result.data && (
              <ExportStep sessionId={sessionId} result={result.data} onQueue={toQueue} />
            )}
            {(current === "matching" || current === "export") && result.isPending && <p>{t.loading}</p>}
          </>
        )}
      </main>
      {confirmNew && (
        <ConfirmDialog
          title={t.newSessionConfirmTitle}
          message={t.newSessionConfirm}
          confirmLabel={t.nav.newSession}
          onConfirm={startOver}
          onCancel={() => setConfirmNew(false)}
        />
      )}
    </div>
  );
}
