import { useId, useState, type DragEvent } from "react";
import { useT } from "../i18n";
import { Icon } from "./Icon";

type Props = {
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
};

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A large drag-and-drop area that is also a normal, keyboard-accessible file input. */
export function DropZone({ label, file, onFile }: Props) {
  const t = useT();
  const id = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  if (file) {
    return (
      <div className="animate-fade-up flex items-center gap-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
          <Icon name="file" className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-indigo-700">{label}</p>
          <p className="truncate font-semibold">{t.upload.chosen(file.name)}</p>
          <p className="text-xs text-slate-600">{size(file.size)}</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => onFile(null)}>
          <Icon name="x" className="h-4 w-4" />
          {t.upload.remove}
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition focus-within:ring-2 focus-within:ring-indigo-500 ${
        over ? "scale-[1.01] border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40"
      }`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
        <Icon name="upload" className="h-7 w-7" />
      </span>
      <span className="font-semibold text-slate-900">{label}</span>
      <span className="text-sm text-slate-600">
        {t.upload.drop} <span className="link">{t.upload.browse}</span>
      </span>
      <span className="text-xs text-slate-500">{t.upload.fileTypes}</span>
      <input
        id={id}
        type="file"
        accept=".xlsx,.xlsm"
        aria-label={label}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
