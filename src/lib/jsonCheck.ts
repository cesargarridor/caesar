/** Comprobación de JSON con el error exacto: línea, columna y qué falla. Analizador propio (no depende de los mensajes del motor). */

export interface JsonIssue {
  /** Posición en el texto (índice de carácter). */
  pos: number;
  line: number;
  col: number;
  /** Explicación en español. */
  message: string;
  /** Línea afectada. */
  snippet: string;
}

/**
 * Las variables {{x}} fuera de comillas (p. ej. "id": {{id}}) no son JSON estricto pero sí válidas en una petición:
 * se sustituyen por un número de la misma longitud para no falsear los errores ni las posiciones.
 */
function maskVars(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "{" && text[i + 1] === "{") {
      const end = text.indexOf("}}", i + 2);
      const nl = text.indexOf("\n", i);
      if (end > 0 && (nl < 0 || end < nl)) {
        const len = end + 2 - i;
        out += "1" + " ".repeat(len - 1);
        i = end + 1;
      } else out += c;
    } else out += c;
  }
  return out;
}

function lineCol(text: string, pos: number) {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  return { line, col: pos - (before.lastIndexOf("\n") + 1) + 1 };
}

class Fail extends Error {
  pos: number;
  constructor(pos: number, message: string) {
    super(message);
    this.pos = pos;
  }
}

const show = (c: string | undefined) => (c === undefined ? "el final del texto" : c === "\n" ? "un salto de línea" : c === "\t" ? "un tabulador" : `«${c}»`);

/** Valida `s` como JSON estricto y lanza Fail en el primer error. */
function scan(s: string) {
  let i = 0;
  const open: { ch: string; pos: number }[] = [];
  const lineOf = (pos: number) => lineCol(s, pos).line;
  const ws = () => {
    while (i < s.length && /[ \t\n\r]/.test(s[i])) i++;
    if (s[i] === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) throw new Fail(i, "los comentarios no están permitidos en JSON");
  };
  const eof = (what: string): never => {
    const o = open[open.length - 1];
    throw new Fail(
      s.trimEnd().length,
      o ? `el JSON termina antes de tiempo: ${what}; falta cerrar «${o.ch === "{" ? "}" : "]"}» (la «${o.ch}» abierta en la línea ${lineOf(o.pos)})` : `el JSON termina antes de tiempo: ${what}`,
    );
  };

  const str = () => {
    const start = i;
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === "\n" || c === "\r") throw new Fail(i, `cadena sin cerrar: falta la comilla de cierre (la cadena empieza en la columna ${lineCol(s, start).col} y se corta en un salto de línea)`);
      if (c.charCodeAt(0) < 32) throw new Fail(i, "carácter de control no permitido dentro de una cadena (escríbelo con \\n, \\t…)");
      if (c === "\\") {
        const n = s[i + 1];
        if (n === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) throw new Fail(i, "escape \\u incompleto: necesita 4 dígitos hexadecimales");
          i += 6;
        } else if (n !== undefined && '"\\/bfnrt'.includes(n)) i += 2;
        else throw new Fail(i, `escape no válido «\\${n ?? ""}» dentro de una cadena (para una barra invertida usa \\\\)`);
      } else i++;
    }
    throw new Fail(start, "cadena sin cerrar: falta la comilla de cierre al final");
  };

  const value = (): void => {
    ws();
    const c = s[i];
    if (c === undefined) return eof("falta un valor");
    if (c === "{") {
      open.push({ ch: "{", pos: i });
      i++;
      ws();
      if (s[i] === "}") {
        i++;
        open.pop();
        return;
      }
      for (;;) {
        ws();
        if (s[i] === undefined) return eof("falta un nombre de campo");
        if (s[i] !== '"') {
          if (s[i] === "}") throw new Fail(i, "sobra una coma antes de «}»");
          if (s[i] === "'") throw new Fail(i, "los nombres de campo van entre comillas dobles (\"), no simples (')");
          throw new Fail(i, `se esperaba un nombre de campo entre comillas dobles, pero aparece ${show(s[i])}`);
        }
        str();
        ws();
        if (s[i] === undefined) return eof("falta «:» y su valor");
        if (s[i] !== ":") throw new Fail(i, `falta «:» entre el nombre del campo y su valor (aparece ${show(s[i])})`);
        i++;
        value();
        ws();
        if (s[i] === undefined) return eof("falta «,» o «}»");
        if (s[i] === ",") {
          i++;
          continue;
        }
        if (s[i] === "}") {
          i++;
          open.pop();
          return;
        }
        if (s[i] === "]") throw new Fail(i, `se esperaba «}» para cerrar la «{» de la línea ${lineOf(open[open.length - 1].pos)}, pero aparece «]»`);
        throw new Fail(i, `falta una coma entre campos (aparece ${show(s[i])})`);
      }
    }
    if (c === "[") {
      open.push({ ch: "[", pos: i });
      i++;
      ws();
      if (s[i] === "]") {
        i++;
        open.pop();
        return;
      }
      for (;;) {
        value();
        ws();
        if (s[i] === undefined) return eof("falta «,» o «]»");
        if (s[i] === ",") {
          i++;
          ws();
          if (s[i] === "]") throw new Fail(i, "sobra una coma antes de «]»");
          continue;
        }
        if (s[i] === "]") {
          i++;
          open.pop();
          return;
        }
        if (s[i] === "}") throw new Fail(i, `se esperaba «]» para cerrar la «[» de la línea ${lineOf(open[open.length - 1].pos)}, pero aparece «}»`);
        throw new Fail(i, `falta una coma entre elementos (aparece ${show(s[i])})`);
      }
    }
    if (c === '"') return str();
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
      m.lastIndex = i;
      const r = m.exec(s);
      if (!r) throw new Fail(i, "número no válido");
      i += r[0].length;
      if (/[0-9]/.test(s[i] ?? "") && r[0].replace("-", "") === "0") throw new Fail(i, "los números no pueden tener ceros a la izquierda");
      if (s[i] === ".") throw new Fail(i, "número no válido: después del punto decimal faltan dígitos");
      return;
    }
    for (const lit of ["true", "false", "null"]) {
      if (s.startsWith(lit, i) && !/[\w$]/.test(s[i + lit.length] ?? "")) {
        i += lit.length;
        return;
      }
    }
    if (c === "}" || c === "]" || c === ",") throw new Fail(i, c === "," ? "falta un valor antes de «,»" : `falta un valor antes de «${c}»`);
    if (c === ":") throw new Fail(i, "no se esperaba «:» aquí");
    if (c === "'") throw new Fail(i, "las cadenas van entre comillas dobles (\"), no simples (')");
    const w = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
    if (w) throw new Fail(i, `«${w[0]}» no es un valor JSON válido: usa texto entre comillas, un número, true, false, null, un objeto o una lista`);
    throw new Fail(i, `no se esperaba ${show(c)}`);
  };

  value();
  ws();
  if (i < s.length) throw new Fail(i, `hay texto después del final del JSON: ${show(s[i])}`);
}

/** null = JSON válido (o vacío). */
export function checkJson(text: string): JsonIssue | null {
  if (!text.trim()) return null;
  const masked = maskVars(text);
  try {
    scan(masked);
    return null;
  } catch (e) {
    if (!(e instanceof Fail)) return null;
    const pos = Math.min(e.pos, text.length);
    const { line, col } = lineCol(text, pos);
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const lineEnd = text.indexOf("\n", pos);
    return { pos, line, col, message: e.message, snippet: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd) };
  }
}

/** Texto corto para mostrar: «JSON inválido · línea 3, columna 5: falta una coma…». */
export const issueText = (i: JsonIssue) => `JSON inválido · línea ${i.line}, columna ${i.col}: ${i.message}`;
