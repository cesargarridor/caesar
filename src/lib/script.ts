/**
 * Intérprete SEGURO de un subconjunto de JavaScript para los scripts "Tests" .
 * No usa eval ni new Function (la CSP los prohíbe): parsea y evalúa el AST aquí mismo.
 * Sin red, sin DOM, sin acceso a globals del navegador: solo la API pm. que se le inyecta.
 */

// ───────────────────────────── Tipos públicos ─────────────────────────────

export interface ScriptContext {
  body: string;
  status: number;
  statusText: string;
  timeMs: number;
  headers: [string, string][];
  /** Copia de trabajo de las variables (clave -> valor). */
  vars: Map<string, string>;
}

export interface ScriptResult {
  /** Variables creadas/modificadas (última escritura por clave). */
  sets: { key: string; value: string }[];
  unsets: string[];
  logs: string[];
  tests: { name: string; ok: boolean; error?: string }[];
  errors: string[];
}

// ───────────────────────────── Tokenizador ─────────────────────────────

interface Tok {
  t: "num" | "str" | "tpl" | "id" | "p" | "eof";
  v: string;
  n: number;
  line: number;
  q: string[];
  e: string[];
}

class ScriptError extends Error {}

const PUNCT3 = ["===", "!=="];
const PUNCT2 = ["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "+=", "-="];
const PUNCT1 = "{}()[];,.:?!<>+-*/%=";

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const push = (t: Tok["t"], v: string, n = 0, q: string[] = [], e: string[] = []) =>
    out.push({ t, v, n, line, q, e });
  const esc = (c: string) => ({ n: "\n", t: "\t", r: "\r", "0": "\0" } as Record<string, string>)[c] ?? c;

  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; }
      i += 2;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i))!;
      push("num", m[0], Number(m[0]));
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!;
      push("id", m[0]);
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\n") throw new ScriptError(`Línea ${line}: cadena sin cerrar`);
        if (src[i] === "\\") {
          i++;
          if (src[i] === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 1, i + 5))) {
            s += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16));
            i += 5;
            continue;
          }
          s += esc(src[i] ?? "");
        } else s += src[i];
        i++;
      }
      if (i >= src.length) throw new ScriptError(`Línea ${line}: cadena sin cerrar`);
      i++;
      push("str", s);
      continue;
    }
    if (c === "`") {
      const q: string[] = [];
      const e: string[] = [];
      let cur = "";
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") { i++; cur += esc(src[i] ?? ""); i++; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          q.push(cur);
          cur = "";
          i += 2;
          let depth = 1;
          let ex = "";
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") { depth--; if (depth === 0) break; }
            ex += src[i++];
          }
          e.push(ex);
          i++;
          continue;
        }
        if (src[i] === "\n") line++;
        cur += src[i++];
      }
      if (i >= src.length) throw new ScriptError(`Línea ${line}: plantilla sin cerrar`);
      i++;
      q.push(cur);
      push("tpl", "", 0, q, e);
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (PUNCT3.includes(three)) { push("p", three); i += 3; continue; }
    if (PUNCT2.includes(two) && !(two === "?." && /[0-9]/.test(src[i + 2] ?? ""))) { push("p", two); i += 2; continue; }
    if (PUNCT1.includes(c)) { push("p", c); i++; continue; }
    throw new ScriptError(`Línea ${line}: carácter no soportado '${c}'`);
  }
  push("eof", "");
  return out;
}

// ───────────────────────────── Parser ─────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const UNSUPPORTED = ["for", "while", "do", "switch", "class", "import", "export", "new", "delete", "yield", "with", "break", "continue"];
const BIN_PREC: Record<string, number> = {
  "??": 1, "||": 2, "&&": 3,
  "==": 4, "!=": 4, "===": 4, "!==": 4,
  "<": 5, ">": 5, "<=": 5, ">=": 5,
  "+": 6, "-": 6, "*": 7, "/": 7, "%": 7,
};

class Parser {
  toks: Tok[];
  pos = 0;
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(o = 0) { return this.toks[Math.min(this.pos + o, this.toks.length - 1)]; }
  next() { return this.toks[this.pos++]; }
  isP(v: string, o = 0) { const t = this.peek(o); return t.t === "p" && t.v === v; }
  isId(v: string, o = 0) { const t = this.peek(o); return t.t === "id" && t.v === v; }
  eatP(v: string) { if (this.isP(v)) { this.pos++; return true; } return false; }
  fail(msg: string): never { throw new ScriptError(`Línea ${this.peek().line}: ${msg}`); }
  expectP(v: string) { if (!this.eatP(v)) this.fail(`se esperaba '${v}'`); }
  ident(): string { const t = this.next(); if (t.t !== "id") { this.pos--; this.fail("se esperaba un nombre"); } return t.v; }

  /** Parsea todo el programa; ante un error de sintaxis lo anota y continúa tras el siguiente ';'. */
  program(errors: string[]): N[] {
    const out: N[] = [];
    while (this.peek().t !== "eof") {
      const start = this.pos;
      try {
        out.push(this.statement());
      } catch (e) {
        if (!(e instanceof ScriptError)) throw e;
        errors.push(e.message);
        if (this.pos === start) this.pos++;
        // Recuperación: saltar hasta el ';' o el '}' que cierra el bloque en curso.
        let depth = 0;
        while (this.peek().t !== "eof") {
          const t = this.peek();
          if (t.t === "p" && (t.v === "{" || t.v === "(")) depth++;
          else if (t.t === "p" && (t.v === "}" || t.v === ")")) {
            depth--;
            if (depth <= 0 && t.v === "}") { this.pos++; break; }
          } else if (t.t === "p" && t.v === ";" && depth <= 0) { this.pos++; break; }
          this.pos++;
        }
      }
    }
    return out;
  }

  block(): N {
    this.expectP("{");
    const body: N[] = [];
    while (!this.isP("}")) {
      if (this.peek().t === "eof") this.fail("falta '}'");
      body.push(this.statement());
    }
    this.expectP("}");
    return { k: "block", body };
  }

  statement(): N {
    const t = this.peek();
    const line = t.line;
    if (t.t === "p") {
      if (t.v === "{") return this.block();
      if (t.v === ";") { this.pos++; return { k: "empty", line }; }
    }
    if (t.t === "id") {
      if (UNSUPPORTED.includes(t.v)) this.fail(`'${t.v}' no está soportado en los scripts de Caesar`);
      if (t.v === "var" || t.v === "let" || t.v === "const") {
        this.pos++;
        const decls: { name: string; init: N }[] = [];
        do {
          const name = this.ident();
          decls.push({ name, init: this.eatP("=") ? this.assign() : null });
        } while (this.eatP(","));
        this.eatP(";");
        return { k: "decl", isVar: t.v === "var", decls, line };
      }
      if (t.v === "if") {
        this.pos++;
        this.expectP("(");
        const cond = this.expr();
        this.expectP(")");
        const then = this.statement();
        const els = this.isId("else") ? (this.pos++, this.statement()) : null;
        return { k: "if", cond, then, els, line };
      }
      if (t.v === "return") {
        this.pos++;
        const hasVal = !this.isP(";") && !this.isP("}") && this.peek().t !== "eof" && this.peek().line === line;
        const val = hasVal ? this.expr() : null;
        this.eatP(";");
        return { k: "return", val, line };
      }
      if (t.v === "throw") {
        this.pos++;
        const val = this.expr();
        this.eatP(";");
        return { k: "throw", val, line };
      }
      if (t.v === "try") {
        this.pos++;
        const body = this.block();
        let param: string | null = null;
        let handler: N = null;
        let fin: N = null;
        if (this.isId("catch")) {
          this.pos++;
          if (this.eatP("(")) { param = this.ident(); this.expectP(")"); }
          handler = this.block();
        }
        if (this.isId("finally")) { this.pos++; fin = this.block(); }
        if (!handler && !fin) this.fail("try necesita catch o finally");
        return { k: "try", body, param, handler, fin, line };
      }
      if (t.v === "function" && this.peek(1).t === "id") {
        this.pos++;
        const name = this.ident();
        const fn = this.functionRest(name);
        return { k: "fundecl", name, fn, line };
      }
    }
    const e = this.expr();
    this.eatP(";");
    return { k: "expr", e, line };
  }

  functionRest(name: string | null): N {
    this.expectP("(");
    const params: string[] = [];
    while (!this.isP(")")) {
      params.push(this.ident());
      if (!this.eatP(",")) break;
    }
    this.expectP(")");
    return { k: "fn", params, body: this.block(), expr: false, name };
  }

  expr(): N {
    const e = this.assign();
    if (this.isP(",")) {
      // operador coma: devuelve el último
      let last = e;
      while (this.eatP(",")) last = this.assign();
      return last;
    }
    return e;
  }

  assign(): N {
    const left = this.ternary();
    const t = this.peek();
    if (t.t === "p" && (t.v === "=" || t.v === "+=" || t.v === "-=")) {
      if (left.k !== "id" && left.k !== "member") this.fail("asignación no válida");
      this.pos++;
      return { k: "assign", op: t.v, target: left, val: this.assign(), line: t.line };
    }
    return left;
  }

  ternary(): N {
    const c = this.binary(1);
    if (this.eatP("?")) {
      const a = this.assign();
      this.expectP(":");
      const b = this.assign();
      return { k: "cond", c, a, b };
    }
    return c;
  }

  binary(min: number): N {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      const prec = t.t === "p" ? BIN_PREC[t.v] : undefined;
      if (prec === undefined || prec < min) return left;
      this.pos++;
      const right = this.binary(prec + 1);
      left = { k: "bin", op: t.v, l: left, r: right, line: t.line };
    }
  }

  unary(): N {
    const t = this.peek();
    if (t.t === "p" && (t.v === "!" || t.v === "-" || t.v === "+")) {
      this.pos++;
      return { k: "un", op: t.v, e: this.unary() };
    }
    if (t.t === "id" && (t.v === "typeof" || t.v === "await" || t.v === "void")) {
      this.pos++;
      return t.v === "await" ? this.unary() : { k: "un", op: t.v, e: this.unary() };
    }
    return this.postfix();
  }

  postfix(): N {
    let e = this.primary();
    let opt = false;
    for (;;) {
      const t = this.peek();
      if (t.t !== "p") return e;
      if (t.v === ".") {
        this.pos++;
        e = { k: "member", obj: e, prop: this.ident(), computed: false, opt, line: t.line };
      } else if (t.v === "?.") {
        this.pos++;
        opt = true;
        if (this.isP("[")) { this.pos++; const p = this.expr(); this.expectP("]"); e = { k: "member", obj: e, prop: p, computed: true, opt, line: t.line }; }
        else if (this.isP("(")) { e = { k: "call", callee: e, args: this.args(), opt, line: t.line }; }
        else e = { k: "member", obj: e, prop: this.ident(), computed: false, opt, line: t.line };
      } else if (t.v === "[") {
        this.pos++;
        const p = this.expr();
        this.expectP("]");
        e = { k: "member", obj: e, prop: p, computed: true, opt, line: t.line };
      } else if (t.v === "(") {
        e = { k: "call", callee: e, args: this.args(), opt, line: t.line };
      } else return e;
    }
  }

  args(): N[] {
    this.expectP("(");
    const a: N[] = [];
    while (!this.isP(")")) {
      a.push(this.assign());
      if (!this.eatP(",")) break;
    }
    this.expectP(")");
    return a;
  }

  /** ¿El '(' actual abre los parámetros de una arrow function? */
  isArrowAhead(): boolean {
    let depth = 0;
    for (let j = this.pos; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === "p" && t.v === "(") depth++;
      else if (t.t === "p" && t.v === ")") {
        depth--;
        if (depth === 0) { const n = this.toks[j + 1]; return !!n && n.t === "p" && n.v === "=>"; }
      } else if (t.t === "eof") return false;
    }
    return false;
  }

  arrowBody(params: string[]): N {
    if (this.isP("{")) return { k: "fn", params, body: this.block(), expr: false, name: null };
    return { k: "fn", params, body: this.assign(), expr: true, name: null };
  }

  primary(): N {
    const t = this.next();
    switch (t.t) {
      case "num": return { k: "lit", v: t.n };
      case "str": return { k: "lit", v: t.v };
      case "tpl": {
        const exprs = t.e.map((s) => {
          const p = new Parser(tokenize(s));
          return p.expr();
        });
        return { k: "tpl", q: t.q, e: exprs };
      }
      case "id": {
        if (t.v === "true") return { k: "lit", v: true };
        if (t.v === "false") return { k: "lit", v: false };
        if (t.v === "null") return { k: "lit", v: null };
        if (t.v === "undefined") return { k: "lit", v: undefined };
        if (t.v === "async") return this.primary();
        if (t.v === "function") {
          const name = this.peek().t === "id" ? this.ident() : null;
          return this.functionRest(name);
        }
        if (UNSUPPORTED.includes(t.v)) { this.pos--; this.fail(`'${t.v}' no está soportado en los scripts de Caesar`); }
        if (this.isP("=>")) { this.pos++; return this.arrowBody([t.v]); }
        return { k: "id", name: t.v, line: t.line };
      }
      case "p": {
        if (t.v === "(") {
          this.pos--;
          if (this.isArrowAhead()) {
            this.pos++;
            const params: string[] = [];
            while (!this.isP(")")) { params.push(this.ident()); if (!this.eatP(",")) break; }
            this.expectP(")");
            this.expectP("=>");
            return this.arrowBody(params);
          }
          this.pos++;
          const e = this.expr();
          this.expectP(")");
          return e;
        }
        if (t.v === "[") {
          const items: N[] = [];
          while (!this.isP("]")) { items.push(this.assign()); if (!this.eatP(",")) break; }
          this.expectP("]");
          return { k: "arr", items };
        }
        if (t.v === "{") {
          const props: { key: string; val: N }[] = [];
          while (!this.isP("}")) {
            const kt = this.next();
            if (kt.t !== "id" && kt.t !== "str" && kt.t !== "num") { this.pos--; this.fail("clave de objeto no válida"); }
            const key = kt.t === "num" ? String(kt.n) : kt.v;
            if (this.eatP(":")) props.push({ key, val: this.assign() });
            else if (kt.t === "id") props.push({ key, val: { k: "id", name: key, line: kt.line } });
            else this.fail("se esperaba ':'");
            if (!this.eatP(",")) break;
          }
          this.expectP("}");
          return { k: "obj", props };
        }
        this.pos--;
        this.fail(`token inesperado '${t.v}'`);
      }
      // eslint-disable-next-line no-fallthrough
      default:
        this.pos--;
        this.fail("fin de script inesperado");
    }
  }
}

// ───────────────────────────── Valores / entorno ─────────────────────────────

type V = unknown;

class Native {
  fn: (args: V[]) => V;
  constructor(fn: (args: V[]) => V) {
    this.fn = fn;
  }
}

class Closure {
  node: N;
  env: Env;
  constructor(node: N, env: Env) {
    this.node = node;
    this.env = env;
  }
}

/** Objeto del anfitrión (pm, pm.response, ...). Las propiedades función-JS son "getters" perezosos. */
class Host {
  props: Record<string, V | (() => V)>;
  setter?: (k: string, v: V) => void;
  constructor(props: Record<string, V | (() => V)>, setter?: (k: string, v: V) => void) {
    this.props = props;
    this.setter = setter;
  }
  get(k: string): V {
    if (!Object.prototype.hasOwnProperty.call(this.props, k)) return undefined;
    const v = this.props[k];
    return typeof v === "function" ? (v as () => V)() : v;
  }
}

class Env {
  vars = new Map<string, V>();
  parent: Env | null;
  isFn: boolean;
  constructor(parent: Env | null, isFn: boolean) {
    this.parent = parent;
    this.isFn = isFn;
  }
  find(name: string): Env | null {
    for (let e: Env | null = this; e; e = e.parent) if (e.vars.has(name)) return e;
    return null;
  }
  declare(name: string, v: V, isVar = false) {
    let t: Env = this;
    if (isVar) while (!t.isFn && t.parent) t = t.parent;
    t.vars.set(name, v);
  }
}

class ReturnSignal {
  value: V;
  constructor(value: V) {
    this.value = value;
  }
}
class ThrowSignal {
  value: V;
  constructor(value: V) {
    this.value = value;
  }
}

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype", "__defineGetter__", "__defineSetter__"]);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v: V): v is Record<string, V> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Host) && !(v instanceof Native) && !(v instanceof Closure);

export const toDisplay = (v: V): string => {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  if (v instanceof Closure || v instanceof Native) return "[Function]";
  if (v instanceof Host) return "[Object]";
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
};

const deepEq = (a: V, b: V): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const typeName = (v: V) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// ───────────────────────────── Intérprete ─────────────────────────────

const MAX_STEPS = 200_000;

export function runScript(source: string, ctx: ScriptContext): ScriptResult {
  const res: ScriptResult = { sets: [], unsets: [], logs: [], tests: [], errors: [] };
  if (!source.trim()) return res;

  let steps = 0;
  const num = (v: V) => Number(v);

  const toVarString = (v: V): string =>
    typeof v === "string" ? v : v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

  const setVar = (k: V, v: V) => {
    const key = String(k);
    if (v === undefined) {
      res.errors.push(`No se guardó la variable '${key}': el valor es undefined (¿existe ese campo en la respuesta?).`);
      return;
    }
    const value = toVarString(v);
    ctx.vars.set(key, value);
    const i = res.sets.findIndex((s) => s.key === key);
    if (i >= 0) res.sets[i].value = value;
    else res.sets.push({ key, value });
  };
  const unsetVar = (k: V) => {
    const key = String(k);
    ctx.vars.delete(key);
    res.sets = res.sets.filter((s) => s.key !== key);
    if (!res.unsets.includes(key)) res.unsets.push(key);
  };

  const nat = (fn: (a: V[]) => V) => new Native(fn);
  const varApi = () =>
    new Host({
      set: nat(([k, v]) => { setVar(k, v); return undefined; }),
      get: nat(([k]) => ctx.vars.get(String(k))),
      has: nat(([k]) => ctx.vars.has(String(k))),
      unset: nat(([k]) => { unsetVar(k); return undefined; }),
      clear: nat(() => undefined),
    });

  const headerGet = (name: V) => ctx.headers.find(([k]) => k.toLowerCase() === String(name).toLowerCase())?.[1];

  const parseBody = (): V => {
    try {
      return JSON.parse(ctx.body);
    } catch {
      throw new ScriptError("El body de la respuesta no es JSON válido (JSON.parse falló).");
    }
  };

  const assertThat = (ok: boolean, negate: boolean, msg: string, negMsg: string) => {
    if (ok === negate) throw new ScriptError(negate ? negMsg : msg);
  };

  const makeExpect = (actual: V, negate = false): Host => {
    const self: Record<string, V | (() => V)> = {};
    const chain = ["to", "be", "been", "is", "that", "which", "and", "has", "have", "with", "at", "of", "same", "but", "does", "still"];
    for (const w of chain) self[w] = () => host;
    const sh = toDisplay;
    const cmp = (name: string[], f: (e: V) => boolean, desc: string) => {
      for (const n of name)
        self[n] = nat(([e]) => {
          assertThat(f(e), negate, `se esperaba ${sh(actual)} ${desc} ${sh(e)}`, `se esperaba ${sh(actual)} no ${desc} ${sh(e)}`);
          return host;
        });
    };
    const flag = (name: string, f: () => boolean, desc: string) => {
      self[name] = () => {
        assertThat(f(), negate, `se esperaba ${sh(actual)} ${desc}`, `se esperaba ${sh(actual)} no ${desc}`);
        return host;
      };
    };
    self.not = () => makeExpect(actual, !negate);
    cmp(["equal", "equals", "eq"], (e) => actual === e, "igual a");
    cmp(["eql", "eqls", "deep"], (e) => deepEq(actual, e), "profundamente igual a");
    cmp(["above", "greaterThan", "gt"], (e) => num(actual) > num(e), "mayor que");
    cmp(["below", "lessThan", "lt"], (e) => num(actual) < num(e), "menor que");
    cmp(["least", "gte"], (e) => num(actual) >= num(e), "al menos");
    cmp(["most", "lte"], (e) => num(actual) <= num(e), "como máximo");
    cmp(["include", "includes", "contain", "contains"], (e) =>
      typeof actual === "string" ? actual.includes(String(e)) : Array.isArray(actual) ? actual.some((x) => deepEq(x, e)) : isPlain(actual) ? own(actual, String(e)) : false, "que incluya");
    cmp(["oneOf"], (e) => Array.isArray(e) && e.some((x) => deepEq(x, actual)), "uno de");
    cmp(["lengthOf", "length", "lengthIs"], (e) => (typeof actual === "string" || Array.isArray(actual)) && actual.length === num(e), "con longitud");
    cmp(["a", "an"], (e) => typeName(actual) === String(e).toLowerCase(), "de tipo");
    self.property = nat(([k, v]) => {
      const has = isPlain(actual) && own(actual, String(k)) && (v === undefined || deepEq(actual[String(k)], v));
      assertThat(has, negate, `se esperaba la propiedad '${String(k)}'`, `no se esperaba la propiedad '${String(k)}'`);
      return host;
    });
    flag("ok", () => !!actual, "truthy");
    flag("true", () => actual === true, "true");
    flag("false", () => actual === false, "false");
    flag("null", () => actual === null, "null");
    flag("undefined", () => actual === undefined, "undefined");
    flag("exist", () => actual !== null && actual !== undefined, "que exista");
    flag("empty", () => (typeof actual === "string" || Array.isArray(actual) ? actual.length === 0 : isPlain(actual) ? Object.keys(actual).length === 0 : false), "vacío");
    const host: Host = new Host(self);
    return host;
  };

  const responseHost = new Host({
    json: nat(() => parseBody()),
    text: nat(() => ctx.body),
    code: ctx.status,
    status: ctx.statusText,
    responseTime: ctx.timeMs,
    headers: new Host({
      get: nat(([n]) => headerGet(n)),
      has: nat(([n]) => headerGet(n) !== undefined),
    }),
    to: () =>
      new Host({
        have: new Host({
          status: nat(([n]) => {
            if (typeof n === "number" ? ctx.status !== n : ctx.statusText !== n) throw new ScriptError(`se esperaba el status ${toDisplay(n)} pero fue ${ctx.status} ${ctx.statusText}`);
            return undefined;
          }),
          header: nat(([n]) => {
            if (headerGet(n) === undefined) throw new ScriptError(`la respuesta no tiene el header '${toDisplay(n)}'`);
            return undefined;
          }),
        }),
        be: new Host({
          ok: () => { if (ctx.status < 200 || ctx.status >= 300) throw new ScriptError(`se esperaba un status 2xx pero fue ${ctx.status}`); return undefined; },
          success: () => { if (ctx.status < 200 || ctx.status >= 300) throw new ScriptError(`se esperaba un status 2xx pero fue ${ctx.status}`); return undefined; },
          error: () => { if (ctx.status < 400) throw new ScriptError(`se esperaba un status 4xx/5xx pero fue ${ctx.status}`); return undefined; },
        }),
      }),
  });

  const log = nat((a) => { res.logs.push(a.map(toDisplay).join(" ")); return undefined; });

  const pm = new Host({
    response: responseHost,
    environment: varApi(),
    globals: varApi(),
    collectionVariables: varApi(),
    variables: varApi(),
    expect: nat(([v]) => makeExpect(v)),
    test: nat(([name, fn]) => {
      const title = toDisplay(name);
      try {
        callValue(fn, []);
        res.tests.push({ name: title, ok: true });
      } catch (e) {
        res.tests.push({ name: title, ok: false, error: errText(e) });
      }
      return undefined;
    }),
    info: new Host({ eventName: "test" }),
  });

  const legacy = (kind: "set" | "get" | "clear") =>
    nat(([k, v]) => (kind === "set" ? (setVar(k, v), undefined) : kind === "get" ? ctx.vars.get(String(k)) : (unsetVar(k), undefined)));
  const postman = new Host({
    setGlobalVariable: legacy("set"),
    setEnvironmentVariable: legacy("set"),
    getGlobalVariable: legacy("get"),
    getEnvironmentVariable: legacy("get"),
    clearGlobalVariable: legacy("clear"),
    clearEnvironmentVariable: legacy("clear"),
    setNextRequest: nat(() => undefined),
  });

  const jsonApi = new Host({
    parse: nat(([s]) => {
      try { return JSON.parse(String(s)); } catch { throw new ScriptError("JSON.parse: texto JSON inválido."); }
    }),
    stringify: nat(([v, , sp]) => JSON.stringify(v, null, typeof sp === "number" ? sp : undefined)),
  });
  const mathApi = new Host({
    floor: nat(([x]) => Math.floor(num(x))), ceil: nat(([x]) => Math.ceil(num(x))), round: nat(([x]) => Math.round(num(x))),
    abs: nat(([x]) => Math.abs(num(x))), max: nat((a) => Math.max(...a.map(num))), min: nat((a) => Math.min(...a.map(num))),
    random: nat(() => Math.random()), PI: Math.PI,
  });
  const globals = new Env(null, true);
  const g = (k: string, v: V) => globals.vars.set(k, v);
  g("pm", pm);
  g("postman", postman);
  g("console", new Host({ log, info: log, warn: log, error: log, debug: log }));
  g("JSON", jsonApi);
  g("Math", mathApi);
  g("responseBody", ctx.body);
  g("responseCode", new Host({ code: ctx.status, name: ctx.statusText }));
  g("responseTime", ctx.timeMs);
  g("responseHeaders", Object.fromEntries(ctx.headers.filter(([k]) => !FORBIDDEN.has(k))));
  g("tests", new Host({}, (k, v) => res.tests.push({ name: k, ok: !!v, error: v ? undefined : "falló" })));
  g("parseInt", nat(([s, r]) => parseInt(String(s), r === undefined ? 10 : num(r))));
  g("parseFloat", nat(([s]) => parseFloat(String(s))));
  g("Number", nat(([s]) => Number(s)));
  g("String", nat(([s]) => toDisplay(s)));
  g("Boolean", nat(([s]) => !!s));
  g("isNaN", nat(([s]) => Number.isNaN(Number(s))));
  g("encodeURIComponent", nat(([s]) => encodeURIComponent(String(s))));
  g("decodeURIComponent", nat(([s]) => decodeURIComponent(String(s))));
  g("btoa", nat(([s]) => btoa(String(s))));
  g("Array", new Host({ isArray: nat(([x]) => Array.isArray(x)) }));
  g("Object", new Host({
    keys: nat(([o]) => (isPlain(o) ? Object.keys(o) : [])),
    values: nat(([o]) => (isPlain(o) ? Object.values(o) : [])),
    entries: nat(([o]) => (isPlain(o) ? Object.entries(o) : [])),
  }));
  g("Date", new Host({ now: nat(() => Date.now()) }));
  g("NaN", NaN);
  g("Infinity", Infinity);

  const errText = (e: V): string =>
    e instanceof ScriptError || e instanceof Error ? e.message : e instanceof ThrowSignal ? toDisplay(e.value) : String(e);

  // ── propiedades y métodos permitidos sobre valores nativos ──
  const getProp = (obj: V, key: V): V => {
    if (obj === null || obj === undefined) throw new ScriptError(`No se puede leer '${String(key)}' de ${obj}`);
    const k = typeof key === "number" ? key : String(key);
    if (typeof k === "string" && FORBIDDEN.has(k)) return undefined;
    if (obj instanceof Host) return obj.get(String(k));
    if (typeof obj === "string") {
      const s = obj;
      if (k === "length") return s.length;
      if (typeof k === "number") return s[k];
      const m: Record<string, (a: V[]) => V> = {
        toString: () => s, trim: () => s.trim(), trimStart: () => s.trimStart(), trimEnd: () => s.trimEnd(),
        toLowerCase: () => s.toLowerCase(), toUpperCase: () => s.toUpperCase(),
        includes: ([x]) => s.includes(String(x)), startsWith: ([x]) => s.startsWith(String(x)), endsWith: ([x]) => s.endsWith(String(x)),
        indexOf: ([x]) => s.indexOf(String(x)), slice: ([a, b]) => s.slice(a as number, b as number | undefined),
        substring: ([a, b]) => s.substring(a as number, b as number | undefined), charAt: ([i]) => s.charAt(num(i)),
        split: ([x]) => (x === undefined ? [s] : s.split(String(x))), concat: (a) => s.concat(...a.map(String)),
        replace: ([a, b]) => s.replace(String(a), String(b)), replaceAll: ([a, b]) => s.split(String(a)).join(String(b)),
        padStart: ([n, p]) => s.padStart(num(n), p === undefined ? " " : String(p)), padEnd: ([n, p]) => s.padEnd(num(n), p === undefined ? " " : String(p)),
      };
      return own(m, k) ? nat(m[k]) : undefined;
    }
    if (typeof obj === "number") {
      if (k === "toFixed") return nat(([d]) => (obj as number).toFixed(d === undefined ? 0 : num(d)));
      if (k === "toString") return nat(() => String(obj));
      return undefined;
    }
    if (Array.isArray(obj)) {
      const a = obj;
      if (k === "length") return a.length;
      if (typeof k === "number" || /^\d+$/.test(k)) return a[Number(k)];
      const fnCall = (f: V, args: V[]) => callValue(f, args);
      const m: Record<string, (x: V[]) => V> = {
        push: (x) => a.push(...x), pop: () => a.pop(), join: ([s]) => a.map(toDisplay).join(s === undefined ? "," : String(s)),
        includes: ([x]) => a.some((y) => deepEq(y, x)), indexOf: ([x]) => a.findIndex((y) => deepEq(y, x)),
        slice: ([x, y]) => a.slice(x as number | undefined, y as number | undefined), concat: (x) => a.concat(...(x as V[][])),
        map: ([f]) => a.map((v, i) => fnCall(f, [v, i])), filter: ([f]) => a.filter((v, i) => !!fnCall(f, [v, i])),
        find: ([f]) => a.find((v, i) => !!fnCall(f, [v, i])), findIndex: ([f]) => a.findIndex((v, i) => !!fnCall(f, [v, i])),
        some: ([f]) => a.some((v, i) => !!fnCall(f, [v, i])), every: ([f]) => a.every((v, i) => !!fnCall(f, [v, i])),
        forEach: ([f]) => { a.forEach((v, i) => fnCall(f, [v, i])); return undefined; },
      };
      return own(m, k) ? nat(m[k]) : undefined;
    }
    if (isPlain(obj)) return own(obj, String(k)) ? obj[String(k)] : undefined;
    return undefined;
  };

  const setProp = (obj: V, key: V, val: V) => {
    const k = String(key);
    if (FORBIDDEN.has(k)) throw new ScriptError(`Propiedad no permitida: ${k}`);
    if (obj instanceof Host) {
      if (!obj.setter) throw new ScriptError("Este objeto es de solo lectura");
      obj.setter(k, val);
    } else if (Array.isArray(obj) || isPlain(obj)) (obj as Record<string, V>)[k] = val;
    else throw new ScriptError("No se puede asignar esa propiedad");
  };

  const callValue = (fn: V, args: V[]): V => {
    if (fn instanceof Native) return fn.fn(args);
    if (fn instanceof Closure) {
      const node = fn.node;
      const env = new Env(fn.env, true);
      node.params.forEach((p: string, i: number) => env.declare(p, args[i]));
      if (node.expr) return ev(node.body, env);
      try {
        execBlock(node.body.body, env);
      } catch (e) {
        if (e instanceof ReturnSignal) return e.value;
        throw e;
      }
      return undefined;
    }
    throw new ScriptError("El valor no es una función");
  };

  const ev = (n: N, env: Env): V => {
    if (++steps > MAX_STEPS) throw new ScriptError("El script excedió el límite de ejecución.");
    switch (n.k) {
      case "lit": return n.v;
      case "tpl": return n.q.reduce((acc: string, q: string, i: number) => acc + q + (i < n.e.length ? toDisplay(ev(n.e[i], env)) : ""), "");
      case "id": {
        const e = env.find(n.name);
        if (e) return e.vars.get(n.name);
        throw new ScriptError(`Línea ${n.line}: '${n.name}' no está definido`);
      }
      case "arr": return n.items.map((x: N) => ev(x, env));
      case "obj": {
        const o: Record<string, V> = {};
        for (const p of n.props) if (!FORBIDDEN.has(p.key)) o[p.key] = ev(p.val, env);
        return o;
      }
      case "fn": return new Closure(n, env);
      case "cond": return ev(n.c, env) ? ev(n.a, env) : ev(n.b, env);
      case "un": {
        if (n.op === "typeof") {
          if (n.e.k === "id" && !env.find(n.e.name)) return "undefined";
          const v = ev(n.e, env);
          return v instanceof Closure || v instanceof Native ? "function" : typeof v;
        }
        const v = ev(n.e, env);
        return n.op === "!" ? !v : n.op === "-" ? -num(v) : n.op === "void" ? undefined : +num(v);
      }
      case "bin": {
        if (n.op === "&&") { const l = ev(n.l, env); return l ? ev(n.r, env) : l; }
        if (n.op === "||") { const l = ev(n.l, env); return l ? l : ev(n.r, env); }
        if (n.op === "??") { const l = ev(n.l, env); return l ?? ev(n.r, env); }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const l = ev(n.l, env) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = ev(n.r, env) as any;
        switch (n.op) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return l * r;
          case "/": return l / r;
          case "%": return l % r;
          case "==": return l == r; // eslint-disable-line eqeqeq
          case "!=": return l != r; // eslint-disable-line eqeqeq
          case "===": return l === r;
          case "!==": return l !== r;
          case "<": return l < r;
          case ">": return l > r;
          case "<=": return l <= r;
          default: return l >= r;
        }
      }
      case "member": {
        const obj = ev(n.obj, env);
        if (n.opt && (obj === null || obj === undefined)) return undefined;
        return getProp(obj, n.computed ? ev(n.prop, env) : n.prop);
      }
      case "call": {
        const callee = ev(n.callee, env);
        if (n.opt && (callee === null || callee === undefined)) return undefined;
        if (!(callee instanceof Native) && !(callee instanceof Closure)) {
          const what = n.callee.k === "member" && !n.callee.computed ? n.callee.prop : n.callee.k === "id" ? n.callee.name : "valor";
          throw new ScriptError(`Línea ${n.line}: '${what}' no es una función o no está soportada en Caesar`);
        }
        return callValue(callee, n.args.map((a: N) => ev(a, env)));
      }
      case "assign": {
        let val = ev(n.val, env);
        const t = n.target;
        const cur = (): V => ev(t, env);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (n.op === "+=") val = (cur() as any) + (val as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else if (n.op === "-=") val = (cur() as any) - (val as any);
        if (t.k === "id") {
          const e = env.find(t.name);
          if (!e) throw new ScriptError(`Línea ${t.line}: '${t.name}' no está definido`);
          if (e === globals) throw new ScriptError(`Línea ${t.line}: no se puede reasignar '${t.name}'`);
          e.vars.set(t.name, val);
        } else setProp(ev(t.obj, env), t.computed ? ev(t.prop, env) : t.prop, val);
        return val;
      }
      default:
        throw new ScriptError("Expresión no soportada");
    }
  };

  const exec = (n: N, env: Env): void => {
    if (++steps > MAX_STEPS) throw new ScriptError("El script excedió el límite de ejecución.");
    switch (n.k) {
      case "empty": return;
      case "fundecl": env.declare(n.name, new Closure(n.fn, env), true); return;
      case "decl":
        for (const d of n.decls) env.declare(d.name, d.init ? ev(d.init, env) : undefined, n.isVar);
        return;
      case "expr": ev(n.e, env); return;
      case "if":
        if (ev(n.cond, env)) exec(n.then, env);
        else if (n.els) exec(n.els, env);
        return;
      case "block": execBlock(n.body, new Env(env, false)); return;
      case "return": throw new ReturnSignal(n.val ? ev(n.val, env) : undefined);
      case "throw": throw new ThrowSignal(ev(n.val, env));
      case "try":
        try {
          exec(n.body, env);
        } catch (e) {
          if (e instanceof ReturnSignal || !n.handler) throw e;
          const henv = new Env(env, false);
          if (n.param) henv.declare(n.param, e instanceof ThrowSignal ? e.value : errText(e));
          exec(n.handler, henv);
        } finally {
          if (n.fin) exec(n.fin, env);
        }
        return;
      default: throw new ScriptError("Sentencia no soportada");
    }
  };

  const execBlock = (body: N[], env: Env) => {
    for (const s of body) if (s.k === "fundecl") env.declare(s.name, new Closure(s.fn, env), true); // hoisting
    for (const s of body) if (s.k !== "fundecl") exec(s, env);
  };

  // ── ejecución ──
  let ast: N[] = [];
  try {
    ast = new Parser(tokenize(source)).program(res.errors);
  } catch (e) {
    res.errors.push(errText(e));
    return res;
  }
  const top = new Env(globals, true);
  for (const s of ast) if (s.k === "fundecl") top.declare(s.name, new Closure(s.fn, top), true);
  for (const s of ast) {
    if (s.k === "fundecl") continue;
    try {
      exec(s, top);
    } catch (e) {
      if (e instanceof ReturnSignal) break;
      const line = s.line ? `Línea ${s.line}: ` : "";
      const msg = errText(e);
      res.errors.push(msg.startsWith("Línea") ? msg : line + msg);
      if (steps > MAX_STEPS) break;
    }
  }
  return res;
}
