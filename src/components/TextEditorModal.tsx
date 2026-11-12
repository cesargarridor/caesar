import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import JsonEditor from "./JsonEditor";
import { t } from "../lib/i18n";
import { checkJson, issueText } from "../lib/jsonCheck";

interface Props {
  title?: string;
  initial: string;
  onDone: (value: string) => void;
  onCancel: () => void;
}

/** Editor grande para el valor de un campo de texto de form-data . */
export default function TextEditorModal({ title = "Edit data", initial, onDone, onCancel }: Props) {
  // Al abrir, si el contenido es JSON válido se muestra ya formateado (beautify).
  const [value, setValue] = useState(() => {
    if (!/^\s*[[{]/.test(initial)) return initial;
    try {
      return JSON.stringify(JSON.parse(initial), null, 2);
    } catch {
      return initial;
    }
  });
  const [lang, setLang] = useState<"json" | "text">(() => (/^\s*[[{]/.test(initial) ? "json" : "text"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const beautify = () => {
    const issue = checkJson(value);
    if (issue) {
      setError(issueText(issue));
      return;
    }
    try {
      setValue(JSON.stringify(JSON.parse(value), null, 2));
      setError(null);
    } catch {
      setError(t("No se puede formatear: el texto usa variables {{x}} fuera de comillas."));
    }
  };

  return (
    <div data-modal className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-8" onMouseDown={onCancel}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl bg-kelp glass p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-normal tracking-[-0.02em] text-mist">{title}</h2>
          <button onClick={onCancel} className="text-slate hover:text-mist" title={t("Cerrar (Esc)")}>
            <X size={22} />
          </button>
        </div>

        <JsonEditor autoFocus value={value} onChange={setValue} highlight={lang === "json"} className="h-[50vh] min-h-80 shrink-0" />

        <div className="mt-2 flex items-center gap-3 text-xs">
          {lang === "json" && (
            <button onClick={beautify} className="flex items-center gap-1 text-silver hover:text-mist">
              <Sparkles size={13} /> Beautify JSON
            </button>
          )}
          {error && <span className="text-rose">{error}</span>}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as "json" | "text")}
            className="rounded-xl bg-deep px-3 py-2 text-sm text-mist outline-none ring-1 ring-fg/10"
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
          <button onClick={() => onDone(value)} className="btn-aurora px-8 py-3 font-semibold">
            {t("Listo")}
          </button>
        </div>
      </div>
    </div>
  );
}
