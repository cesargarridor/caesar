// Lógica pura de WebSockets (sin React ni Tauri, para poder probarla con node --test).
import type { WsConfig, WsMsgFormat } from "../types.ts";

export type WsDir = "sent" | "received" | "event";
export type WsMsgType = "text" | "binary" | "ping" | "pong" | "open" | "close" | "error";

export interface WsMsg {
  id: number;
  ts: number;
  dir: WsDir;
  type: WsMsgType;
  /** Texto, o bytes en base64 si type es binary/ping/pong. En eventos, la descripción. */
  data: string;
  size: number;
  /** El contenido se recortó para no gastar memoria. */
  truncated?: boolean;
}

export const MAX_MESSAGES = 5000;
/** Contenido máximo que se guarda por mensaje en memoria (el tamaño real se conserva en `size`). */
export const MAX_STORED_CHARS = 1_000_000;

export const defaultWsConfig = (): WsConfig => ({
  subprotocols: "",
  handshakeTimeoutSecs: 30,
  verifySsl: true,
  autoReconnect: false,
  reconnectAttempts: 3,
  reconnectDelaySecs: 2,
  pingIntervalSecs: 0,
  draftFormat: "text",
  draft: "",
  saved: [],
});

/** Config válida a partir de datos guardados (campos ausentes o raros = valores por defecto). */
export function normWsConfig(c: Partial<WsConfig> | undefined | null): WsConfig {
  const d = defaultWsConfig();
  if (!c || typeof c !== "object") return d;
  const num = (v: unknown, def: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
  const fmts: WsMsgFormat[] = ["text", "json", "hex", "base64"];
  return {
    subprotocols: typeof c.subprotocols === "string" ? c.subprotocols : d.subprotocols,
    handshakeTimeoutSecs: num(c.handshakeTimeoutSecs, d.handshakeTimeoutSecs, 1, 120),
    verifySsl: c.verifySsl !== false,
    autoReconnect: c.autoReconnect === true,
    reconnectAttempts: num(c.reconnectAttempts, d.reconnectAttempts, 1, 20),
    reconnectDelaySecs: num(c.reconnectDelaySecs, d.reconnectDelaySecs, 1, 300),
    pingIntervalSecs: num(c.pingIntervalSecs, 0, 0, 3600),
    draftFormat: fmts.includes(c.draftFormat as WsMsgFormat) ? (c.draftFormat as WsMsgFormat) : "text",
    draft: typeof c.draft === "string" ? c.draft : "",
    saved: Array.isArray(c.saved)
      ? c.saved
          .filter((m) => m && typeof m.name === "string" && typeof m.data === "string")
          .map((m, i) => ({
            id: typeof m.id === "string" && m.id ? m.id : `m${i}`,
            name: m.name,
            format: fmts.includes(m.format) ? m.format : "text",
            data: m.data,
          }))
      : [],
  };
}

/** Normaliza la URL: http(s) -> ws(s), sin esquema -> ws://. Las {{variables}} se respetan. */
export function normalizeWsUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return "wss://" + s.slice(8);
  if (/^http:\/\//i.test(s)) return "ws://" + s.slice(7);
  if (/^wss?:\/\//i.test(s)) return s.replace(/^wss?:/i, (m) => m.toLowerCase());
  if (/^\{\{[^}]*\}\}/.test(s) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return "ws://" + s;
  return s;
}

export const isWsUrl = (s: string) => /^wss?:\/\/\S/i.test(s.trim());

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Subprotocolos separados por comas -> lista válida (sin vacíos ni repetidos). */
export function parseSubprotocols(s: string): { list: string[]; invalid: string[] } {
  const list: string[] = [];
  const invalid: string[] = [];
  for (const p of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!TOKEN.test(p)) invalid.push(p);
    else if (!list.includes(p)) list.push(p);
  }
  return { list, invalid };
}

// ───── bytes ↔ texto / hex / base64 ─────
export const textToBytes = (s: string) => new TextEncoder().encode(s);
export const bytesToText = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(b);

export function bytesToBase64(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

/** "48 65 6c", "0x48,0x65", "4865" -> bytes. Lanza Error si no es hex válido. */
export function hexToBytes(s: string): Uint8Array {
  const clean = s.replace(/0x/gi, "").replace(/[\s,:-]+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error("Hex inválido");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Volcado clásico: offset, 16 bytes en hex y columna ASCII. */
export function hexDump(b: Uint8Array, perLine = 16): string {
  const lines: string[] = [];
  for (let o = 0; o < b.length; o += perLine) {
    const chunk = b.subarray(o, o + perLine);
    const hex = Array.from(chunk, (x) => x.toString(16).padStart(2, "0")).join(" ").padEnd(perLine * 3 - 1, " ");
    const ascii = Array.from(chunk, (x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");
    lines.push(`${o.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`);
  }
  return lines.join("\n");
}

/** Lo que se envía por el cable: kind de ws_send y datos (texto o base64). Lanza Error si el contenido no es válido. */
export function encodeOutgoing(format: WsMsgFormat, data: string): { kind: "text" | "binary"; data: string; size: number } {
  if (format === "text") return { kind: "text", data, size: textToBytes(data).length };
  if (format === "json") {
    try {
      JSON.parse(data);
    } catch {
      throw new Error("JSON inválido");
    }
    return { kind: "text", data, size: textToBytes(data).length };
  }
  if (format === "hex") {
    const b = hexToBytes(data);
    return { kind: "binary", data: bytesToBase64(b), size: b.length };
  }
  let b: Uint8Array;
  try {
    b = base64ToBytes(data);
  } catch {
    throw new Error("Base64 inválido");
  }
  return { kind: "binary", data: bytesToBase64(b), size: b.length };
}

// ───── mensajes ─────
/** Añade un mensaje respetando el límite (descarta los más viejos). Devuelve una lista nueva. */
export function pushMsg(list: WsMsg[], m: WsMsg, limit = MAX_MESSAGES): WsMsg[] {
  const next = list.length >= limit ? list.slice(list.length - limit + 1) : list.slice();
  next.push(m);
  return next;
}

export const isBinaryType = (t: WsMsgType) => t === "binary" || t === "ping" || t === "pong";

/** Bytes de un mensaje binario (base64 en `data`). */
export const msgBytes = (m: WsMsg): Uint8Array => {
  try {
    return base64ToBytes(m.data);
  } catch {
    return new Uint8Array();
  }
};

/** Texto en el que se busca: el contenido (binario como hex + ASCII) o la descripción del evento. */
export function msgSearchText(m: WsMsg): string {
  if (!isBinaryType(m.type)) return m.data;
  const b = msgBytes(m);
  return bytesToHex(b) + " " + bytesToText(b);
}

export type WsFilter = "all" | "sent" | "received";

/** Filtro Todos/Enviados/Recibidos + búsqueda (sin distinguir mayúsculas). Los eventos de conexión solo se ocultan al buscar. */
export function filterMsgs(list: WsMsg[], filter: WsFilter, query: string): WsMsg[] {
  const q = query.trim().toLowerCase();
  return list.filter((m) => {
    if (filter === "sent" && m.dir !== "sent") return false;
    if (filter === "received" && m.dir !== "received") return false;
    if (m.dir === "event") return filter === "all" && (!q || m.data.toLowerCase().includes(q));
    return !q || msgSearchText(m).toLowerCase().includes(q);
  });
}

export const prettyJson = (s: string): string | null => {
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
};

const p2 = (n: number) => String(n).padStart(2, "0");
/** HH:MM:SS.mmm (hora local). */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Códigos de cierre más habituales (RFC 6455). */
export function closeCodeName(code: number): string {
  const m: Record<number, string> = {
    1000: "Normal", 1001: "Going away", 1002: "Protocol error", 1003: "Unsupported data", 1005: "No status",
    1006: "Abnormal closure", 1007: "Invalid payload", 1008: "Policy violation", 1009: "Message too big",
    1010: "Mandatory extension", 1011: "Internal error", 1012: "Service restart", 1013: "Try again later",
  };
  return m[code] ?? "";
}
