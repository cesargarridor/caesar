/** Modelo del esquema GraphQL (a partir de la introspección), plantilla de variables y snippets. Sin dependencias de React/Tauri. */

export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { ...FullType }
    directives { name description locations args { ...InputValue } }
  }
}
fragment FullType on __Type {
  kind name description
  fields(includeDeprecated: true) { name description args { ...InputValue } type { ...TypeRef } isDeprecated deprecationReason }
  inputFields { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason }
  possibleTypes { ...TypeRef }
}
fragment InputValue on __InputValue { name description type { ...TypeRef } defaultValue }
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }
}`;

export type GqlKind = "SCALAR" | "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT";

export interface GqlArg {
  name: string;
  description: string;
  /** Tipo escrito: "[Int!]!". */
  type: string;
  /** Tipo sin [] ni !. */
  typeName: string;
  defaultValue: string | null;
  required: boolean;
}

export interface GqlField {
  name: string;
  description: string;
  args: GqlArg[];
  type: string;
  typeName: string;
  deprecated: boolean;
}

export interface GqlType {
  name: string;
  kind: GqlKind;
  description: string;
  fields: GqlField[];
  inputFields: GqlArg[];
  enumValues: { name: string; description: string }[];
  possibleTypes: string[];
}

export interface GqlDirective {
  name: string;
  description: string;
  args: GqlArg[];
}

export interface GqlSchema {
  queryType: string | null;
  mutationType: string | null;
  subscriptionType: string | null;
  types: Record<string, GqlType>;
  directives: GqlDirective[];
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function typeRef(r: Raw | null | undefined): { text: string; name: string } {
  if (!r) return { text: "?", name: "" };
  if (r.kind === "NON_NULL") {
    const i = typeRef(r.ofType);
    return { text: i.text + "!", name: i.name };
  }
  if (r.kind === "LIST") {
    const i = typeRef(r.ofType);
    return { text: `[${i.text}]`, name: i.name };
  }
  return { text: r.name ?? "?", name: r.name ?? "" };
}

const arg = (a: Raw): GqlArg => {
  const t = typeRef(a.type);
  return {
    name: a.name,
    description: a.description ?? "",
    type: t.text,
    typeName: t.name,
    defaultValue: a.defaultValue ?? null,
    required: t.text.endsWith("!") && (a.defaultValue ?? null) === null,
  };
};

/** Convierte la respuesta de introspección ({data:{__schema}} o {__schema}) al modelo. Lanza Error con un mensaje claro. */
export function parseIntrospection(input: unknown): GqlSchema {
  let j: Raw | null = null;
  if (typeof input === "string") {
    try {
      j = JSON.parse(input);
    } catch {
      throw new Error("La respuesta no es JSON: ¿la URL es un endpoint GraphQL?");
    }
  } else j = input as Raw | null;
  if (!j || typeof j !== "object") throw new Error("Respuesta vacía.");
  const sch = j.data?.__schema ?? j.__schema;
  if (!sch) {
    const msg = Array.isArray(j.errors) && j.errors[0]?.message ? String(j.errors[0].message) : "";
    throw new Error(msg ? `El servidor no devolvió el esquema: ${msg}` : "El servidor no devolvió el esquema (¿introspección desactivada?).");
  }
  const types: Record<string, GqlType> = {};
  for (const t of (sch.types ?? []) as Raw[]) {
    if (!t?.name) continue;
    types[t.name] = {
      name: t.name,
      kind: t.kind,
      description: t.description ?? "",
      fields: ((t.fields ?? []) as Raw[]).map((f) => {
        const r = typeRef(f.type);
        return { name: f.name, description: f.description ?? "", args: ((f.args ?? []) as Raw[]).map(arg), type: r.text, typeName: r.name, deprecated: !!f.isDeprecated };
      }),
      inputFields: ((t.inputFields ?? []) as Raw[]).map(arg),
      enumValues: ((t.enumValues ?? []) as Raw[]).map((e) => ({ name: e.name, description: e.description ?? "" })),
      possibleTypes: ((t.possibleTypes ?? []) as Raw[]).map((p) => p.name).filter(Boolean),
    };
  }
  return {
    queryType: sch.queryType?.name ?? null,
    mutationType: sch.mutationType?.name ?? null,
    subscriptionType: sch.subscriptionType?.name ?? null,
    types,
    directives: ((sch.directives ?? []) as Raw[]).map((d) => ({ name: d.name, description: d.description ?? "", args: ((d.args ?? []) as Raw[]).map(arg) })),
  };
}

/** Tipos "de usuario": sin los internos (__Schema…) ni los escalares estándar. */
export function userTypes(s: GqlSchema): GqlType[] {
  return Object.values(s.types)
    .filter((t) => !t.name.startsWith("__"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countTypes(s: GqlSchema): number {
  return userTypes(s).length;
}

export type RootKind = "query" | "mutation" | "subscription";
export const rootTypeName = (s: GqlSchema, k: RootKind): string | null => (k === "query" ? s.queryType : k === "mutation" ? s.mutationType : s.subscriptionType);

const isComposite = (t: GqlType | undefined) => !!t && (t.kind === "OBJECT" || t.kind === "INTERFACE" || t.kind === "UNION");

// ───────── plantilla de variables ─────────

const stripType = (t: string) => t.replace(/!/g, "").trim();

function defaultFor(type: string, s: GqlSchema | null, depth: number, seen: string[]): unknown {
  const t = stripType(type);
  if (t.startsWith("[")) return [];
  switch (t) {
    case "Int":
    case "Float":
      return 0;
    case "String":
    case "ID":
      return "";
    case "Boolean":
      return false;
  }
  const def = s?.types[t];
  if (!def) return null;
  if (def.kind === "ENUM") return def.enumValues[0]?.name ?? null;
  if (def.kind === "INPUT_OBJECT") {
    if (depth >= 3 || seen.includes(t)) return {};
    const o: Record<string, unknown> = {};
    for (const f of def.inputFields) o[f.name] = defaultFor(f.type, s, depth + 1, [...seen, t]);
    return o;
  }
  return "";
}

/**
 * JSON de variables a partir de las `$vars` declaradas. Respeta los valores que ya existan en `existing`
 * (si es un objeto JSON válido) y solo añade las que faltan. Devuelve "" si no hay variables.
 */
export function varsTemplate(defs: { name: string; type: string }[], s: GqlSchema | null = null, existing = ""): string {
  if (!defs.length) return existing.trim();
  let base: Record<string, unknown> = {};
  const e = existing.trim();
  if (e) {
    try {
      const p = JSON.parse(e);
      if (p && typeof p === "object" && !Array.isArray(p)) base = p;
    } catch {
      /* inválido: se parte de cero */
    }
  }
  for (const d of defs) if (!(d.name in base)) base[d.name] = defaultFor(d.type, s, 0, []);
  return JSON.stringify(base, null, 2);
}

// ───────── snippets para insertar desde el explorador ─────────

/** Literal de ejemplo para un argumento (se usa al insertar campos anidados). */
export function literalFor(type: string, s: GqlSchema | null): string {
  const t = stripType(type);
  if (t.startsWith("[")) return "[]";
  if (t === "Int" || t === "Float") return "0";
  if (t === "String" || t === "ID") return '""';
  if (t === "Boolean") return "false";
  const def = s?.types[t];
  if (def?.kind === "ENUM") return def.enumValues[0]?.name ?? "null";
  if (def?.kind === "INPUT_OBJECT") return "{}";
  return "null";
}

/** Subselección sugerida para un tipo compuesto: hasta 4 campos simples, o __typename. */
function subSelection(s: GqlSchema, typeName: string): string[] {
  const t = s.types[typeName];
  if (!t) return ["__typename"];
  const scalars = t.fields.filter((f) => {
    const ft = s.types[f.typeName];
    return !f.args.some((a) => a.required) && (!ft || ft.kind === "SCALAR" || ft.kind === "ENUM");
  });
  const pick = scalars.slice(0, 4).map((f) => f.name);
  return pick.length ? pick : ["__typename"];
}

/** Texto de un campo para insertar en una selección existente (argumentos requeridos con valor de ejemplo). */
export function fieldSnippet(s: GqlSchema, f: GqlField, indent = ""): string {
  const req = f.args.filter((a) => a.required);
  let out = f.name;
  if (req.length) out += `(${req.map((a) => `${a.name}: ${literalFor(a.type, s)}`).join(", ")})`;
  if (isComposite(s.types[f.typeName])) {
    out += ` {\n${subSelection(s, f.typeName).map((n) => `${indent}  ${n}`).join("\n")}\n${indent}}`;
  }
  return out;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** Operación completa para un campo raíz: los argumentos requeridos pasan a variables ($id: ID!). */
export function operationSnippet(s: GqlSchema, kind: RootKind, f: GqlField, named: boolean): string {
  const req = f.args.filter((a) => a.required);
  const header = named ? `${kind} ${cap(f.name)}` : kind;
  const vars = req.length ? `${named ? "" : " "}(${req.map((a) => `$${a.name}: ${a.type}`).join(", ")})` : "";
  const call = req.length ? `(${req.map((a) => `${a.name}: $${a.name}`).join(", ")})` : "";
  let sel = f.name + call;
  if (isComposite(s.types[f.typeName])) sel += ` {\n${subSelection(s, f.typeName).map((n) => `    ${n}`).join("\n")}\n  }`;
  return `${header}${vars} {\n  ${sel}\n}`;
}

// ───────── búsqueda ─────────

export interface SearchHit {
  kind: "field" | "type";
  /** Para campos: tipo padre. */
  parent?: string;
  name: string;
  detail: string;
}

/** Busca por nombre en campos de los tipos raíz y en tipos (máx. `limit`). */
export function searchSchema(s: GqlSchema, q: string, limit = 60): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const roots: RootKind[] = ["query", "mutation", "subscription"];
  for (const k of roots) {
    const rt = rootTypeName(s, k);
    for (const f of (rt && s.types[rt]?.fields) || []) {
      if (f.name.toLowerCase().includes(needle)) hits.push({ kind: "field", parent: rt!, name: f.name, detail: f.type });
    }
  }
  for (const t of userTypes(s)) {
    if (t.name.toLowerCase().includes(needle)) hits.push({ kind: "type", name: t.name, detail: t.kind });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}
