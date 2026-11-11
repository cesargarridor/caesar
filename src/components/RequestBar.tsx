import { Check, Save, Send, Terminal } from "lucide-react";
import { METHOD_COLORS } from "./SidebarTree";
import { looksLikeCurl } from "../lib/curl";
import { t } from "../lib/i18n";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface Props {
  method: string;
  /** URL completa (base + params activos). */
  url: string;
  sending: boolean;
  onMethod: (m: string) => void;
  onUrlEdit: (u: string) => void;
  onCurl: (text: string) => void;
  onSend: () => void;
  onSave: () => void;
  onCopyCurl: () => void;
  /** Botón que acaba de completar su acción (muestra un check unos segundos). */
  flash?: "save" | "curl" | null;
}

const ghost =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40";

const done =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-leaf ring-1 ring-leaf/70 bg-leaf/10";

export default function RequestBar({ method, url, sending, onMethod, onUrlEdit, onCurl, onSend, onSave, onCopyCurl, flash }: Props) {
  const options = METHODS.includes(method) ? METHODS : [method, ...METHODS];
  return (
    <div className="flex gap-2 p-4">
      <select
        value={method}
        onChange={(e) => onMethod(e.target.value)}
        className={`rounded-[10px] bg-kelp px-4 py-2 text-sm font-semibold outline-none ring-1 ring-fg/10 focus:ring-aqua ${METHOD_COLORS[method] ?? ""}`}
      >
        {options.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <input
        value={url}
        onChange={(e) => (looksLikeCurl(e.target.value) ? onCurl(e.target.value) : onUrlEdit(e.target.value))}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (looksLikeCurl(text)) {
            e.preventDefault();
            onCurl(text); // el pegado conserva los saltos de línea del cURL original
          }
        }}
        onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && onSend()}
        placeholder={t("Escribe una URL o pega un comando cURL")}
        spellCheck={false}
        className="flex-1 rounded-[10px] bg-kelp px-5 py-2 text-sm outline-none ring-1 ring-fg/10 focus:ring-aqua"
      />
      <button onClick={onCopyCurl} className={flash === "curl" ? done : ghost} title={t("Copiar como cURL")}>
        {flash === "curl" ? <Check size={14} /> : <Terminal size={14} />} {flash === "curl" ? t("Copiado") : "cURL"}
      </button>
      <button onClick={onSave} className={flash === "save" ? done : ghost} title={t("Guardar en la colección (Ctrl+S)")}>
        {flash === "save" ? <Check size={14} /> : <Save size={14} />} {flash === "save" ? t("Guardado") : t("Guardar")}
      </button>
      <button onClick={onSend} disabled={sending} className="btn-aurora flex items-center gap-2 px-6 py-2 font-semibold disabled:opacity-50">
        <Send size={14} /> {sending ? t("Enviando…") : t("Enviar")}
      </button>
    </div>
  );
}
