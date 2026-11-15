import type { HlKind } from "./types.ts";

export type TokenKind = "str" | "num" | "com" | "kw" | "flag" | "plain";
export interface Token { k: TokenKind; s: string }

const KEYWORDS = new Set((
  "const let var function return new await async import from require package class public static void final try catch throw throws if else for while " +
  "true false null nil None True False def print println fmt func defer use fn mut impl pub struct extends using namespace var val fun guard in as is " +
  "echo self end do then not and or int string String boolean double float byte char"
).split(" "));

/** Resaltado ligero: cadenas, números, comentarios y palabras clave. */
export function highlight(code: string, kind: HlKind): Token[] {
  if (kind === "none") return [{ k: "plain", s: code }];
  const com = kind === "c" ? "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/" : "#[^\\n]*";
  const flag = kind === "curl" ? "|(?<=\\s)--?[A-Za-z][\\w-]*" : "";
  const re = new RegExp(`(${com})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b[A-Za-z_]\\w*\\b${flag})`, "g");
  const out: Token[] = [];
  let last = 0;
  const push = (k: TokenKind, s: string) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev && prev.k === k) prev.s += s;
    else out.push({ k, s });
  };
  for (const m of code.matchAll(re)) {
    const i = m.index ?? 0;
    push("plain", code.slice(last, i));
    if (m[1] !== undefined) push("com", m[0]);
    else if (m[2] !== undefined) push("str", m[0]);
    else if (m[3] !== undefined) push("num", m[0]);
    else push(m[0].startsWith("-") ? "flag" : KEYWORDS.has(m[0]) ? "kw" : "plain", m[0]);
    last = i + m[0].length;
  }
  push("plain", code.slice(last));
  return out;
}
