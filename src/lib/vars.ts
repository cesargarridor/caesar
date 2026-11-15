// Lógica pura (sin React ni Tauri) de variables: entornos/globales de Postman, perfiles, fusión y resumen de importación.
import type { KV, VarProfile } from "../types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Migración transparente: acepta cualquier cosa y devuelve variables válidas; `secret` solo si es true (lo guardado antes no cambia). */
export function normVars(raw: unknown): KV[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Obj => isObj(r))
    .map((r) => {
      const out: KV = { key: str(r.key), value: str(r.value), enabled: r.enabled !== false };
      if (r.secret === true) out.secret = true;
      return out;
    });
}

export type PostmanEnv =
  | { kind: "environment"; name: string; vars: KV[] }
  | { kind: "globals"; vars: KV[] };

function envValues(doc: Obj): KV[] {
  const list = Array.isArray(doc.values) ? doc.values.filter(isObj) : [];
  const out: KV[] = [];
  for (const v of list) {
    const key = str(v.key);
    if (!key) continue;
    const value = [v.value, v.currentValue, v.initialValue].map(str).find((s) => s !== "") ?? "";
    const kv: KV = { key, value, enabled: v.enabled !== false && v.disabled !== true };
    if (v.type === "secret") kv.secret = true;
    out.push(kv);
  }
  return out;
}

/** Reconoce un entorno o unas globales de Postman ({name, values[]}). null = no lo es. */
export function parsePostmanEnv(doc: unknown): PostmanEnv | null {
  if (!isObj(doc) || !Array.isArray(doc.values)) return null;
  const scope = str(doc._postman_variable_scope);
  const name = str(doc.name).trim();
  if (!name && !scope) return null;
  const vars = envValues(doc);
  if (scope === "globals" || (scope === "" && name.toLowerCase() === "globals")) return { kind: "globals", vars };
  return { kind: "environment", name: name || "Environment", vars };
}

/** Fusiona globales importadas: si la clave existe se actualiza su valor (y secret/enabled); no se borra nada. */
export function mergeGlobals(existing: KV[], incoming: KV[]): { vars: KV[]; added: number; updated: number } {
  let added = 0;
  let updated = 0;
  const vars = existing.map((v) => ({ ...v }));
  for (const inc of incoming) {
    if (!inc.key) continue;
    const i = vars.findIndex((v) => v.key === inc.key);
    if (i >= 0) {
      const { secret: _s, ...rest } = vars[i];
      vars[i] = { ...rest, value: inc.value, enabled: inc.enabled, ...(inc.secret ? { secret: true } : {}) };
      updated++;
    } else {
      vars.push({ ...inc });
      added++;
    }
  }
  return { vars, added, updated };
}

/** Nombre libre: «X», «X (2)», «X (3)»… (sin distinguir mayúsculas). */
export function uniqueProfileName(name: string, taken: string[]): string {
  const base = name.trim() || "Perfil";
  const set = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const c = `${base} (${n})`;
    if (!set.has(c.toLowerCase())) return c;
  }
}

/** Perfil nuevo a partir de un entorno de Postman. Nunca queda activo. */
export function profileFromEnv(env: { name: string; vars: KV[] }, existing: VarProfile[], id: string): VarProfile {
  return { id, name: uniqueProfileName(env.name, existing.map((p) => p.name)), vars: env.vars.map((v) => ({ ...v })) };
}

/** Variables `variable` de carpetas y peticiones de una colección v2.1 (la de la raíz ya la procesa Rust). */
export function collectNestedVars(doc: unknown): KV[] {
  const out: KV[] = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!isObj(it)) continue;
      if (Array.isArray(it.variable)) {
        for (const v of it.variable) {
          if (!isObj(v)) continue;
          const key = str(v.key ?? v.id);
          if (key) out.push({ key, value: str(v.value), enabled: v.disabled !== true });
        }
      }
      walk(it.item);
    }
  };
  if (isObj(doc)) walk(doc.item);
  return out;
}

/** Añade las variables anidadas a las de la colección sin pisar claves ya definidas (la primera aparición gana). */
export function foldNestedVars(rootVars: KV[], nested: KV[]): KV[] {
  const have = new Set(rootVars.map((v) => v.key));
  const out = [...rootVars];
  for (const v of nested) {
    if (have.has(v.key)) continue;
    have.add(v.key);
    out.push(v);
  }
  return out;
}

export interface ImportCounts {
  collections: number;
  profiles: number;
  /** Variables globales añadidas o actualizadas. */
  globals: number;
}

/** «Importado: 1 colección, 2 perfiles, 5 variables globales». `tr` traduce (por defecto, español tal cual). */
export function importSummary(c: ImportCounts, tr: (s: string) => string = (s) => s): string {
  const parts: string[] = [];
  if (c.collections) parts.push(`${c.collections} ${tr(c.collections === 1 ? "colección" : "colecciones")}`);
  if (c.profiles) parts.push(`${c.profiles} ${tr(c.profiles === 1 ? "perfil" : "perfiles")}`);
  if (c.globals) parts.push(`${c.globals} ${tr(c.globals === 1 ? "variable global" : "variables globales")}`);
  return parts.length ? `${tr("Importado")}: ${parts.join(", ")}` : tr("No se importó nada");
}

/** Filtra filas por texto (clave o valor no secreto); devuelve los índices originales. */
export function filterVarIdx(rows: KV[], q: string): number[] {
  const s = q.trim().toLowerCase();
  const all = rows.map((_, i) => i);
  if (!s) return all;
  return all.filter((i) => rows[i].key.toLowerCase().includes(s) || (!rows[i].secret && rows[i].value.toLowerCase().includes(s)));
}

export type VarScope = "global" | "collection" | "profile";
export interface ResolvedVar { key: string; value: string; secret: boolean; scope: VarScope; /** Ámbitos que define esta clave y quedan pisados. */ shadowed: VarScope[] }

/** Variables efectivas (precedencia: perfil > colección > globales) con su ámbito de origen. Solo las activadas. */
export function resolveVars(globals: KV[], coll: KV[], prof: KV[]): ResolvedVar[] {
  const order: [VarScope, KV[]][] = [["global", globals], ["collection", coll], ["profile", prof]];
  const map = new Map<string, ResolvedVar>();
  for (const [scope, list] of order) {
    for (const v of list) {
      if (!v.key || !v.enabled) continue;
      const prev = map.get(v.key);
      map.set(v.key, { key: v.key, value: v.value, secret: !!v.secret, scope, shadowed: prev ? [...prev.shadowed, prev.scope] : [] });
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
