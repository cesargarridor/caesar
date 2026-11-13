import { lex } from "./graphqlLex.ts";
import { extractVarDefs } from "./graphql.ts";
import { rootTypeName, type GqlSchema, type GqlType, type RootKind } from "./graphqlSchema.ts";

export interface GqlCompletion {
  label: string;
  /** Texto a insertar. "$|" marca dónde queda el cursor; \n se sangra al insertarlo. */
  insert: string;
  /** Tipo / descripción corta (a la derecha). */
  detail: string;
  doc: string;
  kind: "field" | "arg" | "type" | "directive" | "enum" | "keyword" | "var" | "fragment" | "value";
}

export interface GqlCompletionResult {
  /** Posición donde empieza la palabra parcial que se reemplaza. */
  from: number;
  items: GqlCompletion[];
}

interface Frame {
  kind: "{" | "(" | "[" | "o";
  /** "{": tipo de la selección. "o": tipo del input object. */
  type: string | null;
  /** "(": campo (o directiva) al que pertenecen los argumentos. */
  owner: { field: string | null; directive: string | null; parent: string | null } | null;
  /** "(": tipo del argumento que se está escribiendo (tras `nombre:`). */
  argType: string | null;
  header: boolean;
}

const KEYWORDS = ["query", "mutation", "subscription", "fragment"];
const WORD = /[A-Za-z0-9_$@]/;

const named = (t: string) => t.replace(/[[\]!]/g, "");

function fieldsOf(_s: GqlSchema, t: GqlType | undefined) {
  return t && (t.kind === "OBJECT" || t.kind === "INTERFACE") ? t.fields : [];
}

/** Sugerencias en la posición `caret` del texto. null = nada que sugerir. */
export function completionAt(s: GqlSchema, text: string, caret: number, force = false): GqlCompletionResult | null {
  let from = caret;
  while (from > 0 && WORD.test(text[from - 1])) from--;
  const prefix = text.slice(from, caret);
  const toks = lex(text);
  // dentro de string o comentario: nada
  for (const t of toks) {
    if (t.start < caret && caret <= t.end && (t.kind === "comment" || (t.kind === "string" && (t.open || caret < t.end)))) return null;
  }
  const before = toks.filter((t) => t.kind !== "ws" && t.kind !== "comment" && t.end <= from);

  const stack: Frame[] = [];
  let opKind: RootKind | null = null;
  let lastField: string | null = null; // último nombre en una selección
  let lastDirective: string | null = null;
  let pendingType: string | null = null; // tras `... on` / `fragment X on`
  let afterOn = false;
  let prevTok: { kind: string; text: string } | null = null;
  let prev2: { kind: string; text: string } | null = null;
  let fragDef = false;
  const parentSel = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === "{") return stack[i];
    return null;
  };

  for (const t of before) {
    const top = stack[stack.length - 1];
    if (t.kind === "name") {
      if (!stack.length && (t.text === "query" || t.text === "mutation" || t.text === "subscription")) {
        opKind = t.text;
        fragDef = false;
      } else if (!stack.length && t.text === "fragment") fragDef = true;
      else if (t.text === "on" && (prevTok?.kind === "spread" || (fragDef && !stack.length))) afterOn = true;
      else if (afterOn) {
        pendingType = t.text;
        afterOn = false;
      } else if (top?.kind === "{") {
        lastField = t.text;
        lastDirective = null;
      }
    } else if (t.kind === "directive") {
      lastDirective = t.text.slice(1);
    } else if (t.kind === "punct") {
      const c = t.text;
      if (c === "(") {
        const isHeader = !stack.length;
        const sel = parentSel();
        const parentType = top?.kind === "{" ? top.type : sel?.type ?? null;
        stack.push({
          kind: "(",
          type: null,
          owner: isHeader ? null : { field: lastDirective ? null : lastField, directive: lastDirective, parent: parentType },
          argType: null,
          header: isHeader,
        });
      } else if (c === ")" || c === "]") {
        stack.pop();
      } else if (c === "[") {
        stack.push({ kind: "[", type: top?.argType ?? top?.type ?? null, owner: null, argType: null, header: false });
      } else if (c === "{") {
        if (top && (top.kind === "(" || top.kind === "o" || top.kind === "[")) {
          const tn = top.kind === "[" ? top.type : top.argType;
          stack.push({ kind: "o", type: tn ? named(tn) : null, owner: null, argType: null, header: false });
        } else {
          let type: string | null = null;
          if (pendingType) type = pendingType;
          else if (!stack.length) type = rootTypeName(s, opKind ?? "query");
          else if (top?.kind === "{" && top.type) {
            const f = fieldsOf(s, s.types[top.type]).find((x) => x.name === lastField);
            type = f ? f.typeName : null;
            if (!f && prevTok && (prevTok.kind === "spread" || prevTok.text === ")")) type = top.type; // `... {`
          }
          stack.push({ kind: "{", type, owner: null, argType: null, header: false });
        }
        pendingType = null;
        lastField = null;
        lastDirective = null;
        fragDef = false;
        if (!stack.length) opKind = null;
      } else if (c === "}") {
        stack.pop();
        lastField = null;
        lastDirective = null;
        if (!stack.length) opKind = null;
      } else if (c === ":" && top?.kind === "(") {
        // tipo del argumento que se escribe: el nombre justo antes de ':'
        const nm = prevTok && prevTok.kind === "name" ? prevTok.text : null;
        if (nm && top.owner) {
          if (top.owner.directive) {
            const d = s.directives.find((x) => x.name === top.owner!.directive);
            top.argType = d?.args.find((a) => a.name === nm)?.type ?? null;
          } else if (top.owner.parent && top.owner.field) {
            const f = fieldsOf(s, s.types[top.owner.parent]).find((x) => x.name === top.owner!.field);
            top.argType = f?.args.find((a) => a.name === nm)?.type ?? null;
          }
        }
      } else if (c === ":" && top?.kind === "o") {
        const nm = prevTok && prevTok.kind === "name" ? prevTok.text : null;
        const inf = top.type && nm ? s.types[top.type]?.inputFields.find((x) => x.name === nm) : undefined;
        top.argType = inf?.type ?? null;
      } else if (c === "," && (top?.kind === "(" || top?.kind === "o")) top.argType = null;
    }
    if (t.kind === "name" || t.kind === "punct" || t.kind === "directive" || t.kind === "spread" || t.kind === "var") {
      prev2 = prevTok;
      prevTok = t;
    }
  }

  const top = stack[stack.length - 1];
  const lower = prefix.toLowerCase();
  const match = (label: string) => {
    const l = label.toLowerCase();
    return !prefix || prefix === "$" || prefix === "@" ? true : l.startsWith(lower.replace(/^[$@]/, "")) || l.includes(lower.replace(/^[$@]/, ""));
  };
  const rank = (a: GqlCompletion, b: GqlCompletion) => {
    const ap = a.label.toLowerCase().startsWith(lower.replace(/^[$@]/, "")) ? 0 : 1;
    const bp = b.label.toLowerCase().startsWith(lower.replace(/^[$@]/, "")) ? 0 : 1;
    return ap - bp || a.label.localeCompare(b.label);
  };
  const done = (items: GqlCompletion[]): GqlCompletionResult | null => {
    const list = items.filter((i) => match(i.label)).sort(rank).slice(0, 80);
    if (!list.length) return null;
    // si lo escrito ya es exactamente la única sugerencia, no molestar
    if (list.length === 1 && list[0].label === prefix.replace(/^[$@]/, "") && !force) return null;
    return { from, items: list };
  };

  // variables $x: las declaradas
  if (prefix.startsWith("$")) {
    const defs = extractVarDefs(text, null);
    return done(defs.map((d) => ({ label: d.name, insert: "$" + d.name, detail: d.type, doc: "", kind: "var" as const })).map((i) => ({ ...i, insert: i.insert.replace(/^\$/, "$") })));
  }
  // directivas @x
  if (prefix.startsWith("@")) {
    return done(s.directives.map((d) => ({ label: d.name, insert: "@" + d.name + (d.args.some((a) => a.type.endsWith("!")) ? "($|)" : ""), detail: "@" + d.name, doc: d.description, kind: "directive" as const })));
  }

  const lastSig = before[before.length - 1];
  const afterColon = lastSig?.kind === "punct" && lastSig.text === ":";

  if (!top) {
    if (!force && !prefix) return null;
    return done(KEYWORDS.map((k) => ({ label: k, insert: k === "fragment" ? "fragment $| on  {\n}" : k + " {\n$|\n}", detail: "", doc: "", kind: "keyword" as const })));
  }

  if (top.kind === "(" && top.header) {
    // cabecera de la operación: ($x: Tipo)
    if (afterColon) {
      return done(
        Object.values(s.types)
          .filter((t) => t.kind === "SCALAR" || t.kind === "ENUM" || t.kind === "INPUT_OBJECT")
          .filter((t) => !t.name.startsWith("__"))
          .map((t) => ({ label: t.name, insert: t.name, detail: t.kind.toLowerCase().replace("_", " "), doc: t.description, kind: "type" as const })),
      );
    }
    return null;
  }

  if (top.kind === "(" && top.owner) {
    if (afterColon && top.argType) {
      const tn = named(top.argType);
      const def = s.types[tn];
      const items: GqlCompletion[] = [];
      if (def?.kind === "ENUM") for (const v of def.enumValues) items.push({ label: v.name, insert: v.name, detail: tn, doc: v.description, kind: "enum" });
      if (tn === "Boolean") for (const v of ["true", "false"]) items.push({ label: v, insert: v, detail: "Boolean", doc: "", kind: "value" });
      for (const d of extractVarDefs(text, null)) items.push({ label: "$" + d.name, insert: "$" + d.name, detail: d.type, doc: "", kind: "var" });
      return items.length ? done(items) : null;
    }
    if (afterColon) return null;
    // nombres de argumentos
    let args: { name: string; type: string; description: string; required: boolean }[] = [];
    if (top.owner.directive) args = s.directives.find((d) => d.name === top.owner!.directive)?.args ?? [];
    else if (top.owner.parent && top.owner.field) args = fieldsOf(s, s.types[top.owner.parent]).find((f) => f.name === top.owner!.field)?.args ?? [];
    // ya usados en esta lista
    const used = new Set<string>();
    {
      let depth = 0;
      for (const t of before.slice().reverse()) {
        if (t.kind === "punct" && ")]}".includes(t.text)) depth++;
        else if (t.kind === "punct" && "([{".includes(t.text)) {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && t.kind === "name") {
          const idx = before.indexOf(t);
          if (before[idx + 1]?.text === ":") used.add(t.text);
        }
      }
    }
    return done(args.filter((a) => !used.has(a.name)).map((a) => ({ label: a.name, insert: a.name + ": ", detail: a.type, doc: a.description, kind: "arg" as const })));
  }

  if (top.kind === "o") {
    const def = top.type ? s.types[top.type] : undefined;
    if (def?.kind === "INPUT_OBJECT" && !afterColon) return done(def.inputFields.map((a) => ({ label: a.name, insert: a.name + ": ", detail: a.type, doc: a.description, kind: "arg" as const })));
    return null;
  }

  if (top.kind === "{" && top.type) {
    // `... on |` o `fragment X on |`
    if ((prevTok?.kind === "name" && prevTok.text === "on" && (prev2?.kind === "spread" || fragDef)) || (lastSig?.kind === "name" && lastSig.text === "on" && afterOn)) {
      return done(Object.values(s.types).filter((t) => ["OBJECT", "INTERFACE", "UNION"].includes(t.kind) && !t.name.startsWith("__")).map((t) => ({ label: t.name, insert: t.name, detail: t.kind.toLowerCase(), doc: t.description, kind: "type" as const })));
    }
    if (afterColon || lastSig?.kind === "spread") {
      if (lastSig?.kind === "spread") {
        const def = s.types[top.type];
        const items: GqlCompletion[] = [{ label: "on", insert: "on $| {\n}", detail: "fragmento en línea", doc: "", kind: "keyword" }];
        if (def && def.possibleTypes.length) for (const p of def.possibleTypes) items.push({ label: "on " + p, insert: `on ${p} {\n$|\n}`, detail: p, doc: "", kind: "fragment" });
        return done(items);
      }
      return null;
    }
    const def = s.types[top.type];
    const items: GqlCompletion[] = [];
    for (const f of fieldsOf(s, def)) {
      const composite = ["OBJECT", "INTERFACE", "UNION"].includes(s.types[f.typeName]?.kind ?? "");
      const req = f.args.some((a) => a.required);
      let insert = f.name;
      if (req) insert += composite ? "($|) {\n  \n}" : "($|)";
      else if (composite) insert += " {\n  $|\n}";
      items.push({ label: f.name, insert, detail: f.type, doc: (f.deprecated ? "[deprecated] " : "") + f.description, kind: "field" });
    }
    if (def && def.possibleTypes.length) {
      items.push({ label: "...on", insert: "... on $| {\n}", detail: "fragmento en línea", doc: "", kind: "fragment" });
      for (const p of def.possibleTypes) items.push({ label: "... on " + p, insert: `... on ${p} {\n  $|\n}`, detail: p, doc: "", kind: "fragment" });
    }
    if (def && (def.kind === "OBJECT" || def.kind === "INTERFACE" || def.kind === "UNION")) items.push({ label: "__typename", insert: "__typename", detail: "String!", doc: "", kind: "field" });
    if (!force && !prefix) return null;
    return done(items);
  }
  return null;
}
