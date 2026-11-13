/** Analizador léxico mínimo de GraphQL (sin dependencias de React/Tauri). Lo usan formateador, validador, autocompletado y resaltado. */
export type TokKind = "ws" | "comment" | "string" | "name" | "var" | "directive" | "number" | "spread" | "tpl" | "punct";

export interface Tok {
  kind: TokKind;
  text: string;
  start: number;
  end: number;
  /** Solo en strings: sin cerrar. */
  open?: boolean;
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  const push = (kind: TokKind, start: number, end: number, open?: boolean) =>
    out.push({ kind, text: src.slice(start, end), start, end, ...(open ? { open } : {}) });
  while (i < n) {
    const c = src[i];
    const s = i;
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿") {
      while (i < n && /[ \t\r\n﻿]/.test(src[i])) i++;
      push("ws", s, i);
    } else if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      push("comment", s, i);
    } else if (c === '"') {
      if (src.startsWith('"""', i)) {
        let j = i + 3;
        let closed = false;
        while (j < n) {
          if (src.startsWith('\\"""', j)) j += 4;
          else if (src.startsWith('"""', j)) {
            j += 3;
            closed = true;
            break;
          } else j++;
        }
        i = j;
        push("string", s, i, !closed);
      } else {
        i++;
        let closed = false;
        while (i < n && src[i] !== "\n") {
          if (src[i] === "\\") i += 2;
          else if (src[i] === '"') {
            i++;
            closed = true;
            break;
          } else i++;
        }
        if (i > n) i = n;
        push("string", s, i, !closed);
      }
    } else if (c === "{" && src[i + 1] === "{" && /^\{\{[^{}\n]*\}\}/.test(src.slice(i, i + 200))) {
      const m = /^\{\{[^{}\n]*\}\}/.exec(src.slice(i, i + 200))!;
      i += m[0].length;
      push("tpl", s, i); // variable de Caesar {{x}}
    } else if (c === "$" || c === "@") {
      i++;
      while (i < n && NAME_CHAR.test(src[i])) i++;
      push(c === "$" ? "var" : "directive", s, i);
    } else if (c === "." && src.startsWith("...", i)) {
      i += 3;
      push("spread", s, i);
    } else if (NAME_START.test(c)) {
      while (i < n && NAME_CHAR.test(src[i])) i++;
      push("name", s, i);
    } else if (/[0-9-]/.test(c) && (c !== "-" || /[0-9]/.test(src[i + 1] ?? ""))) {
      i++;
      while (i < n && /[0-9.eE+-]/.test(src[i])) i++;
      push("number", s, i);
    } else {
      i++;
      push("punct", s, i);
    }
  }
  return out;
}

export type GqlIssue = { kind: "unclosed" | "unexpected" | "string"; ch: string; pos: number; line: number };

const CLOSE: Record<string, string> = { "{": "}", "(": ")", "[": "]" };

/** Primer problema básico de sintaxis (llaves/paréntesis/corchetes sin cerrar o sobrantes, strings sin cerrar). */
export function gqlSyntaxIssue(src: string): GqlIssue | null {
  const stack: { ch: string; pos: number }[] = [];
  const lineAt = (pos: number) => src.slice(0, pos).split("\n").length;
  for (const t of lex(src)) {
    if (t.kind === "string" && t.open) return { kind: "string", ch: '"', pos: t.start, line: lineAt(t.start) };
    if (t.kind !== "punct") continue;
    if (CLOSE[t.text]) stack.push({ ch: t.text, pos: t.start });
    else if (t.text === "}" || t.text === ")" || t.text === "]") {
      const top = stack.pop();
      if (!top || CLOSE[top.ch] !== t.text) return { kind: "unexpected", ch: t.text, pos: t.start, line: lineAt(t.start) };
    }
  }
  const top = stack.pop();
  return top ? { kind: "unclosed", ch: top.ch, pos: top.pos, line: lineAt(top.pos) } : null;
}
