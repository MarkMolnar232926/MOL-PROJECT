import { useId, useState, type DragEvent } from "react";
import { t } from "../i18n/en";

type Props = {
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
};

/** Drag-and-drop area that is also a normal, keyboard-accessible file input. */
export function DropZone({ label, file, onFile }: Props) {
  const id = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`rounded-lg border-2 border-dashed p-5 text-sm transition ${
        over ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white"
      }`}
    >
      <div className="font-medium text-slate-800">{label}</div>
      {file ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-slate-700">{t.upload.chosen(file.name)}</span>
          <button type="button" className="link" onClick={() => onFile(null)}>
            {t.upload.remove}
          </button>
        </div>
      ) : (
        <div className="mt-2 text-slate-600">
          {t.upload.drop}{" "}
          <label htmlFor={id} className="link cursor-pointer focus-within:ring-2">
            {t.upload.browse}
            <input
              id={id}
              type="file"
              accept=".xlsx,.xlsm"
              aria-label={label}
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
