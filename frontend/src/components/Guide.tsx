import type { ReactNode } from "react";
import { useT } from "../i18n";
import { Icon } from "./Icon";

type Props = { title: string; children: ReactNode; tone?: "todo" | "done" | "warn"; action?: ReactNode };

/** "What to do now" banner at the top of each step. */
export function Guide({ title, children, tone = "todo", action }: Props) {
  const t = useT();
  const tones = {
    todo: "border-indigo-200 bg-indigo-50 text-indigo-950",
    done: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
  };
  const iconTone = { todo: "bg-indigo-600", done: "bg-emerald-600", warn: "bg-amber-500" };
  return (
    <section
      aria-label={t.guide.label}
      data-testid="guide"
      className={`animate-fade-up flex flex-wrap items-center gap-4 rounded-2xl border p-4 ${tones[tone]}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${iconTone[tone]}`}>
        <Icon name={tone === "done" ? "check" : tone === "warn" ? "alert" : "bulb"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
          {tone === "done" ? t.guide.doneLabel : t.guide.todoLabel}
        </p>
        <h3 className="font-semibold">{title}</h3>
        <div className="text-sm opacity-90">{children}</div>
      </div>
      {action}
    </section>
  );
}
