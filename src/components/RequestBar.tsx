import { useEffect, useRef, useState } from "react";
import { Check, Code2, Link2, Save, Send, Settings2, Terminal } from "lucide-react";
import type { RequestKind, Settings } from "../types";
import { METHOD_COLORS } from "./SidebarTree";
import { looksLikeCurl } from "../lib/curl";
import VarInput from "./VarInput";
import KindSelect from "./KindSelect";
import { t } from "../lib/i18n";


interface Props {
  kind?: RequestKind;
  onKind?: (k: RequestKind) => void;
  method: string;
  /** Métodos que ofrece el desplegable (los base + los que el usuario activó en Ajustes). */
  methods: string[];
  /** Abre Ajustes para activar más métodos. */
  onMore: () => void;
  /** URL completa (base + params activos). */
  url: string;
  sending: boolean;
  onMethod: (m: string) => void;
  onUrlEdit: (u: string) => void;
  onCurl: (text: string) => void;
  onSend: () => void;
  onSave: () => void;
  /** Abre el importador de cURL (vista previa + pestaña nueva). */
  onImportCurl: () => void;
  onCodegen?: () => void;
  /** Abre el asistente de IA (con tu propia clave). */
    /** Copia un enlace caesar:// con esta petición (sin nube). */
  onShareLink?: () => void;
  codegenOpen?: boolean;
  /** Botón que acaba de completar su acción (muestra un check unos segundos). */
  flash?: "save" | "curl" | "link" | null;
  /** Botones extra elegidos por el usuario (Ajustes → Edición y atajos). */
  extra?: { id: string; label: string }[];
  onCommand?: (id: string) => void;
  /** Opciones de red de la petición (SSL y redirecciones). */
  settings?: Settings;
  onSettings?: (s: Settings) => void;
}

function Toggle({ on, onChange, label, hint, warn }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; warn?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-fg/5"
    >
      <span className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? "bg-aqua" : "bg-fg/20"}`}>
        <span className={`h-3 w-3 rounded-full bg-white transition-transform ${on ? "translate-x-3" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-mist">{label}</span>
        {hint && <span className={`block text-xs ${warn ? "text-lav" : "text-slate"}`}>{hint}</span>}
      </span>
    </button>
  );
}

const ghost =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-slate hover:bg-fg/10 hover:text-mist";

const done =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-leaf ring-1 ring-leaf/70 bg-leaf/10";

export default function RequestBar({ kind = "http", onKind, method, methods, onMore, url, sending, onMethod, onUrlEdit, onCurl, onSend, onSave, onImportCurl, onCodegen, onShareLink, codegenOpen, flash, extra = [], onCommand, settings, onSettings }: Props) {
  const [netOpen, setNetOpen] = useState(false);
  const netRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!netOpen) return;
    const close = (e: MouseEvent) => { if (!netRef.current?.contains(e.target as Node)) setNetOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setNetOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [netOpen]);
  const options = methods.includes(method) ? methods : [method, ...methods];
  const icon = "flex items-center rounded-[10px] px-3 py-2 text-slate hover:bg-fg/10 hover:text-mist";
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex gap-2">
        {onKind && <KindSelect kind={kind} onChange={onKind} />}
        <select
          value={method}
          onChange={(e) => (e.target.value === "__more__" ? onMore() : onMethod(e.target.value))}
          className={`rounded-[10px] bg-kelp px-4 py-2 text-sm font-semibold outline-none ring-1 ring-fg/10 focus:ring-aqua ${METHOD_COLORS[method] ?? ""}`}
        >
          {options.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value="__more__">{t("+ Más métodos…")}</option>
        </select>
        <div className="relative flex min-w-0 flex-1">
          <VarInput
            id="caesar-url"
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
            className="w-full flex-1 rounded-[10px] bg-kelp py-2 pl-5 pr-11 text-sm outline-none ring-1 ring-fg/10 focus:ring-aqua"
          />
          <button onClick={onImportCurl} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate/70 hover:text-aqua" title={t("Importar desde cURL")} aria-label={t("Importar desde cURL")}>
            <Terminal size={14} />
          </button>
        </div>
        {extra.map((b) => (
          <button key={b.id} onClick={() => onCommand?.(b.id)} className={`${ghost} max-w-[11rem] truncate normal-case`} title={b.label}>
            <span className="truncate">{b.label}</span>
          </button>
        ))}
        {onCodegen && (
          <button onClick={onCodegen} className={codegenOpen ? done : icon} title={t("Generar código (</>)")} aria-label={t("Generar código")} aria-pressed={!!codegenOpen}>
            <Code2 size={14} />
          </button>
        )}
        {onShareLink && (
          <button onClick={onShareLink} className={flash === "link" ? `${icon} !text-leaf !ring-leaf/70 bg-leaf/10` : icon} title={t("Copiar enlace para compartir")} aria-label={t("Copiar enlace")}>
            {flash === "link" ? <Check size={14} /> : <Link2 size={14} />}
          </button>
        )}
        <button onClick={onSave} className={flash === "save" ? done : ghost} title={t("Guardar en la colección (Ctrl+S)")}>
          {flash === "save" ? <Check size={14} /> : <Save size={14} />} {flash === "save" ? t("Guardado") : t("Guardar")}
        </button>
        {settings && onSettings && (
          <div ref={netRef} className="relative flex">
            <button
              onClick={() => setNetOpen((o) => !o)}
              className={`${icon} ${!settings.verifySsl || !settings.followRedirects ? "!text-aqua" : ""}`}
              title={t("Opciones de red")}
              aria-label={t("Opciones de red")}
              aria-expanded={netOpen}
            >
              <Settings2 size={14} />
            </button>
            {netOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl bg-kelp p-2 shadow-xl ring-1 ring-fg/10">
                <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate">{t("Opciones de red")}</p>
                <Toggle
                  on={!settings.verifySsl}
                  onChange={(v) => onSettings({ ...settings, verifySsl: !v })}
                  label={t("Ignorar SSL")}
                  hint={settings.verifySsl ? t("Acepta certificados autofirmados (localhost)") : t("⚠ desactivado: solo para pruebas")}
                  warn={!settings.verifySsl}
                />
                <Toggle
                  on={settings.followRedirects}
                  onChange={(v) => onSettings({ ...settings, followRedirects: v })}
                  label={t("Seguir redirecciones")}
                  hint={settings.followRedirects ? undefined : t("Verás el 301/302 original")}
                />
              </div>
            )}
          </div>
        )}
        <button onClick={onSend} disabled={sending} className="btn-aurora flex items-center gap-2 px-6 py-2 font-semibold disabled:opacity-50">
          <Send size={14} /> {sending ? t("Enviando…") : t("Enviar")}
        </button>
      </div>
    </div>
  );
}
