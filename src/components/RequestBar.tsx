import { Check, Layers, Save, Send, Terminal } from "lucide-react";
import type { ProfilesState } from "../types";
import { METHOD_COLORS } from "./SidebarTree";
import { looksLikeCurl } from "../lib/curl";
import VarInput from "./VarInput";
import { t } from "../lib/i18n";


interface Props {
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
  onCopyCurl: () => void;
  /** Botón que acaba de completar su acción (muestra un check unos segundos). */
  flash?: "save" | "curl" | null;
  /** Botones extra elegidos por el usuario (Ajustes → Edición y atajos). */
  extra?: { id: string; label: string }[];
  onCommand?: (id: string) => void;
  /** Perfiles de variables del espacio y el activo; el selector queda justo encima de «Enviar». */
  profiles: ProfilesState;
  onProfile: (id: string | null) => void;
  /** Abre el gestor de perfiles en la barra lateral. */
  onManageProfiles: () => void;
}

const ghost =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40";

const done =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-leaf ring-1 ring-leaf/70 bg-leaf/10";

export default function RequestBar({ method, methods, onMore, url, sending, onMethod, onUrlEdit, onCurl, onSend, onSave, onCopyCurl, flash, extra = [], onCommand, profiles, onProfile, onManageProfiles }: Props) {
  const options = methods.includes(method) ? methods : [method, ...methods];
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-end gap-2 text-xs text-slate">
        <Layers size={13} />
        <span className="uppercase tracking-[0.025em]">{t("Perfil de variables")}</span>
        <select
          value={profiles.active ?? ""}
          onChange={(e) => (e.target.value === "__manage__" ? onManageProfiles() : onProfile(e.target.value || null))}
          title={t("Perfil de variables que se usa al enviar")}
          className="max-w-[14rem] rounded-[10px] bg-kelp px-3 py-1.5 text-xs font-semibold text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
        >
          <option value="">{t("Sin perfil")}</option>
          {profiles.list.map((p) => (
            <option key={p.id} value={p.id}>{p.name || t("Sin nombre")}</option>
          ))}
          <option value="__manage__">{t("Gestionar perfiles…")}</option>
        </select>
      </div>
      <div className="flex gap-2">
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
        className="flex-1 rounded-[10px] bg-kelp px-5 py-2 text-sm outline-none ring-1 ring-fg/10 focus:ring-aqua"
      />
      {extra.map((b) => (
        <button key={b.id} onClick={() => onCommand?.(b.id)} className={`${ghost} max-w-[11rem] truncate normal-case`} title={b.label}>
          <span className="truncate">{b.label}</span>
        </button>
      ))}
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
    </div>
  );
}
