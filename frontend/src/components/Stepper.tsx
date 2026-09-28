import { useT } from "../i18n";

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
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((step, i) => {
          const active = step === current;
          const state = active ? t.steps.current : done[step] ? t.steps.done : !available[step] ? t.steps.locked : "";
          return (
            <li key={step}>
              <button
                type="button"
                onClick={() => onSelect(step)}
                disabled={!available[step]}
                aria-current={active ? "step" : undefined}
                data-testid={`step-${step}`}
                data-done={done[step] || undefined}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                  active
                    ? "border-blue-700 bg-blue-700 text-white"
                    : done[step]
                      ? "border-green-600 bg-green-50 text-green-800"
                      : "border-slate-300 bg-white text-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                    active ? "bg-white text-blue-700" : done[step] ? "bg-green-600 text-white" : "bg-slate-200"
                  }`}
                >
                  {done[step] && !active ? "✓" : i + 1}
                </span>
                <span>{t.steps[step]}</span>
                {state && <span className="sr-only">({state})</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
