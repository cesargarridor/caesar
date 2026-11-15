import type { BodyData, KV, RequestState } from "../types";
import { applyUrlEdit, buildUrl } from "./url.ts";
import { emptyRequest } from "./curl.ts";

/**
 * Enlaces mágicos `caesar://share?payload=…`: la petición (método, URL, cabeceras y cuerpo) viaja DENTRO del propio enlace,
 * comprimida y en base64url. No hay nube ni servidor. Para compartirla basta pegar el enlace en Slack; quien lo recibe lo pega en
 * Caesar (Ctrl/Cmd+V) o lo abre con un clic. La autorización de la petición NO se incluye y los valores de cabeceras sensibles se vacían.
 */
export const SHARE_PREFIX = "caesar://share?payload=";
const MAX_JSON = 256 * 1024;
const SENSITIVE = /authorization|cookie|token|api[-_]?key|secret|password|signature/i;
const MODES = ["none", "json", "text", "formdata", "urlencoded", "graphql"] as const;

interface Payload {
  v: 1;
  m: string;
  u: string;
  h: [string, string][];
  b: { mode: string; raw?: string; urlencoded?: [string, string][]; formdata?: [string, string][]; q?: string; qv?: string; op?: string };
}

export const looksLikeShareLink = (s: string) => s.trim().startsWith(SHARE_PREFIX);

const toB64Url = (b: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(data as BufferSource).then(() => w.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      void reader.cancel().catch(() => {});
      throw new Error("El enlace es demasiado grande.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const hasCompression = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
const pairs = (list: KV[]): [string, string][] => list.filter((k) => k.enabled && k.key && k.kind !== "file").map((k) => [k.key, k.value]);

/** Genera el enlace. `hidden` = cuántas cabeceras sensibles se han vaciado para no compartir secretos. */
export async function makeShareLink(req: RequestState): Promise<{ link: string; hidden: number }> {
  let hidden = 0;
  const h = req.headers.filter((k) => k.enabled && k.key).map<[string, string]>((k) => {
    if (SENSITIVE.test(k.key) && k.value) { hidden++; return [k.key, ""]; }
    return [k.key, k.value];
  });
  const b = req.body;
  const p: Payload = {
    v: 1,
    m: req.method,
    u: buildUrl(req.url, req.params),
    h,
    b: { mode: b.mode, raw: b.raw || undefined, urlencoded: pairs(b.urlencoded), formdata: pairs(b.formdata), q: b.gqlQuery || undefined, qv: b.gqlVars || undefined, op: b.gqlOp || undefined },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let payload = toB64Url(bytes);
  if (hasCompression()) {
    try {
      const z = toB64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
      if (z.length + 2 < payload.length) payload = `z.${z}`;
    } catch { /* se queda sin comprimir */ }
  }
  return { link: SHARE_PREFIX + payload, hidden };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const kvs = (v: unknown): KV[] =>
  Array.isArray(v) ? v.slice(0, 200).filter((x) => Array.isArray(x) && typeof x[0] === "string").map((x) => ({ key: str(x[0], 500), value: str(x[1], 20000), enabled: true })) : [];

/** Desempaqueta y VALIDA un enlace (no se fía de nada de lo que trae). Lanza con un mensaje claro si no es válido. */
export async function parseShareLink(text: string): Promise<RequestState> {
  const t = text.trim();
  if (!looksLikeShareLink(t)) throw new Error("No es un enlace de Caesar.");
  let raw = t.slice(SHARE_PREFIX.length).split(/[&#\s]/)[0];
  if (!raw) throw new Error("El enlace está vacío.");
  let bytes: Uint8Array;
  try {
    if (raw.startsWith("z.")) {
      if (!hasCompression()) throw new Error("Este sistema no puede abrir enlaces comprimidos.");
      bytes = await pipe(fromB64Url(raw.slice(2)), new DecompressionStream("deflate-raw"), MAX_JSON);
    } else {
      bytes = fromB64Url(raw);
    }
  } catch (e) {
    throw e instanceof Error && /grande|sistema/.test(e.message) ? e : new Error("El enlace está dañado o incompleto. Pídelo de nuevo.");
  }
  if (bytes.length > MAX_JSON) throw new Error("El enlace es demasiado grande.");
  let p: Partial<Payload>;
  try {
    p = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("El enlace está dañado o incompleto. Pídelo de nuevo.");
  }
  if (!p || p.v !== 1 || typeof p.u !== "string") throw new Error("El enlace es de una versión que esta Caesar no entiende. Actualiza la app.");
  const base = emptyRequest();
  const method = /^[A-Za-z]{1,20}$/.test(p.m ?? "") ? (p.m as string).toUpperCase() : "GET";
  const mode = (MODES as readonly string[]).includes(p.b?.mode ?? "") ? (p.b!.mode as BodyData["mode"]) : "none";
  const b = p.b ?? { mode };
  return {
    ...base,
    method,
    ...applyUrlEdit(str(p.u, 8000), []),
    headers: kvs(p.h),
    body: { ...base.body, mode, raw: str(b.raw, MAX_JSON), urlencoded: kvs(b.urlencoded), formdata: kvs(b.formdata), gqlQuery: str(b.q, MAX_JSON), gqlVars: str(b.qv, MAX_JSON), gqlOp: str(b.op, 200) },
  };
}
