// JSONPath propio (sin eval): $.a.b, $[*].x, $..x, $['a b'], $[0], $[-1], $[0:3], $[0,2], $.*, $[?(@.n > 5 && @.t == 'x')], @.length…
// Sirve para filtrar la respuesta.

type Json = unknown;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

type Seg =
  | { k: "child"; names: (string | number)[] }
  | { k: "wild" }
  | { k: "desc" }
  | { k: "slice"; a?: number; b?: number; step: number }
  | { k: "filter"; test: (node: Json) => boolean };

export class PathError extends Error {}

// ───────────── parser de la ruta ─────────────

function parsePath(src: string): Seg[] {
  const s = src.trim();
  if (!s.startsWith("$")) throw new PathError("La expresión debe empezar por $");
  const segs: Seg[] = [];
  let i = 1;
  while (i < s.length) {
    if (s.startsWith("..", i)) {
      segs.push({ k: "desc" });
      i += 2;
      // tras ".." puede ir un nombre, * o [ ]
      if (s[i] === "[" || s[i] === "*") continue;
      const m = /^[^.[\s]+/.exec(s.slice(i));
      if (!m) throw new PathError("Falta el nombre después de '..'");
      segs.push({ k: "child", names: [m[0]] });
      i += m[0].length;
    } else if (s[i] === ".") {
      i++;
      if (s[i] === "*") {
        segs.push({ k: "wild" });
        i++;
      } else {
        const m = /^[^.[\s]+/.exec(s.slice(i));
        if (!m) throw new PathError(`Falta el nombre después del punto (posición ${i})`);
        segs.push({ k: "child", names: [m[0]] });
        i += m[0].length;
      }
    } else if (s[i] === "[") {
      const end = matchBracket(s, i);
      segs.push(bracket(s.slice(i + 1, end).trim()));
      i = end + 1;
    } else if (/\s/.test(s[i])) {
      i++;
    } else {
      throw new PathError(`Carácter inesperado «${s[i]}» en la posición ${i}`);
    }
  }
  return segs;
}

/** Posición del ] que cierra el [ de `from`, respetando cadenas y paréntesis. */
function matchBracket(s: string, from: number): number {
  let depth = 0;
  let q = "";
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = "";
    } else if (c === "'" || c === '"') q = c;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  throw new PathError("Falta cerrar un corchete ]");
}

function bracket(inner: string): Seg {
  if (inner === "*") return { k: "wild" };
  if (inner.startsWith("?")) {
    let e = inner.slice(1).trim();
    if (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1);
    return { k: "filter", test: compileExpr(e) };
  }
  const sl = /^(-?\d+)?\s*:\s*(-?\d+)?(?:\s*:\s*(-?\d+))?$/.exec(inner);
  if (sl) return { k: "slice", a: sl[1] !== undefined ? Number(sl[1]) : undefined, b: sl[2] !== undefined ? Number(sl[2]) : undefined, step: sl[3] ? Number(sl[3]) || 1 : 1 };
  const names: (string | number)[] = [];
  const re = /\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+))\s*(,|$)/y;
  let pos = 0;
  while (pos < inner.length) {
    re.lastIndex = pos;
    const m = re.exec(inner);
    if (!m) throw new PathError(`Selector no válido: [${inner}]`);
    names.push(m[3] !== undefined ? Number(m[3]) : (m[1] ?? m[2]).replace(/\\(.)/g, "$1"));
    pos = re.lastIndex;
    if (m[4] === "") break;
  }
  if (!names.length) throw new PathError("Corchetes vacíos []");
  return { k: "child", names };
}

// ───────────── evaluación ─────────────

function children(v: Json): Json[] {
  return Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [];
}

function descend(v: Json, out: Json[]) {
  out.push(v);
  for (const c of children(v)) descend(c, out);
}

function run(segs: Seg[], root: Json): Json[] {
  let cur: Json[] = [root];
  for (const sg of segs) {
    const next: Json[] = [];
    for (const v of cur) {
      switch (sg.k) {
        case "desc":
          descend(v, next);
          break;
        case "wild":
          next.push(...children(v));
          break;
        case "child":
          for (const n of sg.names) {
            if (Array.isArray(v) && typeof n === "number") {
              const x = v[n < 0 ? v.length + n : n];
              if (x !== undefined) next.push(x);
            } else if (Array.isArray(v) && n === "length") {
              next.push(v.length);
            } else if (isObj(v) && Object.prototype.hasOwnProperty.call(v, String(n))) {
              next.push(v[String(n)]);
            } else if (Array.isArray(v) && typeof n === "string" && /^-?\d+$/.test(n)) {
              const k = Number(n);
              const x = v[k < 0 ? v.length + k : k];
              if (x !== undefined) next.push(x);
            } else if (typeof v === "string" && n === "length") {
              next.push(v.length);
            }
          }
          break;
        case "slice":
          if (Array.isArray(v)) {
            const len = v.length;
            const norm = (x: number) => Math.min(len, Math.max(0, x < 0 ? len + x : x));
            const a = sg.a === undefined ? 0 : norm(sg.a);
            const b = sg.b === undefined ? len : norm(sg.b);
            for (let i = a; i < b; i += sg.step) next.push(v[i]);
          }
          break;
        case "filter":
          for (const c of children(v)) if (sg.test(c)) next.push(c);
          break;
      }
    }
    cur = next;
  }
  return cur;
}

/** Evalúa una expresión JSONPath. Lanza PathError si la expresión no es válida. */
export function jsonPath(root: Json, expr: string): Json[] {
  return run(parsePath(expr), root);
}

// ───────────── expresiones de filtro: [?(@.precio < 10 && @.tipo == 'x')] ─────────────

type Tok = { t: "num" | "str" | "id" | "op" | "re"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        v += src[j++] ?? "";
      }
      if (j >= src.length) throw new PathError("Cadena sin cerrar en el filtro");
      out.push({ t: "str", v });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
    } else if (c === "/" && (out.length === 0 || out[out.length - 1].v === "=~")) {
      let j = i + 1;
      while (j < src.length && src[j] !== "/") j += src[j] === "\\" ? 2 : 1;
      if (j >= src.length) throw new PathError("Expresión regular sin cerrar en el filtro");
      const flags = /^[a-z]*/.exec(src.slice(j + 1))![0];
      out.push({ t: "re", v: src.slice(i + 1, j) + "\u0000" + flags });
      i = j + 1 + flags.length;
    } else if (c === "@" || /[A-Za-z_$]/.test(c)) {
      // @ + .nombre / ['x'] / [0] encadenados, o una palabra (true, false, null)
      let j = i + 1;
      for (;;) {
        if (src[j] === "[") j = matchBracket(src, j) + 1;
        else if (src[j] === "." && /[^\s=!<>&|()]/.test(src[j + 1] ?? "")) {
          j++;
          while (j < src.length && /[^\s.[=!<>&|()]/.test(src[j])) j++;
        } else if (c !== "@" && /[\w$]/.test(src[j] ?? "")) j++;
        else break;
      }
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
    } else {
      const m = /^(===|!==|==|!=|<=|>=|=~|&&|\|\||[<>!()])/.exec(src.slice(i));
      if (!m) throw new PathError(`Carácter inesperado «${c}» en el filtro`);
      out.push({ t: "op", v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

type Ev = (node: Json) => unknown;

function compileExpr(src: string): (node: Json) => boolean {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v !== undefined && t.v !== v)) throw new PathError(v ? `Se esperaba «${v}» en el filtro` : "El filtro está incompleto");
    p++;
    return t;
  };

  const orE = (): Ev => {
    let l = andE();
    while (peek()?.v === "||") {
      eat();
      const a = l;
      const r = andE();
      l = (n) => !!a(n) || !!r(n);
    }
    return l;
  };
  const andE = (): Ev => {
    let l = cmpE();
    while (peek()?.v === "&&") {
      eat();
      const a = l;
      const r = cmpE();
      l = (n) => !!a(n) && !!r(n);
    }
    return l;
  };
  const cmpE = (): Ev => {
    const l = unary();
    const t = peek();
    if (t?.t === "op" && ["==", "!=", "===", "!==", "<", ">", "<=", ">=", "=~"].includes(t.v)) {
      eat();
      const r = unary();
      const op = t.v;
      return (n) => {
        const a = l(n);
        const b = r(n);
        switch (op) {
          case "==": case "===": return looseEq(a, b);
          case "!=": case "!==": return !looseEq(a, b);
          case "<": return (a as number) < (b as number);
          case ">": return (a as number) > (b as number);
          case "<=": return (a as number) <= (b as number);
          case ">=": return (a as number) >= (b as number);
          default: return b instanceof RegExp ? typeof a === "string" && b.test(a) : false;
        }
      };
    }
    return l;
  };
  const unary = (): Ev => {
    if (peek()?.v === "!") {
      eat();
      const e = unary();
      return (n) => !e(n);
    }
    return atom();
  };
  const atom = (): Ev => {
    const t = eat();
    if (t.t === "op" && t.v === "(") {
      const e = orE();
      eat(")");
      return e;
    }
    if (t.t === "num") return () => Number(t.v);
    if (t.t === "str") return () => t.v;
    if (t.t === "re") {
      const [body, flags] = t.v.split("\u0000");
      let re: RegExp;
      try {
        re = new RegExp(body, flags);
      } catch (e) {
        throw new PathError(`Expresión regular no válida: ${e instanceof Error ? e.message : body}`);
      }
      return () => re;
    }
    if (t.t === "id") {
      if (t.v === "true") return () => true;
      if (t.v === "false") return () => false;
      if (t.v === "null") return () => null;
      if (t.v.startsWith("@")) {
        const segs = parsePath("$" + t.v.slice(1));
        return (n) => run(segs, n)[0];
      }
    }
    throw new PathError(`No se entiende «${t.v}» en el filtro`);
  };

  const e = orE();
  if (p < toks.length) throw new PathError(`Sobra «${toks[p].v}» en el filtro`);
  return (n) => !!e(n);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "string") return String(a) === b;
  if (typeof a === "string" && typeof b === "number") return a === String(b);
  return false;
}

// ───────────── filtro de la respuesta ─────────────

export interface FilterResult {
  text: string;
  /** true = el resultado es JSON (se pinta con colores). */
  json: boolean;
  count: number;
  error?: string;
}

/**
 * Filtra el cuerpo de una respuesta:
 *  · empieza por $ → JSONPath sobre el JSON (devuelve una lista);
 *  · si no → expresión regular (sin distinguir mayúsculas; /x/flags también vale) sobre las líneas del texto.
 */
export function filterResponse(parsed: Json | undefined, pretty: string, query: string): FilterResult {
  const q = query.trim();
  if (q.startsWith("$")) {
    if (parsed === undefined) return { text: "", json: false, count: 0, error: "La respuesta no es JSON: no se puede usar JSONPath." };
    try {
      const res = jsonPath(parsed, q);
      return { text: JSON.stringify(res, null, 2), json: true, count: res.length };
    } catch (e) {
      return { text: "", json: false, count: 0, error: e instanceof PathError ? e.message : "Expresión JSONPath no válida" };
    }
  }
  let re: RegExp;
  const lit = /^\/(.+)\/([a-z]*)$/s.exec(q);
  try {
    re = lit ? new RegExp(lit[1], lit[2].replace(/[gy]/g, "")) : new RegExp(q, "i");
  } catch (e) {
    return { text: "", json: false, count: 0, error: `Expresión regular no válida: ${e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : q}` };
  }
  const lines = pretty.split("\n").filter((l) => re.test(l));
  return { text: lines.join("\n"), json: false, count: lines.length };
}
