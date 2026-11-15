import type { SnippetInput, SnippetOptions } from "./types.ts";

export type EscStyle = "json" | "kotlin" | "dart" | "brace";

/** Literal de cadena entre comillas dobles, escapado para cada lenguaje. */
export function esc(s: string, style: EscStyle = "json"): string {
  if (style === "brace") {
    // Swift y Rust: \u{X}
    let out = "";
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (c < 0x20 || c === 0x7f) out += `\\u{${c.toString(16)}}`;
      else out += ch;
    }
    return `"${out}"`;
  }
  let j = JSON.stringify(s);
  if (style === "kotlin") j = j.replace(/\\f/g, "\\u000c").replace(/\$/g, "\\$");
  if (style === "dart") j = j.replace(/\$/g, "\\$");
  return j;
}

/** Cadena entre comillas simples (PHP, Ruby): solo se escapan \ y '. */
export const sq = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
/** Cadena literal de PowerShell: comillas simples duplicadas. */
export const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const ind = (o: SnippetOptions) => (o.indent === 0 ? "\t" : " ".repeat(Math.max(1, o.indent)));

/** Codificación application/x-www-form-urlencoded. */
export const formEnc = (s: string) =>
  encodeURIComponent(s).replace(/%20/g, "+").replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export const formBody = (fields: { key: string; value: string }[]) => fields.map((f) => `${formEnc(f.key)}=${formEnc(f.value)}`).join("&");

export const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;
export const fwd = (p: string) => p.replace(/\\/g, "/");

export const headerOf = (i: SnippetInput, name: string) => i.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
export const withoutHeader = (i: SnippetInput, name: string) => i.headers.filter((h) => h.key.toLowerCase() !== name.toLowerCase());
/** Content-Type sin parámetros (charset…). */
export const mimeOf = (i: SnippetInput, fallback = "text/plain") => (headerOf(i, "content-type") ?? fallback).split(";")[0].trim() || fallback;

export interface UrlParts {
  scheme: string;
  host: string;
  port: string;
  path: string;
}
export function splitUrl(u: string): UrlParts {
  const m = /^([a-zA-Z][\w+.-]*):\/\/([^/?#]*)([^#]*)/.exec(u);
  if (!m) return { scheme: "https", host: u, port: "", path: "/" };
  let host = m[2].replace(/^[^@]*@/, "");
  let port = "";
  const pm = /^(.*?):(\d+)$/.exec(host);
  if (pm) {
    host = pm[1];
    port = pm[2];
  }
  let path = m[3];
  if (!path.startsWith("/")) path = "/" + path;
  return { scheme: m[1].toLowerCase(), host, port, path };
}

/** Indenta cada línea no vacía n niveles. */
export const indent = (lines: string[], unit: string, n = 1) => lines.map((l) => (l ? unit.repeat(n) + l : l));

export const joinLines = (lines: string[]) => lines.join("\n");
