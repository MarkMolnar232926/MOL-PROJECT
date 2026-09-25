import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { t } from "./i18n/en";

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const status = health.isPending ? t.checking : health.isSuccess ? t.apiOk : t.apiDown;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-6 py-4">
        <h1 className="text-xl font-semibold">{t.appTitle}</h1>
      </header>
      <main className="p-6 space-y-2">
        <p>
          {t.apiStatus}: <span data-testid="api-status">{status}</span>
        </p>
        <p className="text-slate-500">{t.placeholder}</p>
      </main>
    </div>
  );
}
