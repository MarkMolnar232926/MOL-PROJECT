import { useT } from "../i18n";
import { Icon } from "./Icon";

export type Step = "original" | "incoming" | "matching" | "export";
export const STEPS: Step[] = ["original", "incoming", "matching", "export"];

type Props = {
  current: Step;
  available: Record<Step, boolean>;
  done: Record<Step, boolean>;
  onSelect: (step: Step) => void;
};

/** 1 Original → 2 Incoming → 3 Matching → 4 Export. A step opens once the one before is done. */
export function Stepper({ current, available, done, onSelect }: Props) {
  const t = useT();
  return (
    <nav aria-label={t.steps.label}>
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {STEPS.map((step, i) => {
          const active = step === current;
          const state = active
            ? t.steps.current
            : done[step]
              ? t.steps.done
              : !available[step]
                ? t.steps.locked
                : "";
          return (
            <li key={step} className="relative">
              <button
                type="button"
                onClick={() => onSelect(step)}
                disabled={!available[step]}
                aria-current={active ? "step" : undefined}
                data-testid={`step-${step}`}
                data-done={done[step] || undefined}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                    : done[step]
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                      : available[step]
                        ? "border-slate-200 bg-white text-slate-800 hover:border-indigo-300"
                        : "border-slate-200 bg-slate-50 text-slate-400"
                } disabled:cursor-not-allowed`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    active
                      ? "bg-white text-indigo-700"
                      : done[step]
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {done[step] && !active ? <Icon name="check" className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t.steps[step]}</span>
                  <span className={`block truncate text-xs ${active ? "text-indigo-100" : "opacity-70"}`}>
                    {t.steps.hint[step]}
                  </span>
                </span>
                {state && <span className="sr-only">({state})</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
