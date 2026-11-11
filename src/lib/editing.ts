import type { ClipboardEvent, KeyboardEvent } from "react";

/**
 * Ayudas de edición para el textarea de código: cierre automático de {}, [], (), comillas,
 * autoindentado al pulsar Enter, Tab = 2 espacios y pegado de JSON con formato.
 * Todo se inserta con execCommand("insertText") para que Ctrl+Z siga funcionando.
 */

const INDENT = "  ";
const CLOSERS = "}])";
const OPENERS = "{[(";

/** Pares activos a partir de una cadena como `{}[]()""` (2 caracteres por par). */
export function parsePairs(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < spec.length; i += 2) out[spec[i]] = spec[i + 1];
  return out;
}

function insert(t: HTMLTextAreaElement, text: string) {
  t.focus();
  const ok = text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text);
  if (!ok) {
    // Alternativa sin historial de deshacer (execCommand no disponible)
    t.setRangeText(text, t.selectionStart, t.selectionEnd, "end");
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

const isWord = (c: string) => /[\w]/.test(c);
/** Se puede abrir un par aquí: no hay texto pegado a la derecha. */
const okNext = (c: string) => c === "" || /\s/.test(c) || ")]},;:>".includes(c);

function indentLines(t: HTMLTextAreaElement, outdent: boolean) {
  const v = t.value;
  const s = t.selectionStart;
  const en = t.selectionEnd;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  let le = v.indexOf("\n", en);
  if (le < 0) le = v.length;
  const lines = v.slice(ls, le).split("\n");
  const out = lines.map((l) => (outdent ? l.replace(/^( {1,2}|\t)/, "") : INDENT + l));
  const block = out.join("\n");
  const firstDelta = out[0].length - lines[0].length;
  const totalDelta = block.length - (le - ls);
  t.setSelectionRange(ls, le);
  insert(t, block);
  const ns = Math.max(ls, s + firstDelta);
  t.setSelectionRange(ns, Math.max(ns, en + totalDelta));
}

/** Devuelve true si la tecla se ha gestionado (hay que llamar a preventDefault, ya hecho aquí). */
export function handleEditKey(e: KeyboardEvent<HTMLTextAreaElement>, pairs: Record<string, string>): boolean {
  const ne = e.nativeEvent;
  if (ne.isComposing) return false;
  // Ctrl/Meta solos son atajos; Ctrl+Alt (AltGr, p. ej. "{" en teclado español) sí escribe caracteres.
  if (e.metaKey || (e.ctrlKey && !e.altKey) || (e.altKey && !e.ctrlKey)) return false;

  const t = e.currentTarget;
  const v = t.value;
  const s = t.selectionStart;
  const en = t.selectionEnd;
  const key = e.key;
  const prev = v[s - 1] ?? "";
  const next = v[en] ?? "";
  const collapsed = s === en;
  const done = () => {
    e.preventDefault();
    return true;
  };

  // ── Enter: autoindentar (y abrir el bloque si estamos entre {} [] ()) ──
  if (key === "Enter" && !e.shiftKey) {
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const indent = /^[ \t]*/.exec(v.slice(ls, s))![0];
    if (OPENERS.includes(prev) && collapsed && pairs[prev] === next) {
      insert(t, `\n${indent}${INDENT}\n${indent}`);
      const caret = s + 1 + indent.length + INDENT.length;
      t.setSelectionRange(caret, caret);
    } else if (OPENERS.includes(prev)) {
      insert(t, `\n${indent}${INDENT}`);
    } else {
      insert(t, `\n${indent}`);
    }
    return done();
  }

  // ── Tab / Shift+Tab: sangrar ──
  if (key === "Tab") {
    const multi = !collapsed && v.slice(s, en).includes("\n");
    if (multi || e.shiftKey) indentLines(t, e.shiftKey);
    else insert(t, INDENT);
    return done();
  }

  // ── Backspace entre un par vacío: borra ambos ──
  if (key === "Backspace" && collapsed && prev && pairs[prev] === next) {
    t.setSelectionRange(s - 1, s + 1);
    insert(t, "");
    return done();
  }

  // ── Cierre escrito a mano: saltar el que ya existe o reducir la sangría ──
  if (key.length === 1 && CLOSERS.includes(key) && collapsed) {
    if (next === key) {
      t.setSelectionRange(s + 1, s + 1);
      return done();
    }
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const before = v.slice(ls, s);
    if (before.length >= INDENT.length && /^ +$/.test(before) && before.endsWith(INDENT) && (key === "}" || key === "]")) {
      t.setSelectionRange(s - INDENT.length, s);
      insert(t, key);
      return done();
    }
    return false;
  }

  // ── Apertura: insertar par (o envolver la selección) ──
  if (key.length === 1 && pairs[key] !== undefined) {
    const close = pairs[key];
    const symmetric = close === key; // comillas
    if (!collapsed) {
      const sel = v.slice(s, en);
      insert(t, key + sel + close);
      t.setSelectionRange(s + 1, s + 1 + sel.length);
      return done();
    }
    if (symmetric) {
      if (next === key) {
        t.setSelectionRange(s + 1, s + 1); // cerrar la comilla ya existente
        return done();
      }
      if (isWord(prev) || prev === "\\" || prev === key || !okNext(next)) return false;
    } else if (!okNext(next)) {
      return false;
    }
    insert(t, key + close);
    t.setSelectionRange(s + 1, s + 1);
    return done();
  }

  return false;
}

/** Pegar JSON válido en un editor vacío (o con todo seleccionado): lo deja formateado. */
export function handlePasteJson(e: ClipboardEvent<HTMLTextAreaElement>): boolean {
  const t = e.currentTarget;
  const wholeReplaced = t.value.trim() === "" || (t.selectionStart === 0 && t.selectionEnd === t.value.length);
  if (!wholeReplaced) return false;
  const text = e.clipboardData.getData("text");
  if (!/^\s*[[{]/.test(text)) return false;
  try {
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    e.preventDefault();
    t.select();
    insert(t, pretty);
    return true;
  } catch {
    return false;
  }
}
