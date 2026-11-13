import type { GqlSchema } from "./graphqlSchema";

/** Caché del esquema por URL: memoria + localStorage (con try/catch: puede estar lleno o bloqueado). */
export interface CachedSchema {
  schema: GqlSchema;
  /** ms desde epoch */
  at: number;
}

const PREFIX = "caesar.gqlSchema:";
const mem = new Map<string, CachedSchema>();

export function loadCachedSchema(url: string): CachedSchema | null {
  if (!url) return null;
  const hit = mem.get(url);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(PREFIX + url);
    if (raw) {
      const v = JSON.parse(raw) as CachedSchema;
      if (v && v.schema && typeof v.at === "number") {
        mem.set(url, v);
        return v;
      }
    }
  } catch {
    /* sin almacenamiento o dato corrupto */
  }
  return null;
}

export function saveCachedSchema(url: string, schema: GqlSchema): CachedSchema {
  const v = { schema, at: Date.now() };
  mem.set(url, v);
  try {
    localStorage.setItem(PREFIX + url, JSON.stringify(v));
  } catch {
    /* cuota llena: queda solo en memoria */
  }
  return v;
}

export function clearCachedSchema(url: string) {
  mem.delete(url);
  try {
    localStorage.removeItem(PREFIX + url);
  } catch {
    /* nada */
  }
}
