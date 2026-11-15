import { useState } from "react";
import { BookmarkPlus, Radio, Send, Trash2 } from "lucide-react";
import JsonEditor from "./JsonEditor";
import type { WsConfig, WsMsgFormat } from "../types";
import { encodeOutgoing } from "../lib/ws";
import { t } from "../lib/i18n";

interface Props {
  cfg: WsConfig;
  onCfg: (p: Partial<WsConfig>) => void;
  connected: boolean;
  onSend: () => void;
  onPing: () => void;
  /** Mensaje de error del último intento de envío. */
  error: string | null;
}

const FORMATS: { id: WsMsgFormat; label: string; hint: string }[] = [
  { id: "text", label: "Texto", hint: "Mensaje de texto (UTF-8)" },
  { id: "json", label: "JSON", hint: "Texto JSON validado antes de enviar" },
  { id: "hex", label: "Binario (hex)", hint: "Bytes en hexadecimal, p. ej. 48 65 6c 6c 6f" },
  { id: "base64", label: "Binario (base64)", hint: "Bytes codificados en base64" },
];

/** Compositor de mensajes: formato, editor, envío y mensajes guardados de la petición. */
export default function WsComposer({ cfg, onCfg, connected, onSend, onPing, error }: Props) {
  const [name, setName] = useState("");
  const fmt = FORMATS.find((f) => f.id === cfg.draftFormat) ?? FORMATS[0];
  let problem: string | null = null;
  if (cfg.draft.trim()) {
    try {
      encodeOutgoing(cfg.draftFormat, cfg.draft);
    } catch (e) {
      problem = t((e as Error).message);
    }
  }
  const save = () => {
    const n = name.trim() || cfg.draft.trim().slice(0, 30) || t("Mensaje");
    onCfg({ saved: [...cfg.saved, { id: crypto.randomUUID(), name: n, format: cfg.draftFormat, data: cfg.draft }] });
    setName("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span role="radiogroup" aria-label={t("Formato del mensaje")} className="flex overflow-hidden rounded-md border border-fg/10 text-xs">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={cfg.draftFormat === f.id}
              title={t(f.hint)}
              onClick={() => onCfg({ draftFormat: f.id })}
              className={`px-2.5 py-1.5 ${cfg.draftFormat === f.id ? "bg-kelp text-mist" : "text-silver hover:text-mist"}`}
            >
              {t(f.label)}
            </button>
          ))}
        </span>
        <span className="flex-1" />
        <button
          onClick={onPing}
          disabled={!connected}
          title={t("Enviar un ping (el servidor responde con pong)")}
          className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40 disabled:opacity-40 disabled:hover:text-silver disabled:hover:ring-fg/15"
        >
          <Radio size={13} /> Ping
        </button>
        <button
          onClick={onSend}
          disabled={!connected || !cfg.draft || !!problem}
          title={connected ? t("Enviar mensaje (Ctrl/Cmd+Enter)") : t("Conecta primero para poder enviar")}
          className="btn-aurora flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          <Send size={13} /> {t("Enviar")}
        </button>
      </div>
      <div className="min-h-32 flex-1">
        {cfg.draftFormat === "json" ? (
          <JsonEditor value={cfg.draft} onChange={(draft) => onCfg({ draft })} placeholder='{"type": "ping"}' className="h-full min-h-32" />
        ) : (
          <textarea
            value={cfg.draft}
            onChange={(e) => onCfg({ draft: e.target.value })}
            spellCheck={false}
            aria-label={t("Contenido del mensaje")}
            placeholder={cfg.draftFormat === "text" ? t("Escribe el mensaje a enviar") : fmt.id === "hex" ? "48 65 6c 6c 6f" : "SGVsbG8="}
            className="h-full min-h-32 w-full resize-none rounded-md border border-fg/10 bg-kelp p-3 font-mono text-sm outline-none focus:border-aqua"
          />
        )}
      </div>
      {(problem || error) && (
        <p role="alert" className="text-xs text-rose">
          {problem ?? error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && cfg.draft && save()}
          placeholder={t("Nombre para guardar este mensaje")}
          aria-label={t("Nombre para guardar este mensaje")}
          className="w-64 max-w-full rounded-md border border-fg/10 bg-kelp px-2 py-1 text-sm outline-none focus:border-aqua"
        />
        <button
          onClick={save}
          disabled={!cfg.draft}
          title={t("Guardar el mensaje en esta petición")}
          className="flex items-center gap-1.5 text-xs text-silver hover:text-aqua disabled:opacity-40"
        >
          <BookmarkPlus size={14} /> {t("Guardar mensaje")}
        </button>
      </div>
      {cfg.saved.length > 0 && (
        <ul aria-label={t("Mensajes guardados")} className="flex max-h-28 flex-col gap-1 overflow-y-auto">
          {cfg.saved.map((m) => (
            <li key={m.id} className="group flex items-center gap-2 rounded-md bg-fg/5 px-2 py-1 text-xs">
              <button
                onClick={() => onCfg({ draft: m.data, draftFormat: m.format })}
                title={t("Cargar en el compositor")}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-aqua"
              >
                <span className="shrink-0 rounded bg-kelp px-1.5 text-[10px] uppercase text-slate">{m.format}</span>
                <span className="shrink-0 font-semibold text-mist">{m.name}</span>
                <span className="truncate font-mono text-slate">{m.data.replace(/\s+/g, " ").slice(0, 80)}</span>
              </button>
              <button
                onClick={() => onCfg({ saved: cfg.saved.filter((x) => x.id !== m.id) })}
                title={t("Quitar mensaje guardado")}
                aria-label={t("Quitar mensaje guardado")}
                className="shrink-0 text-slate hover:text-rose"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
