import { lex } from "./graphqlLex.ts";

/** Modelo del esquema GraphQL (a partir de la introspección o de un archivo SDL .graphql/.gql), plantilla de variables y snippets. Sin dependencias de React/Tauri. */

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

const BUILTIN_SCALARS = ["Int", "Float", "String", "Boolean", "ID"];

function unquoteSdl(raw: string): string {
  if (raw.startsWith('"""')) return raw.slice(3, raw.endsWith('"""') ? -3 : undefined).replace(/\\"""/g, '"""').trim();
  if (raw.startsWith('"')) return raw.slice(1, raw.endsWith('"') ? -1 : undefined).replace(/\\(["\\/bfnrt])/g, "$1");
  return raw;
}

/** Convierte un esquema SDL (.graphql / .gql) al modelo GqlSchema. */
export function parseSdl(src: string): GqlSchema {
  const toks = lex(src).filter((t) => t.kind !== "ws" && t.kind !== "comment");
  let i = 0;
  const types: Record<string, GqlType> = {};
  const directives: GqlDirective[] = [];
  let queryType: string | null = null;
  let mutationType: string | null = null;
  let subscriptionType: string | null = null;

  const ensureType = (name: string, kind: GqlKind, description = ""): GqlType => {
    if (!types[name]) {
      types[name] = { name, kind, description, fields: [], inputFields: [], enumValues: [], possibleTypes: [] };
    } else {
      if (description && !types[name].description) types[name].description = description;
      if (kind !== "OBJECT" || types[name].kind === "OBJECT") types[name].kind = kind;
    }
    return types[name];
  };

  const readTypeExpr = (): { type: string; typeName: string } => {
    let type = "";
    let typeName = "";
    let depth = 0;
    while (i < toks.length) {
      const tk = toks[i];
      if (tk.kind === "punct" && tk.text === "[") {
        type += "[";
        depth++;
        i++;
      } else if (tk.kind === "punct" && tk.text === "]" && depth > 0) {
        type += "]";
        depth--;
        i++;
      } else if (tk.kind === "punct" && tk.text === "!") {
        type += "!";
        i++;
      } else if (tk.kind === "name" && (!typeName || depth > 0)) {
        if (!typeName) typeName = tk.text;
        type += tk.text;
        i++;
      } else {
        break;
      }
      if (depth === 0 && typeName && !(toks[i]?.kind === "punct" && toks[i].text === "!")) break;
    }
    return { type: type || "?", typeName };
  };

  const readValueText = (): string => {
    let out = "";
    let depth = 0;
    while (i < toks.length) {
      const tk = toks[i];
      if (depth === 0 && (tk.kind === "directive" || (tk.kind === "punct" && (tk.text === ")" || tk.text === "}" || tk.text === ",")) || (tk.kind === "name" && toks[i + 1]?.text === ":"))) {
        break;
      }
      if (tk.kind === "punct" && "([{".includes(tk.text)) depth++;
      else if (tk.kind === "punct" && ")]}".includes(tk.text)) {
        if (depth === 0) break;
        depth--;
      }
      out += tk.text;
      i++;
      if (depth === 0) break;
    }
    return out;
  };

  const skipDirectives = (): boolean => {
    let deprecated = false;
    while (toks[i]?.kind === "directive") {
      if (toks[i].text === "@deprecated") deprecated = true;
      i++;
      if (toks[i]?.kind === "punct" && toks[i].text === "(") {
        let d = 1;
        i++;
        while (i < toks.length && d > 0) {
          if (toks[i].kind === "punct" && toks[i].text === "(") d++;
          else if (toks[i].kind === "punct" && toks[i].text === ")") d--;
          i++;
        }
      }
    }
    return deprecated;
  };

  const readArgsList = (closeTok: ")" | "}"): GqlArg[] => {
    const out: GqlArg[] = [];
    while (i < toks.length && !(toks[i].kind === "punct" && toks[i].text === closeTok)) {
      if (toks[i].kind === "punct" && toks[i].text === ",") {
        i++;
        continue;
      }
      let desc = "";
      if (toks[i]?.kind === "string") {
        desc = unquoteSdl(toks[i].text);
        i++;
      }
      if (toks[i]?.kind !== "name") {
        i++;
        continue;
      }
      const name = toks[i].text;
      i++;
      if (toks[i]?.text === ":") i++;
      const { type, typeName } = readTypeExpr();
      let defaultValue: string | null = null;
      if (toks[i]?.kind === "punct" && toks[i].text === "=") {
        i++;
        defaultValue = readValueText();
      }
      skipDirectives();
      out.push({
        name,
        description: desc,
        type,
        typeName,
        defaultValue,
        required: type.endsWith("!") && defaultValue === null,
      });
    }
    if (toks[i]?.kind === "punct" && toks[i].text === closeTok) i++;
    return out;
  };

  const readFieldsBlock = (): GqlField[] => {
    const out: GqlField[] = [];
    if (!(toks[i]?.kind === "punct" && toks[i].text === "{")) return out;
    i++;
    while (i < toks.length && !(toks[i].kind === "punct" && toks[i].text === "}")) {
      if (toks[i].kind === "punct" && toks[i].text === ",") {
        i++;
        continue;
      }
      let desc = "";
      if (toks[i]?.kind === "string") {
        desc = unquoteSdl(toks[i].text);
        i++;
      }
      if (toks[i]?.kind !== "name") {
        i++;
        continue;
      }
      const name = toks[i].text;
      i++;
      let args: GqlArg[] = [];
      if (toks[i]?.kind === "punct" && toks[i].text === "(") {
        i++;
        args = readArgsList(")");
      }
      if (toks[i]?.text === ":") i++;
      const { type, typeName } = readTypeExpr();
      // Si un campo tiene un valor por defecto inesperado en SDL, se salta
      if (toks[i]?.kind === "punct" && toks[i].text === "=") {
        i++;
        readValueText();
      }
      const deprecated = skipDirectives();
      out.push({ name, description: desc, args, type, typeName, deprecated });
    }
    if (toks[i]?.kind === "punct" && toks[i].text === "}") i++;
    return out;
  };

  while (i < toks.length) {
    let desc = "";
    if (toks[i].kind === "string") {
      desc = unquoteSdl(toks[i].text);
      i++;
    }
    if (i >= toks.length) break;
    if (toks[i].kind === "name" && toks[i].text === "extend") i++;
    const kw = toks[i];
    if (kw?.kind !== "name") {
      i++;
      continue;
    }

    if (kw.text === "schema") {
      i++;
      skipDirectives();
      if (toks[i]?.kind === "punct" && toks[i].text === "{") {
        i++;
        while (i < toks.length && !(toks[i].kind === "punct" && toks[i].text === "}")) {
          const k = toks[i]?.text;
          const colon = toks[i + 1]?.text === ":";
          const v = toks[i + 2]?.kind === "name" ? toks[i + 2].text : null;
          if (colon && v) {
            if (k === "query") queryType = v;
            else if (k === "mutation") mutationType = v;
            else if (k === "subscription") subscriptionType = v;
            i += 3;
          } else i++;
        }
        if (toks[i]?.text === "}") i++;
      }
    } else if (kw.text === "type" || kw.text === "interface") {
      const kind: GqlKind = kw.text === "interface" ? "INTERFACE" : "OBJECT";
      i++;
      if (toks[i]?.kind !== "name") continue;
      const name = toks[i].text;
      i++;
      const ty = ensureType(name, kind, desc);
      while (toks[i]?.kind === "name" && toks[i].text === "implements") {
        i++;
        if (toks[i]?.text === "&") i++;
        while (toks[i]?.kind === "name") {
          const iface = ensureType(toks[i].text, "INTERFACE");
          if (!iface.possibleTypes.includes(name)) iface.possibleTypes.push(name);
          i++;
          if (toks[i]?.text === "&") i++;
          else break;
        }
      }
      skipDirectives();
      ty.fields.push(...readFieldsBlock());
    } else if (kw.text === "input") {
      i++;
      if (toks[i]?.kind !== "name") continue;
      const name = toks[i].text;
      i++;
      const ty = ensureType(name, "INPUT_OBJECT", desc);
      skipDirectives();
      if (toks[i]?.kind === "punct" && toks[i].text === "{") {
        i++;
        ty.inputFields.push(...readArgsList("}"));
      }
    } else if (kw.text === "enum") {
      i++;
      if (toks[i]?.kind !== "name") continue;
      const name = toks[i].text;
      i++;
      const ty = ensureType(name, "ENUM", desc);
      skipDirectives();
      if (toks[i]?.kind === "punct" && toks[i].text === "{") {
        i++;
        while (i < toks.length && !(toks[i].kind === "punct" && toks[i].text === "}")) {
          if (toks[i].kind === "punct" && toks[i].text === ",") {
            i++;
            continue;
          }
          let vDesc = "";
          if (toks[i]?.kind === "string") {
            vDesc = unquoteSdl(toks[i].text);
            i++;
          }
          if (toks[i]?.kind === "name") {
            ty.enumValues.push({ name: toks[i].text, description: vDesc });
            i++;
            skipDirectives();
          } else i++;
        }
        if (toks[i]?.text === "}") i++;
      }
    } else if (kw.text === "union") {
      i++;
      if (toks[i]?.kind !== "name") continue;
      const name = toks[i].text;
      i++;
      const ty = ensureType(name, "UNION", desc);
      skipDirectives();
      if (toks[i]?.text === "=") {
        i++;
        if (toks[i]?.text === "|") i++;
        while (toks[i]?.kind === "name") {
          if (!ty.possibleTypes.includes(toks[i].text)) ty.possibleTypes.push(toks[i].text);
          i++;
          if (toks[i]?.text === "|") i++;
          else break;
        }
      }
    } else if (kw.text === "scalar") {
      i++;
      if (toks[i]?.kind === "name") {
        ensureType(toks[i].text, "SCALAR", desc);
        i++;
        skipDirectives();
      }
    } else if (kw.text === "directive") {
      i++;
      const dTok = toks[i];
      const dName = dTok?.kind === "directive" ? dTok.text.slice(1) : dTok?.kind === "name" ? dTok.text : "";
      if (dName) i++;
      let args: GqlArg[] = [];
      if (toks[i]?.kind === "punct" && toks[i].text === "(") {
        i++;
        args = readArgsList(")");
      }
      if (toks[i]?.kind === "name" && toks[i].text === "repeatable") i++;
      if (toks[i]?.kind === "name" && toks[i].text === "on") {
        i++;
        if (toks[i]?.text === "|") i++;
        while (toks[i]?.kind === "name") {
          i++;
          if (toks[i]?.text === "|") i++;
          else break;
        }
      }
      if (dName) directives.push({ name: dName, description: desc, args });
    } else {
      i++;
    }
  }

  if (Object.keys(types).length === 0) {
    throw new Error("El esquema no contiene ningún tipo GraphQL válido.");
  }
  for (const s of BUILTIN_SCALARS) {
    if (!types[s]) types[s] = { name: s, kind: "SCALAR", description: "", fields: [], inputFields: [], enumValues: [], possibleTypes: [] };
  }
  if (!queryType && types.Query) queryType = "Query";
  if (!mutationType && types.Mutation) mutationType = "Mutation";
  if (!subscriptionType && types.Subscription) subscriptionType = "Subscription";

  return { queryType, mutationType, subscriptionType, types, directives };
}

/** Parsea un esquema GraphQL tanto en formato JSON de introspección como en SDL (.graphql / .gql). */
export function parseAnySchema(text: string): GqlSchema {
  const t = text.trim();
  if (!t) throw new Error("El esquema está vacío.");
  if (t.startsWith("{")) return parseIntrospection(t);
  return parseSdl(t);
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

/**
 * Construye una query/mutation/subscription a partir de una selección árbol:
 * cada clave del mapa `selected` es una ruta como `"query.user"` o `"query.user.friends.name"`,
 * y `checkedArgs` contiene rutas de argumentos activos como `"query.user@id"`.
 */
export function buildQueryFromSelection(
  schema: GqlSchema,
  kind: RootKind,
  opName: string,
  selectedFields: Set<string>,
  selectedArgs: Set<string>,
  argValues: Record<string, string>,
): { query: string; vars: string } {
  const rt = rootTypeName(schema, kind);
  const rootType = rt ? schema.types[rt] : null;
  if (!rootType) return { query: "", vars: "" };

  const varDefs: { name: string; type: string }[] = [];
  const usedVars = new Set<string>();

  const allocVar = (base: string, type: string): string => {
    let name = base;
    let n = 2;
    while (usedVars.has(name)) name = `${base}${n++}`;
    usedVars.add(name);
    varDefs.push({ name, type });
    return name;
  };

  const renderField = (f: GqlField, path: string, indent: string, depth: number): string | null => {
    const hasSelectedChild = [...selectedFields].some((p) => p.startsWith(path + "."));
    if (!selectedFields.has(path) && !hasSelectedChild) return null;

    const activeArgs = f.args.filter((a) => selectedArgs.has(`${path}@${a.name}`) || a.required);
    let argsStr = "";
    if (activeArgs.length > 0) {
      const parts = activeArgs.map((a) => {
        const key = `${path}@${a.name}`;
        const custom = argValues[key]?.trim();
        if (custom) {
          if (custom.startsWith("$")) {
            const vn = custom.slice(1);
            if (!usedVars.has(vn)) {
              usedVars.add(vn);
              varDefs.push({ name: vn, type: a.type });
            }
          }
          return `${a.name}: ${custom}`;
        }
        const vName = allocVar(a.name, a.type);
        return `${a.name}: $${vName}`;
      });
      argsStr = `(${parts.join(", ")})`;
    }

    const childType = schema.types[f.typeName];
    if (isComposite(childType) && depth < 6) {
      const childLines: string[] = [];
      for (const cf of childType.fields) {
        const cp = `${path}.${cf.name}`;
        const rendered = renderField(cf, cp, indent + "  ", depth + 1);
        if (rendered) childLines.push(rendered);
      }
      if (childLines.length === 0) {
        for (const sf of subSelection(schema, f.typeName)) {
          childLines.push(`${indent}  ${sf}`);
        }
      }
      return `${indent}${f.name}${argsStr} {\n${childLines.join("\n")}\n${indent}}`;
    }
    return `${indent}${f.name}${argsStr}`;
  };

  const topLines: string[] = [];
  for (const rf of rootType.fields) {
    const p = `${kind}.${rf.name}`;
    const r = renderField(rf, p, "  ", 0);
    if (r) topLines.push(r);
  }

  if (topLines.length === 0) return { query: "", vars: "" };

  const cleanName = opName.trim().replace(/[^A-Za-z0-9_]/g, "");
  const headerName = cleanName ? ` ${cleanName}` : "";
  const varsHeader = varDefs.length ? `(${varDefs.map((v) => `$${v.name}: ${v.type}`).join(", ")})` : "";
  const query = `${kind}${headerName}${varsHeader && !cleanName ? " " + varsHeader : varsHeader} {\n${topLines.join("\n")}\n}`;
  const vars = varsTemplate(varDefs, schema);
  return { query, vars };
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
