import { useState } from "react";
import { Sparkles, Minimize2 } from "lucide-react";
import KVEditor from "./KVEditor";
import FormDataEditor from "./FormDataEditor";
import JsonEditor from "./JsonEditor";
import type { BodyData, BodyMode } from "../types";
import { t } from "../lib/i18n";
import { checkJson, issueText } from "../lib/jsonCheck";

interface Props {
  body: BodyData;
  onChange: (b: BodyData) => void;
}

const MODES: { id: BodyMode; label: string }[] = [
  { id: "none", label: "none" },
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "formdata", label: "form-data" },
  { id: "urlencoded", label: "x-www-form-urlencoded" },
];

export default function BodyEditor({ body, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);

  const reformat = (indent: number | undefined) => {
    const issue = checkJson(body.raw);
    if (issue) {
      setError(issueText(issue));
      return;
    }
    try {
      // Con variables {{x}} sin comillas no es JSON estricto: no se puede reformatear sin romperlas.
      onChange({ ...body, raw: JSON.stringify(JSON.parse(body.raw), null, indent) });
      setError(null);
    } catch {
      setError(t("No se puede formatear: el body usa variables {{x}} fuera de comillas."));
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {MODES.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="body-mode"
              checked={body.mode === m.id}
              onChange={() => {
                setError(null);
                onChange({ ...body, mode: m.id });
              }}
              className="accent-[var(--t-accent)]"
            />
            {m.label}
          </label>
        ))}
        {body.mode === "json" && (
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => reformat(2)}
              className="flex items-center gap-1 rounded-md border border-fg/10 px-2 py-1 text-xs hover:border-aqua hover:text-aqua"
              title={t("Formatear con indentación")}
            >
              <Sparkles size={13} /> Beautify
            </button>
            <button
              onClick={() => reformat(undefined)}
              className="flex items-center gap-1 rounded-md border border-fg/10 px-2 py-1 text-xs hover:border-aqua hover:text-aqua"
              title={t("Compactar en una línea")}
            >
              <Minimize2 size={13} /> Minify
            </button>
          </span>
        )}
      </div>

      {error && <p className="text-xs text-rose">{error}</p>}

      {body.mode === "none" && <p className="text-xs text-slate">{t("Esta petición no envía body.")}</p>}

      {(body.mode === "json" || body.mode === "text") && (
        <JsonEditor
          value={body.raw}
          onChange={(raw) => onChange({ ...body, raw })}
          highlight={body.mode === "json"}
          placeholder={body.mode === "json" ? '{ "clave": "valor" }' : t("Texto plano")}
          className="min-h-48 flex-1"
        />
      )}
      {body.mode === "formdata" && (
        <FormDataEditor rows={body.formdata} onChange={(formdata) => onChange({ ...body, formdata })} />
      )}

      {body.mode === "urlencoded" && (
        <KVEditor rows={body.urlencoded} onChange={(urlencoded) => onChange({ ...body, urlencoded })} />
      )}
    </div>
  );
}
