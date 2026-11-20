import { useState } from "react";
import { Check, Eye, Layers, Plug, PlugZap, Save } from "lucide-react";
import KVEditor from "./KVEditor";
import AuthEditor from "./AuthEditor";
import VarInput from "./VarInput";
import WsComposer from "./WsComposer";
import KindSelect from "./KindSelect";
import type { AuthData, KV, ProfilesState, RequestKind, RequestState, WsConfig } from "../types";
import { applyUrlEdit, buildUrl } from "../lib/url";
import { normWsConfig, parseSubprotocols } from "../lib/ws";
import { disconnectWs, pingWs, useWsSession, type WsStatus } from "../lib/wsStore";
import { sendDraft, startWs, wsAuthUnsupported } from "../lib/wsRequest";
import { t } from "../lib/i18n";

interface Props {
  /** Id de la pestaña (identifica la conexión). */
  id: string;
  req: RequestState;
  patch: (p: Partial<RequestState>) => void;
  onKind?: (k: RequestKind) => void;
  /** Autorización efectiva (resuelta con «Inherit») y variables efectivas. */
  auth: AuthData;
  vars: KV[];
  profiles: ProfilesState;
  onProfile: (id: string | null) => void;
  onManageProfiles: () => void;
  onShowResolved?: () => void;
  onSave: () => void;
  saved?: boolean;
  onError: (msg: string) => void;
}

type Sub = "message" | "params" | "auth" | "headers" | "settings";

const COMMON_HEADERS = ["Authorization", "Origin", "Cookie", "User-Agent", "X-API-Key", "Accept-Language"];
const box = "w-24 rounded-md border border-fg/10 bg-kelp px-2 py-1.5 text-sm focus:outline-none focus:border-aqua";
const ghost =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40";
const done =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-leaf ring-1 ring-leaf/70 bg-leaf/10";

export const STATUS_STYLE: Record<WsStatus, { dot: string; text: string }> = {
  disconnected: { dot: "bg-rose", text: "Desconectado" },
  connecting: { dot: "bg-lav animate-pulse", text: "Conectando…" },
  connected: { dot: "bg-leaf", text: "Conectado" },
};

export function WsStatusBadge({ status, retry }: { status: WsStatus; retry?: { n: number; of: number } | null }) {
  const s = STATUS_STYLE[status];
  return (
    <span role="status" aria-live="polite" className="flex shrink-0 items-center gap-2 text-xs text-silver">
      <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
      {t(s.text)}
      {retry && status === "disconnected" && <span className="text-lav">{t("Reintentando ({0}/{1})…", retry.n, retry.of)}</span>}
    </span>
  );
}

/** Barra superior + pestañas de configuración de una petición WebSocket. Los mensajes van en WsMessages. */
export default function WebSocketPanel({ id, req, patch, onKind, auth, vars, profiles, onProfile, onManageProfiles, onShowResolved, onSave, saved, onError }: Props) {
  const session = useWsSession(id);
  const cfg = normWsConfig(req.ws);
  const setCfg = (p: Partial<WsConfig>) => patch({ ws: { ...cfg, ...p } });
  const [sub, setSub] = useState<Sub>("message");
  const [sendErr, setSendErr] = useState<string | null>(null);
  const fullUrl = buildUrl(req.url, req.params);
  const busy = session.status !== "disconnected";

  const connect = () => {
    const err = startWs(id, req, auth, vars);
    if (err) onError(err);
  };
  const toggle = () => (busy ? disconnectWs(id) : connect());
  const send = () => {
    setSendErr(null);
    sendDraft(id, req).catch((e) => setSendErr(t(String((e as Error)?.message ?? e))));
  };
  const ping = () => pingWs(id).catch((e) => setSendErr(String((e as Error)?.message ?? e)));

  const count = (l: { enabled: boolean; key: string }[]) => l.filter((x) => x.enabled && x.key).length;
  const tabs: { id: Sub; label: string; badge?: string }[] = [
    { id: "message", label: "Mensaje", badge: cfg.saved.length ? String(cfg.saved.length) : undefined },
    { id: "params", label: "Params", badge: count(req.params) ? String(count(req.params)) : undefined },
    { id: "auth", label: "Authorization", badge: req.auth.type !== "none" ? "•" : undefined },
    { id: "headers", label: "Headers", badge: count(req.headers) ? String(count(req.headers)) : undefined },
    { id: "settings", label: "Settings" },
  ];
  const sp = parseSubprotocols(cfg.subprotocols);

  return (
    <>
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
          {onShowResolved && (
            <button onClick={onShowResolved} className="text-slate hover:text-aqua" title={t("Ver variables resueltas (globales + colección + perfil)")} aria-label={t("Ver variables resueltas (globales + colección + perfil)")}>
              <Eye size={15} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onKind ? (
            <KindSelect kind="ws" onChange={onKind} />
          ) : (
            <span
              title={t("Tipo de petición")}
              className="flex items-center rounded-[10px] bg-kelp px-4 py-2 text-sm font-semibold text-[#5ab0ff] ring-1 ring-fg/10"
            >
              WebSocket
            </span>
          )}
          <VarInput
            id="caesar-url"
            value={fullUrl}
            onChange={(e) => patch(applyUrlEdit(e.target.value, req.params))}
            onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && !busy && connect()}
            placeholder="wss://echo.websocket.org  ·  ws://localhost:8080/ws"
            aria-label={t("URL del WebSocket")}
            spellCheck={false}
            className="min-w-[12rem] flex-1 rounded-[10px] bg-kelp px-5 py-2 text-sm outline-none ring-1 ring-fg/10 focus:ring-aqua"
          />
          <button
            onClick={toggle}
            aria-pressed={busy}
            title={busy ? t("Cerrar la conexión") : t("Abrir la conexión WebSocket")}
            className={`flex min-w-[8.5rem] items-center justify-center gap-2 rounded-[10px] px-4 py-2 text-xs font-semibold uppercase tracking-[0.025em] ${
              busy ? "bg-rose/15 text-rose ring-1 ring-rose/60 hover:bg-rose/25" : "btn-aurora"
            }`}
          >
            {busy ? <PlugZap size={14} /> : <Plug size={14} />}
            {session.status === "connecting" ? t("Cancelar") : busy ? t("Desconectar") : t("Conectar")}
          </button>
          <button onClick={onSave} className={saved ? done : ghost} title={t("Guardar en la colección (Ctrl+S)")}>
            {saved ? <Check size={14} /> : <Save size={14} />} {saved ? t("Guardado") : t("Guardar")}
          </button>
        </div>
        <WsStatusBadge status={session.status} retry={session.retry} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div role="tablist" className="flex overflow-x-auto border-b border-fg/10 px-3">
          {tabs.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={sub === x.id}
              onClick={() => setSub(x.id)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                sub === x.id ? "border-aqua text-mist" : "border-transparent text-slate hover:text-silver"
              }`}
            >
              {x.id === "message" ? t(x.label) : x.label}
              {x.badge && <span className="text-xs font-bold text-aqua">{x.badge}</span>}
            </button>
          ))}
        </div>
        <div className="min-h-[12rem] flex-1 overflow-y-auto p-3">
          {sub === "message" && <WsComposer cfg={cfg} onCfg={setCfg} connected={session.status === "connected"} onSend={send} onPing={ping} error={sendErr} />}
          {sub === "params" && <KVEditor rows={req.params} onChange={(params) => patch({ params })} keyPlaceholder="Query param" />}
          {sub === "auth" && (
            <div className="space-y-3">
              <AuthEditor auth={req.auth} onChange={(a) => patch({ auth: a })} inherited={auth} />
              {wsAuthUnsupported(auth) && <p className="text-xs text-lav">{t("Este tipo de autorización firma peticiones HTTP concretas y no se aplica al handshake WebSocket. Usa Bearer, Basic, API Key o un header.")}</p>}
            </div>
          )}
          {sub === "headers" && (
            <div className="space-y-2">
              <p className="text-xs text-slate">{t("Se envían en el handshake (petición de actualización a WebSocket).")}</p>
              <KVEditor rows={req.headers} onChange={(headers) => patch({ headers })} suggestions={COMMON_HEADERS} />
            </div>
          )}
          {sub === "settings" && (
            <div className="space-y-3 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                {t("Subprotocolos (Sec-WebSocket-Protocol, separados por comas)")}
                <input
                  value={cfg.subprotocols}
                  onChange={(e) => setCfg({ subprotocols: e.target.value })}
                  placeholder="graphql-ws, mqtt"
                  spellCheck={false}
                  className={box.replace("w-24", "w-64")}
                />
              </label>
              {sp.invalid.length > 0 && <p role="alert" className="text-xs text-rose">{t("Subprotocolo no válido: {0}", sp.invalid.join(", "))}</p>}
              <label className="flex flex-wrap items-center gap-2">
                {t("Timeout del handshake (segundos)")}
                <input type="number" min={1} max={120} className={box} value={cfg.handshakeTimeoutSecs} onChange={(e) => setCfg({ handshakeTimeoutSecs: Number(e.target.value) })} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[var(--t-accent)]" checked={cfg.verifySsl} onChange={(e) => setCfg({ verifySsl: e.target.checked })} />
                {t("Verificar certificado SSL")}
                {!cfg.verifySsl && <span className="text-xs text-lav">{t("⚠ desactivado: solo para pruebas")}</span>}
              </label>
              <label className="flex flex-wrap items-center gap-2">
                {t("Ping automático cada (segundos, 0 = desactivado)")}
                <input type="number" min={0} max={3600} className={box} value={cfg.pingIntervalSecs} onChange={(e) => setCfg({ pingIntervalSecs: Number(e.target.value) })} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[var(--t-accent)]" checked={cfg.autoReconnect} onChange={(e) => setCfg({ autoReconnect: e.target.checked })} />
                {t("Reconectar automáticamente si se pierde la conexión")}
              </label>
              {cfg.autoReconnect && (
                <div className="ml-6 flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2">
                    {t("Intentos")}
                    <input type="number" min={1} max={20} className={box} value={cfg.reconnectAttempts} onChange={(e) => setCfg({ reconnectAttempts: Number(e.target.value) })} />
                  </label>
                  <label className="flex items-center gap-2">
                    {t("Espera entre intentos (s)")}
                    <input type="number" min={1} max={300} className={box} value={cfg.reconnectDelaySecs} onChange={(e) => setCfg({ reconnectDelaySecs: Number(e.target.value) })} />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
