import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { errorText, useT } from "../i18n";
import { Icon } from "./Icon";

const MIN_MS = 1200; // long enough to see what is happening; the work itself is fast
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts the matching when the user enters the Matching step, and shows its progress. */
export function MatchingRun({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [stage, setStage] = useState(0);
  const started = useRef(false);
  const run = useMutation({
    mutationFn: async () => {
      const [res] = await Promise.all([api.match(sessionId), wait(MIN_MS)]);
      return res;
    },
    onSuccess: async (res) => {
      qc.setQueryData(["result", sessionId], res);
      await qc.invalidateQueries({ queryKey: ["state", sessionId] });
      onDone();
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run.mutate();
  }, [run]);
  useEffect(() => {
    if (!run.isPending) return;
    const id = setInterval(() => setStage((s) => Math.min(s + 1, t.run.stages.length - 1)), MIN_MS / 3);
    return () => clearInterval(id);
  }, [run.isPending, t.run.stages.length]);

  if (run.isError) {
    return (
      <div role="alert" className="card mx-auto max-w-xl space-y-3 p-6 text-center">
        <Icon name="alert" className="mx-auto h-10 w-10 text-red-600" />
        <p className="font-semibold">{t.run.failed}</p>
        <p className="text-sm text-slate-600">{errorText(t, run.error)}</p>
        <button type="button" className="btn-primary" onClick={() => run.mutate()}>
          {t.run.retry}
        </button>
      </div>
    );
  }
  return (
    <div className="card mx-auto max-w-xl p-8 text-center" role="status" aria-live="polite" data-testid="matching-run">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
        <Icon name="link" className="h-8 w-8" />
      </span>
      <h2 className="mt-4 text-xl font-bold">{t.run.title}</h2>
      <p className="mt-1 text-sm text-slate-600">{t.run.text}</p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-indigo-100">
        <div className="animate-slide h-2 w-2/5 rounded-full bg-indigo-600" />
      </div>
      <ol className="mt-5 space-y-2 text-left text-sm">
        {t.run.stages.map((label, i) => (
          <li key={label} className={`flex items-center gap-2 ${i <= stage ? "text-slate-900" : "text-slate-400"}`}>
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full ${
                i < stage ? "bg-emerald-600 text-white" : i === stage ? "bg-indigo-600 text-white" : "bg-slate-200"
              }`}
            >
              {i < stage && <Icon name="check" className="h-3 w-3" />}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
