import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal, X } from "lucide-react";
import { parseCurl } from "../lib/curl";
import type { RequestState } from "../types";
import { t } from "../lib/i18n";

interface Props {
  /** Se llama con la petición ya parseada: la interfaz la abre en una pestaña nueva. */
  onAccept: (req: RequestState) => void;
  onClose: () => void;
}

const METHOD_COLORS: Record<string, string> = { GET: "text-[#4ad295]", POST: "text-[#ffb454]", PUT: "text-[#5ab0ff]", PATCH: "text-[#c792ea]", DELETE: "text-[#ff6b7a]" };

const BODY_LABEL: Record<string, string> = { json: "JSON", text: "Text", graphql: "GraphQL", formdata: "form-data", urlencoded: "x-www-form-urlencoded" };

/** Importador inverso: pega un cURL, ve qué se importará y ábrelo en una pestaña nueva sin tocar la actual. */
export default function CurlImportDialog({ onAccept, onClose }: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const result = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return { req: parseCurl(text) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);
  const req = result && "req" in result ? result.req : null;

  const headers = req ? req.headers.filter((h) => h.enabled && h.key) : [];
  const params = req ? req.params.filter((p) => p.enabled && p.key) : [];
  const bodyLabel = req && req.body.mode !== "none" ? BODY_LABEL[req.body.mode] ?? req.body.mode : null;
  const accept = () => req && onAccept(req);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={t("Importar desde cURL")}
        className="glass flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-kelp p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Terminal size={18} className="text-aqua" />
          <h2 className="flex-1 text-xl text-mist">{t("Importar desde cURL")}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate hover:text-mist" aria-label={t("Cerrar")}>
            <X size={16} />
          </button>
        </div>
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && accept()}
          spellCheck={false}
          placeholder={"curl -X POST https://api.ejemplo.com/items \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"nombre\":\"Caesar\"}'"}
          className="min-h-44 w-full resize-y rounded-xl bg-deep p-3 font-mono text-xs text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
        />

        <div className="min-h-24 rounded-xl bg-deep/60 p-3 text-sm ring-1 ring-fg/10" aria-live="polite">
          <p className="eyebrow mb-2">{t("Vista previa")}</p>
          {!result && <p className="text-xs text-slate">{t("Pega un comando cURL arriba y verás aquí qué se importará.")}</p>}
          {result && "error" in result && <p className="text-xs text-rose">{t(result.error ?? "")}</p>}
          {req && (
            <div className="space-y-1.5">
              <p className="flex items-baseline gap-2">
                <span className={`text-xs font-bold ${METHOD_COLORS[req.method] ?? "text-silver"}`}>{req.method}</span>
                <span className="min-w-0 break-all text-mist">{req.url || t("(sin URL)")}</span>
              </p>
              <p className="flex flex-wrap gap-1.5 text-xs">
                {[
                  `${headers.length} Header${headers.length === 1 ? "" : "s"}`,
                  params.length ? `${params.length} Query param${params.length === 1 ? "" : "s"}` : null,
                  bodyLabel ? `Body ${bodyLabel}` : t("Sin body"),
                  req.auth.type !== "none" ? `Auth ${req.auth.type}` : null,
                ].filter((c): c is string => !!c).map((c) => (
                  <span key={c} className="rounded-md bg-fg/10 px-2 py-0.5 text-silver">{c}</span>
                ))}
              </p>
              {headers.length > 0 && (
                <ul className="max-h-24 overflow-y-auto text-xs text-slate">
                  {headers.map((h, i) => (
                    <li key={i} className="truncate"><span className="text-silver">{h.key}:</span> {h.value}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-slate">{t("Se abrirá en una pestaña nueva; la actual no se toca.")}</span>
          <button onClick={onClose} className="rounded-[10px] px-4 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist">
            {t("Cancelar")}
          </button>
          <button onClick={accept} disabled={!req} className="btn-aurora px-5 py-2 text-xs font-semibold disabled:opacity-40">
            {t("Aceptar")}
          </button>
        </div>
      </div>
    </div>
  );
}
