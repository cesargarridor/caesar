/**
 * Atajos de teclado totalmente editables. Cada comando de la app tiene una lista de combinaciones (por defecto las de siempre);
 * el usuario puede cambiarlas, quitarlas, añadir varias, crear acciones propias (varios comandos seguidos) y elegir qué
 * comandos aparecen como botones junto a la URL. Todo se guarda en local. Este módulo no depende de React ni del DOM
 * (salvo `localStorage` y `window` dentro de funciones), para poder probarlo con `node --test`.
 */

export interface CommandDef {
  id: string;
  /** Texto en español (se traduce al mostrarlo). */
  label: string;
  /** Combinaciones por defecto. */
  defaults: string[];
}

const goto = (n: number): CommandDef => ({ id: `gotoTab${n}`, label: `Ir a la pestaña ${n}`, defaults: [`Ctrl+${n}`] });

/** Comandos de la app. El orden es el de la lista de Ajustes. */
export const COMMANDS: CommandDef[] = [
  { id: "save", label: "Guardar la petición en la colección", defaults: ["Ctrl+S"] },
  { id: "send", label: "Enviar la petición", defaults: ["Ctrl+Enter"] },
  { id: "copyCurl", label: "Copiar la petición como cURL", defaults: [] },
  { id: "newTab", label: "Nueva pestaña", defaults: ["Ctrl+T"] },
  { id: "closeTab", label: "Cerrar la pestaña", defaults: ["Ctrl+W"] },
  { id: "nextTab", label: "Pestaña siguiente", defaults: ["Ctrl+Tab", "Ctrl+PageDown"] },
  { id: "prevTab", label: "Pestaña anterior", defaults: ["Ctrl+Shift+Tab", "Ctrl+PageUp"] },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(goto),
  { id: "historyBack", label: "Volver a la pestaña visitada antes", defaults: ["Alt+ArrowLeft"] },
  { id: "historyForward", label: "Avanzar a la pestaña visitada después", defaults: ["Alt+ArrowRight"] },
  { id: "focusUrl", label: "Ir a la barra de URL", defaults: ["Ctrl+L"] },
  { id: "find", label: "Buscar en la respuesta o en el editor", defaults: ["Ctrl+F"] },
  { id: "varPicker", label: "Elegir una variable de entorno", defaults: ["Ctrl+Space"] },
  { id: "settings", label: "Abrir los ajustes", defaults: ["Ctrl+,"] },
  { id: "shortcuts", label: "Ver y editar los atajos", defaults: ["Ctrl+/"] },
];

/** Acción propia: una lista de comandos que se ejecutan seguidos. */
export interface UserAction {
  id: string; // "user:..."
  name: string;
  steps: string[];
}

interface Stored {
  /** id → combinaciones elegidas (reemplazan a las de por defecto; [] = sin atajo). */
  overrides: Record<string, string[]>;
  actions: UserAction[];
  /** Comandos/acciones que aparecen como botón junto a la URL, en orden. */
  toolbar: string[];
}

const KEY = "caesar.keymap";
const EMPTY: Stored = { overrides: {}, actions: [], toolbar: [] };

const isUser = (id: string) => id.startsWith("user:");
const builtin = new Map(COMMANDS.map((c) => [c.id, c]));

// ───────── combinaciones ─────────

const MODS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "Dead", "OS", "Hyper", "Super", "CapsLock"]);

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** AltGr (en Windows llega como Ctrl+Alt): se ignora, es solo para escribir símbolos. */
  altGr?: boolean;
}

/** Combinación normalizada de un evento ("Ctrl+Shift+F"). Ctrl y Cmd cuentan igual. null si solo son modificadores. */
export function comboFromEvent(e: KeyLike): string | null {
  if (e.altGr || MODS.has(e.key)) return null;
  let k = e.key;
  if (k === " ") k = "Space";
  else if (k.length === 1) k = k.toUpperCase();
  const symbol = k.length === 1 && !/[A-Z0-9]/.test(k); // con símbolos Shift ya viene dentro de la tecla ("?" = Mayús+/)
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && !symbol) parts.push("Shift");
  parts.push(k);
  return parts.join("+");
}

/** Normaliza una combinación escrita a mano ("ctrl + shift + f" → "Ctrl+Shift+F"). */
export function normalizeCombo(c: string): string {
  const parts = c.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const out: string[] = [];
  if (mods.has("ctrl") || mods.has("cmd") || mods.has("meta")) out.push("Ctrl");
  if (mods.has("alt")) out.push("Alt");
  if (mods.has("shift")) out.push("Shift");
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join("+");
}

/** Para no romper la escritura, un atajo necesita Ctrl o Alt (o ser una tecla F1–F12). */
export function isValidCombo(c: string): boolean {
  const parts = c.split("+");
  const key = parts[parts.length - 1];
  if (!key) return false;
  if (/^F([1-9]|1[0-2])$/.test(key)) return true;
  return parts.includes("Ctrl") || parts.includes("Alt");
}

const KEY_NAMES: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", PageUp: "RePág", PageDown: "AvPág", Escape: "Esc" };
/** Texto para mostrar en pantalla ("Ctrl+←"). */
export const prettyCombo = (c: string) => c.split("+").map((p) => KEY_NAMES[p] ?? p).join("+");

// ───────── almacenamiento ─────────

let cache: Stored | null = null;
let version = 0;
const subs = new Set<() => void>();

function sanitize(raw: unknown): Stored {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Stored>;
  const overrides: Record<string, string[]> = {};
  if (r.overrides && typeof r.overrides === "object") {
    for (const [id, v] of Object.entries(r.overrides)) {
      if (Array.isArray(v)) overrides[id] = v.filter((c) => typeof c === "string").map(normalizeCombo).filter(isValidCombo);
    }
  }
  const actions: UserAction[] = Array.isArray(r.actions)
    ? r.actions
        .filter((a) => a && typeof a.id === "string" && isUser(a.id) && typeof a.name === "string" && Array.isArray(a.steps))
        .map((a) => ({ id: a.id, name: a.name.slice(0, 60), steps: a.steps.filter((s) => typeof s === "string" && builtin.has(s)) }))
    : [];
  const known = (id: string) => builtin.has(id) || actions.some((a) => a.id === id);
  const toolbar = Array.isArray(r.toolbar) ? [...new Set(r.toolbar.filter((id) => typeof id === "string" && known(id)))] : [];
  return { overrides, actions, toolbar };
}

function load(): Stored {
  if (cache) return cache;
  let raw: unknown = null;
  try {
    const s = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null;
  }
  cache = raw ? sanitize(raw) : { ...EMPTY, overrides: {}, actions: [], toolbar: [] };
  return cache;
}

function commit(next: Stored) {
  cache = sanitize(next);
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* sin almacenamiento: queda en memoria durante la sesión */
  }
  subs.forEach((f) => f());
}

/** Solo para pruebas: vacía la memoria. */
export function _resetForTests() {
  cache = null;
  version++;
}

export const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
export const getVersion = () => version;

// ───────── consulta ─────────

/** Todos los comandos (de la app y acciones propias) con su nombre. */
export function allCommands(): { id: string; label: string; user: boolean }[] {
  return [...COMMANDS.map((c) => ({ id: c.id, label: c.label, user: false })), ...load().actions.map((a) => ({ id: a.id, label: a.name, user: true }))];
}

export const getActions = () => load().actions;
export const getToolbar = () => load().toolbar;

/** Combinaciones activas de un comando (las elegidas por el usuario o, si no hay, las de por defecto). */
export function getCombos(id: string): string[] {
  const s = load();
  if (id in s.overrides) return s.overrides[id];
  return builtin.get(id)?.defaults ?? [];
}

export const isCustomized = (id: string) => id in load().overrides;

/** Comando que tiene esa combinación (null si ninguno). */
export function commandFor(combo: string): string | null {
  for (const c of allCommands()) if (getCombos(c.id).includes(combo)) return c.id;
  return null;
}

/** Pasos que ejecuta un comando: él mismo, o los de la acción propia. */
export function stepsOf(id: string): string[] {
  if (!isUser(id)) return builtin.has(id) ? [id] : [];
  return load().actions.find((a) => a.id === id)?.steps ?? [];
}

// ───────── cambios ─────────

/**
 * Asigna una combinación a un comando. Si otro comando la tenía, se la quita (devuelve su id para avisar al usuario).
 */
export function assignCombo(id: string, combo: string): { ok: boolean; displaced: string | null; reason?: string } {
  const c = normalizeCombo(combo);
  if (!isValidCombo(c)) return { ok: false, displaced: null, reason: "invalid" };
  const s = load();
  const other = commandFor(c);
  const overrides = { ...s.overrides };
  if (other && other !== id) overrides[other] = getCombos(other).filter((x) => x !== c);
  const mine = getCombos(id);
  overrides[id] = mine.includes(c) ? mine : [...mine, c];
  commit({ ...s, overrides });
  return { ok: true, displaced: other && other !== id ? other : null };
}

export function removeCombo(id: string, combo: string) {
  const s = load();
  commit({ ...s, overrides: { ...s.overrides, [id]: getCombos(id).filter((c) => c !== combo) } });
}

export function resetCommand(id: string) {
  const s = load();
  const overrides = { ...s.overrides };
  delete overrides[id];
  commit({ ...s, overrides });
}

export function resetAll() {
  const s = load();
  commit({ ...s, overrides: {} });
}

export function setToolbar(ids: string[]) {
  commit({ ...load(), toolbar: ids });
}
export function toggleToolbar(id: string) {
  const t = load().toolbar;
  setToolbar(t.includes(id) ? t.filter((x) => x !== id) : [...t, id]);
}

export function saveAction(a: { id?: string; name: string; steps: string[] }): string {
  const s = load();
  const id = a.id && isUser(a.id) ? a.id : "user:" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const action: UserAction = { id, name: a.name.trim() || "Acción", steps: a.steps };
  const exists = s.actions.some((x) => x.id === id);
  commit({ ...s, actions: exists ? s.actions.map((x) => (x.id === id ? action : x)) : [...s.actions, action] });
  return id;
}

export function deleteAction(id: string) {
  const s = load();
  const overrides = { ...s.overrides };
  delete overrides[id];
  commit({ overrides, actions: s.actions.filter((a) => a.id !== id), toolbar: s.toolbar.filter((x) => x !== id) });
}

// ───────── despachador global ─────────

let recording = false;
/** Mientras el usuario está grabando un atajo nuevo en Ajustes, los atajos normales no deben dispararse. */
export const setRecording = (on: boolean) => {
  recording = on;
};

/**
 * Escucha el teclado en toda la ventana y llama a `run(id)` con el comando cuyo atajo se pulsó. Devuelve la función que lo quita.
 * `run` recibe ids de comandos de la app o de acciones propias (`user:…`).
 */
export function installKeymap(run: (id: string) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (recording) return;
    const combo = comboFromEvent({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, altGr: e.getModifierState?.("AltGraph") });
    if (!combo) return;
    const id = commandFor(combo);
    if (!id) return;
    e.preventDefault();
    run(id);
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
