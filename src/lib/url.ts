import type { KV } from "../types";

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Codifica para query conservando {{vars}} y caracteres legibles. */
export const encodeParam = (s: string) =>
  encodeURIComponent(s)
    .replace(/%7B/gi, "{")
    .replace(/%7D/gi, "}")
    .replace(/%2C/gi, ",")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%40/gi, "@")
    .replace(/%2B/gi, "+");

export function splitUrl(full: string): { base: string; query: string | null } {
  const i = full.indexOf("?");
  return i < 0 ? { base: full, query: null } : { base: full.slice(0, i), query: full.slice(i + 1) };
}

export function parseQuery(q: string): KV[] {
  return q.split("&").map((pair) => {
    const i = pair.indexOf("=");
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? "" : pair.slice(i + 1);
    return { key: safeDecode(k), value: safeDecode(v), enabled: true };
  });
}

/** URL completa mostrada en la barra = base + params activos. */
export function buildUrl(base: string, params: KV[]): string {
  const active = params.filter((p) => p.enabled);
  if (active.length === 0) return base;
  const pairs = active.map((p) =>
    p.key === "" && p.value === "" ? "" : `${encodeParam(p.key)}=${encodeParam(p.value)}`,
  );
  return `${base}?${pairs.join("&")}`;
}

/** Nuevo (base, params) cuando el usuario edita la URL completa. Conserva los params desactivados. */
export function applyUrlEdit(full: string, oldParams: KV[]): { url: string; params: KV[] } {
  const { base, query } = splitUrl(full);
  const disabled = oldParams.filter((p) => !p.enabled);
  const enabled = query === null ? [] : parseQuery(query);
  return { url: base, params: [...enabled, ...disabled] };
}
