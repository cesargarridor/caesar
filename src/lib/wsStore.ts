// Sesiones WebSocket en memoria, una por pestaña. No se persisten (los mensajes no se guardan en disco).
import { useSyncExternalStore } from "react";
import type { WsConfig, WsMsgFormat } from "../types";
import { MAX_STORED_CHARS, encodeOutgoing, parseSubprotocols, pushMsg, type WsMsg, type WsMsgType } from "./ws";
import { onWsEvent, wsClose, wsConnect, wsSend, type WsEvent, type WsOpened } from "./wsApi";

export type WsStatus = "disconnected" | "connecting" | "connected";

export interface WsSession {
  status: WsStatus;
  msgs: WsMsg[];
  handshake: (WsOpened & { url: string }) | null;
  /** Reintento automático en curso: intento actual y total. */
  retry: { n: number; of: number } | null;
}

const EMPTY: WsSession = { status: "disconnected", msgs: [], handshake: null, retry: null };

interface Internal {
  s: WsSession;
  seq: number;
  args: { url: string; headers: [string, string][]; cfg: WsConfig } | null;
  /** El usuario pidió cerrar: no se reintenta. */
  manual: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  retries: number;
  /** Número de intento de conexión: descarta resultados de intentos cancelados. */
  gen: number;
}

const sessions = new Map<string, Internal>();
const subs = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | null = null;
const notify = () => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    subs.forEach((f) => f());
  }, 40);
};

const get = (id: string): Internal => {
  let x = sessions.get(id);
  if (!x) sessions.set(id, (x = { s: EMPTY, seq: 0, args: null, manual: false, timer: null, retries: 0, gen: 0 }));
  return x;
};
const set = (id: string, p: Partial<WsSession>) => {
  const x = get(id);
  x.s = { ...x.s, ...p };
  notify();
};

function addMsg(id: string, dir: WsMsg["dir"], type: WsMsgType, data: string, size: number, at?: number) {
  const x = get(id);
  let d = data;
  let truncated = false;
  if (d.length > MAX_STORED_CHARS) {
    d = d.slice(0, MAX_STORED_CHARS);
    truncated = true;
  }
  const m: WsMsg = { id: ++x.seq, ts: Date.now(), dir, type, data: d, size, ...(truncated ? { truncated } : {}) };
  let msgs: WsMsg[];
  if (at !== undefined && at < x.s.msgs.length) {
    msgs = x.s.msgs.slice();
    msgs.splice(at, 0, m);
  } else msgs = pushMsg(x.s.msgs, m);
  set(id, { msgs });
}

let listening: Promise<unknown> | null = null;
function ensureListener() {
  listening ??= onWsEvent(handleEvent).catch(() => {
    listening = null;
  });
  return listening;
}

function handleEvent(e: WsEvent) {
  const x = sessions.get(e.id);
  if (!x) return;
  if (e.type === "message") addMsg(e.id, "received", e.kind, e.data, e.size);
  else if (e.type === "ping" || e.type === "pong") addMsg(e.id, "received", e.type, e.data, e.size);
  else if (e.type === "error") addMsg(e.id, "event", "error", e.message, 0);
  else if (e.type === "close") {
    addMsg(e.id, "event", "close", JSON.stringify({ code: e.code, reason: e.reason }), 0);
    set(e.id, { status: "disconnected" });
    maybeRetry(e.id);
  }
}

function maybeRetry(id: string) {
  const x = get(id);
  const cfg = x.args?.cfg;
  if (x.manual || !cfg?.autoReconnect || !x.args) return set(id, { retry: null });
  if (x.retries >= cfg.reconnectAttempts) {
    x.retries = 0;
    return set(id, { retry: null });
  }
  x.retries++;
  set(id, { retry: { n: x.retries, of: cfg.reconnectAttempts } });
  x.timer = setTimeout(() => void open(id, true), cfg.reconnectDelaySecs * 1000);
}

async function open(id: string, isRetry: boolean) {
  const x = get(id);
  if (!x.args) return;
  const { url, headers, cfg } = x.args;
  const gen = ++x.gen;
  x.manual = false;
  const startLen = x.s.msgs.length;
  set(id, { status: "connecting", ...(isRetry ? {} : { retry: null }) });
  try {
    await ensureListener();
    const r = await wsConnect({
      id,
      url,
      headers,
      subprotocols: parseSubprotocols(cfg.subprotocols).list,
      settings: { handshakeTimeoutSecs: cfg.handshakeTimeoutSecs, verifySsl: cfg.verifySsl, pingIntervalSecs: cfg.pingIntervalSecs },
    });
    if (x.gen !== gen) {
      void wsClose(id).catch(() => {}); // el usuario canceló mientras se abría
      return;
    }
    x.retries = 0;
    set(id, { status: "connected", handshake: { ...r, url }, retry: null });
    // El «Conectado» va antes de lo que llegó mientras se resolvía el handshake.
    addMsg(id, "event", "open", url, 0, startLen);
  } catch (err) {
    if (x.gen !== gen) return;
    addMsg(id, "event", "error", String((err as Error)?.message ?? err), 0);
    set(id, { status: "disconnected" });
    maybeRetry(id);
  }
}

/** Abre la conexión. `headers` ya llevan variables y auth resueltas. */
export function connectWs(id: string, url: string, headers: [string, string][], cfg: WsConfig) {
  const x = get(id);
  if (x.s.status !== "disconnected") return;
  if (x.timer) clearTimeout(x.timer);
  x.args = { url, headers, cfg };
  x.retries = 0;
  void open(id, false);
}

export function disconnectWs(id: string) {
  const x = get(id);
  x.manual = true;
  x.retries = 0;
  if (x.timer) clearTimeout(x.timer);
  x.timer = null;
  if (x.s.status === "disconnected") return set(id, { retry: null });
  if (x.s.status === "connecting") {
    // Aún sin handshake: se descarta el resultado y se cierra si llega a abrir.
    x.gen++;
    void wsClose(id).catch(() => {});
    set(id, { status: "disconnected", retry: null });
    return;
  }
  set(id, { retry: null });
  void wsClose(id, 1000).catch(() => {});
}

/** Envía un mensaje del compositor. Lanza Error si el contenido no es válido o no hay conexión. */
export async function sendWs(id: string, format: WsMsgFormat, data: string) {
  if (get(id).s.status !== "connected") throw new Error("No hay conexión abierta");
  const o = encodeOutgoing(format, data);
  await wsSend(id, o.kind, o.data);
  addMsg(id, "sent", o.kind, o.data, o.size);
}

export async function pingWs(id: string) {
  if (get(id).s.status !== "connected") throw new Error("No hay conexión abierta");
  await wsSend(id, "ping", "");
  addMsg(id, "sent", "ping", "", 0);
}

export function clearWs(id: string) {
  set(id, { msgs: [] });
}

/** Cierra y olvida la sesión (al cerrar la pestaña). */
export function disposeWs(id: string) {
  const x = sessions.get(id);
  if (!x) return;
  x.manual = true;
  x.gen++;
  if (x.timer) clearTimeout(x.timer);
  if (x.s.status !== "disconnected") void wsClose(id, 1000).catch(() => {});
  sessions.delete(id);
  notify();
}

/** Estado actual sin suscribirse (para atajos de teclado). */
export const wsStatusOf = (id: string): WsStatus => sessions.get(id)?.s.status ?? "disconnected";

export function useWsSession(id: string): WsSession {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => sessions.get(id)?.s ?? EMPTY,
  );
}
