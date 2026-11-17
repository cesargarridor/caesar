import { useState } from "react";
import { Sparkles, Minimize2, WandSparkles } from "lucide-react";
import KVEditor from "./KVEditor";
import FormDataEditor from "./FormDataEditor";
import JsonEditor from "./JsonEditor";
import type { AuthData, BodyData, BodyMode, KV, RequestState } from "../types";
import { t } from "../lib/i18n";
import { checkJson, issueText } from "../lib/jsonCheck";
import GraphqlEditor from "./GraphqlEditor";
interface Props {
  body: BodyData;
  onChange: (b: BodyData) => void;
  /** Petición completa (URL, cabeceras, auth) y variables: el modo GraphQL los usa para cargar el esquema. */
  req: RequestState;
  vars?: KV[];
  inherited?: AuthData | null;
  onMethod?: (m: string) => void;
  /** Abre el asistente de IA (sugerir cuerpo, explicar…). */
  onAi?: () => void;
}

const MODES: { id: BodyMode; label: string }[] = [
  { id: "none", label: "none" },
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "graphql", label: "GraphQL" },
  { id: "formdata", label: "form-data" },
  { id: "urlencoded", label: "x-www-form-urlencoded" },
];

export default function BodyEditor({ body, onChange, req, vars, inherited, onMethod, onAi }: Props) {
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
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="tablist" aria-label="Body" className="inline-flex items-center gap-0.5 rounded-md bg-[#1a1a1a] p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={body.mode === m.id}
              onClick={() => {
                setError(null);
                onChange({ ...body, mode: m.id });
                // GraphQL va por POST: si estaba en GET se cambia solo.
                if (m.id === "graphql" && req.method === "GET") onMethod?.("POST");
              }}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/50 ${
                body.mode === m.id ? "bg-[#2a2a2a] text-white shadow-sm" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {(onAi || body.mode === "json") && (
          <span className="ml-auto flex gap-2">
            {onAi && (
              <button
                onClick={onAi}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                title={t("Asistente de IA (con tu propia clave)")}
              >
                <WandSparkles size={13} /> {t("Asistente de IA")}
              </button>
            )}
            {body.mode === "json" && (<>
            <button
              onClick={() => reformat(2)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate hover:bg-fg/10 hover:text-mist"
              title={t("Formatear con indentación")}
            >
              <Sparkles size={13} /> Beautify
            </button>
            <button
              onClick={() => reformat(undefined)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate hover:bg-fg/10 hover:text-mist"
              title={t("Compactar en una línea")}
            >
              <Minimize2 size={13} /> Minify
            </button>
            </>)}
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
          lineNumbers
          placeholder={body.mode === "json" ? '{ "clave": "valor" }' : t("Texto plano")}
          className="min-h-48 flex-1"
        />
      )}
      {body.mode === "graphql" && (
        <GraphqlEditor body={body} onChange={onChange} req={req} vars={vars ?? []} inherited={inherited} onMethod={onMethod} />
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
