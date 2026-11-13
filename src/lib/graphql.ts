import type { BodyData } from "../types";
import { lex } from "./graphqlLex.ts";

export interface GqlOp {
  /** null = operación anónima. */
  name: string | null;
  kind: "query" | "mutation" | "subscription";
}

export interface GqlVarDef {
  name: string;
  /** Tipo tal cual está escrito: "[Int!]!". */
  type: string;
}

type SigTok = { kind: string; text: string };
const sig = (src: string): SigTok[] => lex(src).filter((t) => t.kind !== "ws" && t.kind !== "comment");

/** Operaciones de primer nivel de un documento GraphQL (ignora fragmentos). */
export function listOperations(query: string): GqlOp[] {
  const toks = sig(query);
  const ops: GqlOp[] = [];
  let depth = 0;
  let inDef = false; // cabecera de operación o fragmento aún sin su "{"
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "punct" && "{([".includes(t.text)) {
      if (depth === 0 && t.text === "{") {
        if (!inDef) ops.push({ name: null, kind: "query" }); // forma abreviada
        inDef = false;
      }
      depth++;
    } else if (t.kind === "punct" && "})]".includes(t.text)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && t.kind === "name" && t.text === "fragment") inDef = true;
    else if (depth === 0 && t.kind === "name" && (t.text === "query" || t.text === "mutation" || t.text === "subscription")) {
      inDef = true;
      const nx = toks[i + 1];
      ops.push({ name: nx && nx.kind === "name" ? nx.text : null, kind: t.text as GqlOp["kind"] });
    }
  }
  return ops;
}

/** Nombre de operación que se envía: solo cuando hay varias; la elegida, o la primera con nombre. */
export function effectiveOp(ops: GqlOp[], chosen?: string): string | null {
  if (ops.length < 2) return null;
  if (chosen && ops.some((o) => o.name === chosen)) return chosen;
  return ops.find((o) => o.name)?.name ?? null;
}

/** Variables declaradas ($id: ID!) en la cabecera de la operación `opName` (o la primera si no se indica / no existe). */
export function extractVarDefs(query: string, opName?: string | null): GqlVarDef[] {
  const toks = sig(query);
  let depth = 0;
  const heads: { name: string | null; from: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "punct" && "{([".includes(t.text)) depth++;
    else if (t.kind === "punct" && "})]".includes(t.text)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && t.kind === "name" && (t.text === "query" || t.text === "mutation" || t.text === "subscription")) {
      const nx = toks[i + 1];
      heads.push({ name: nx && nx.kind === "name" ? nx.text : null, from: i + 1 });
    }
  }
  const head = (opName ? heads.find((h) => h.name === opName) : undefined) ?? heads[0];
  if (!head) return [];
  let i = head.from;
  if (toks[i]?.kind === "name") i++; // nombre
  if (!(toks[i]?.kind === "punct" && toks[i].text === "(")) return [];
  i++;
  const defs: GqlVarDef[] = [];
  let level = 1;
  while (i < toks.length && level > 0) {
    const t = toks[i];
    if (t.kind === "var" && level === 1 && toks[i + 1]?.text === ":") {
      i += 2;
      let type = "";
      let lv = 0;
      while (i < toks.length) {
        const u = toks[i];
        if (u.kind === "punct" && u.text === "[") lv++;
        if (u.kind === "punct" && u.text === "]") lv--;
        if (lv === 0 && ((u.kind === "punct" && (u.text === "=" || u.text === ")")) || u.kind === "var" || u.kind === "directive")) break;
        if (u.kind === "punct" && u.text === ",") {
          i++;
          continue;
        }
        type += u.text;
        i++;
      }
      defs.push({ name: t.text.slice(1), type });
      continue;
    }
    if (t.kind === "punct" && "([{".includes(t.text)) level++;
    if (t.kind === "punct" && ")]}".includes(t.text)) level--;
    i++;
  }
  return defs;
}

/** Cuerpo JSON {query, variables, operationName} que se envía en una petición GraphQL. `sub` aplica {{variables}}. */
export function gqlRaw(b: Pick<BodyData, "gqlQuery" | "gqlVars" | "gqlOp">, sub: (s: string) => string = (s) => s): string {
  const query = sub(b.gqlQuery ?? "");
  const out: { query: string; variables?: unknown; operationName?: string } = { query };
  const v = sub(b.gqlVars ?? "").trim();
  if (v) {
    try {
      out.variables = JSON.parse(v);
    } catch {
      out.variables = v; // JSON inválido: el servidor lo rechazará con un error claro
    }
  }
  const op = effectiveOp(listOperations(query), b.gqlOp);
  if (op) out.operationName = op;
  return JSON.stringify(out);
}

/** Error de las variables, o null si están vacías o son un objeto JSON válido (con {{x}} se omite la comprobación). */
export function gqlVarsError(vars: string | undefined): string | null {
  const v = (vars ?? "").trim();
  if (!v || v.includes("{{")) return null;
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" && !Array.isArray(p) ? null : "Las variables deben ser un objeto JSON.";
  } catch (e) {
    return (e as Error).message;
  }
}
