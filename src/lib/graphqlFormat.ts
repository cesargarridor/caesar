import { lex, type Tok } from "./graphqlLex.ts";

/**
 * Formateador simple de GraphQL: sangra por llaves, mantiene los argumentos en una línea
 * y respeta strings y comentarios. Si el texto tiene llaves descuadradas devuelve el texto tal cual.
 */
export function formatGql(src: string, indentStr = "  "): string {
  const toks: Tok[] = lex(src);
  // ¿Hay comas/saltos que preservar? Entre tokens significativos miramos si hubo saltos de línea.
  const sig: { t: Tok; nlBefore: number }[] = [];
  let nl = 0;
  for (const t of toks) {
    if (t.kind === "ws") {
      nl = (t.text.match(/\n/g) ?? []).length;
      continue;
    }
    sig.push({ t, nlBefore: nl });
    nl = 0;
  }
  if (!sig.length) return "";

  let out = "";
  let depth = 0; // llaves de selección/definición
  let paren = 0; // () y [] y {} dentro de argumentos
  const stack: string[] = []; // "{" selección | "o" objeto en argumentos | "(" | "["
  const lineStart = () => out === "" || out.endsWith("\n");
  const nlOut = (blank = false) => {
    out = out.replace(/[ \t]+$/, "");
    if (!out.endsWith("\n") && out !== "") out += "\n";
    if (blank && !out.endsWith("\n\n") && out !== "") out += "\n";
  };
  const ind = () => (lineStart() ? indentStr.repeat(Math.max(0, depth)) : "");
  const space = () => {
    if (!lineStart() && !out.endsWith(" ") && !out.endsWith("(") && !out.endsWith("[")) out += " ";
  };

  let prev: Tok | null = null;
  let prev2: Tok | null = null;
  for (let k = 0; k < sig.length; k++) {
    const { t, nlBefore } = sig[k];
    const next = sig[k + 1]?.t ?? null;
    const inArgs = paren > 0;
    const p = prev;
    const text = t.text;

    if (t.kind === "comment") {
      if (nlBefore > 0 || lineStart() || !p) {
        if (!lineStart()) nlOut(nlBefore > 1);
        else if (nlBefore > 1 && !inArgs) nlOut(true);
        out += ind() + text;
      } else out += " " + text;
      nlOut();
    } else if (t.kind === "punct" && text === "{") {
      if (inArgs) {
        space();
        out += "{";
        stack.push("o");
        paren++;
        if (next && !(next.kind === "punct" && next.text === "}")) out += " ";
      } else {
        if (!lineStart()) space();
        else out += ind();
        out += "{";
        depth++;
        stack.push("{");
        nlOut();
      }
    } else if (t.kind === "punct" && text === "}") {
      const top = stack.pop();
      if (top === "o") {
        paren--;
        out = out.replace(/ $/, "");
        if (!out.endsWith("{")) out += " ";
        out += "}";
      } else {
        depth = Math.max(0, depth - 1);
        nlOut();
        out += ind() + "}";
        const nxt = next;
        if (depth === 0 && nxt) nlOut(true);
        else if (nxt) nlOut();
      }
    } else if (t.kind === "punct" && (text === "(" || text === "[")) {
      if (text === "(" && !lineStart()) out = out.replace(/ $/, "");
      else if (text === "[") space();
      out += ind() + text;
      paren++;
      stack.push(text);
    } else if (t.kind === "punct" && (text === ")" || text === "]")) {
      stack.pop();
      paren = Math.max(0, paren - 1);
      out = out.replace(/ $/, "");
      out += text;
    } else if (t.kind === "punct" && text === ",") {
      if (inArgs) {
        out = out.replace(/ $/, "");
        out += ", ";
      }
      // fuera de argumentos las comas son espacio: se omiten
    } else if (t.kind === "punct" && text === ":") {
      out = out.replace(/ $/, "");
      out += ": ";
    } else if (t.kind === "punct" && text === "=") {
      out = out.replace(/ $/, "");
      out += " = ";
    } else if (t.kind === "punct" && text === "!") {
      out = out.replace(/ $/, "");
      out += "!";
    } else if (t.kind === "punct" && (text === "|" || text === "&")) {
      out = out.replace(/ $/, "") + " " + text + " ";
    } else {
      // token "palabra": name, var, directive, number, string, spread, tpl, otros
      let needNl = false;
      if (!inArgs && p && !(depth === 0 && stack.length === 0 && !(p.kind === "punct" && p.text === "}"))) {
        const afterColon = p.kind === "punct" && (p.text === ":" || p.text === "=");
        const afterSpread = p.kind === "spread";
        const onName = p.kind === "name" && p.text === "on" && prev2 && prev2.kind === "spread";
        const isDirective = t.kind === "directive";
        const headerLine = depth === 0 && stack.length === 0;
        const startsItem = t.kind === "name" || t.kind === "spread" || t.kind === "tpl" || t.kind === "var";
        if (startsItem && !afterColon && !afterSpread && !onName && !(p.kind === "punct" && p.text === "{") && !isDirective && !headerLine) needNl = true;
      }
      if (!inArgs && p && depth === 0 && stack.length === 0 && p.kind === "punct" && p.text === "}") needNl = true;
      // Palabra tras una definición inline (query Foo ...): misma línea
      if (needNl) nlOut(nlBefore > 1 && depth > 0);
      else if (!lineStart() && !out.endsWith("(") && !out.endsWith("[") && !out.endsWith(" ") && !(p && p.kind === "spread" && !(t.kind === "name" && t.text === "on") && t.kind !== "directive")) space();
      out += ind() + text;
    }
    if (!(t.kind === "punct" && text === ",")) {
      prev2 = prev;
      prev = t;
    }
  }
  return out.replace(/[ \t]+$/gm, "").replace(/\n+$/, "") + "\n";
}
