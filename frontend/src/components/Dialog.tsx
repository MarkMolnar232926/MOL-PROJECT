import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT } from "../i18n";

type ModalProps = {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  footer: ReactNode;
  role?: "dialog" | "alertdialog";
};

/** A small modal (focus moves into it; Escape cancels). */
export function Modal({ title, onCancel, children, footer, role = "dialog" }: ModalProps) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = boxRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={boxRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-slate-700">{children}</div>
        <div className="mt-5 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

type ConfirmProps = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmProps) {
  const t = useT();
  return (
    <Modal
      title={title}
      onCancel={onCancel}
      role="alertdialog"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {t.cancel}
          </button>
          <button type="button" data-autofocus className="btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
