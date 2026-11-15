import { useSyncExternalStore } from "react";

/**
 * Ajuste global del visor JSON: qué copia por defecto el icono de copiar y Ctrl/Cmd+C sobre un nodo.
 * El clic derecho siempre ofrece las dos opciones. Se guarda en el equipo y se comparte entre componentes (store mínimo, sin dependencias).
 */
export type JsonCopyMode = "value" | "path";

const KEY = "caesar.jsonCopy";
const listeners = new Set<() => void>();

function load(): JsonCopyMode {
  try {
    return localStorage.getItem(KEY) === "path" ? "path" : "value";
  } catch {
    return "value";
  }
}
let current: JsonCopyMode = load();

export function setJsonCopyMode(m: JsonCopyMode) {
  current = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((f) => f());
}

export const getJsonCopyMode = () => current;

export function useJsonCopyMode(): JsonCopyMode {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

// ───────────── Ruta (JSONPath) de una línea del JSON con formato ─────────────

const IDENT = /^[A-Za-z_$][\w$]*$/;
const KEY_RE = /^("(?:[^"\\]|\\.)*")\s*:/;

interface Frame {
  kind: "obj" | "arr";
  seg: string | number | null;
  next: number;
}

/** Ruta tipo `data.users[2].id` de la línea `i` de un JSON con una pieza por línea. Raíz = "$". Función pura (con tests). */
export function pathOfLine(lines: string[], i: number): string {
  const stack: Frame[] = [];
  const segOf = (t: string): string | number | null => {
    const top = stack[stack.length - 1];
    if (!top) return null;
    if (top.kind === "arr") return top.next++;
    const m = KEY_RE.exec(t);
    if (!m) return null;
    try {
      return JSON.parse(m[1]) as string;
    } catch {
      return m[1].slice(1, -1);
    }
  };
  const fmt = (): string => {
    let out = "";
    for (const f of stack) {
      if (f.seg === null) continue;
      if (typeof f.seg === "number") out += `[${f.seg}]`;
      else out += IDENT.test(f.seg) ? (out ? `.${f.seg}` : f.seg) : `[${JSON.stringify(f.seg)}]`;
    }
    return out;
  };
  for (let j = 0; j < lines.length && j <= i; j++) {
    const t = lines[j].trim();
    if (/^[}\]]/.test(t)) {
      if (j === i) return fmt() || "$"; // la línea de cierre apunta al propio contenedor
      stack.pop();
      continue;
    }
    const seg = segOf(t);
    const opens = /[{[]$/.test(t);
    if (j === i) {
      const own = fmt();
      const add = seg === null ? "" : typeof seg === "number" ? `[${seg}]` : IDENT.test(seg) ? (own ? `.${seg}` : seg) : `[${JSON.stringify(seg)}]`;
      return own + add || "$";
    }
    if (opens) stack.push({ kind: t.endsWith("[") ? "arr" : "obj", seg, next: 0 });
  }
  return "$";
}
