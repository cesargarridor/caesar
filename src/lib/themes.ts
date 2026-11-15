import { useSyncExternalStore } from "react";

/** Temas de Caesar. Los colores de método (GET/POST/PUT/PATCH/DELETE) NO viven aquí: son fijos en todos los estilos. */

export interface JsonPalette {
  key: string; str: string; num: string; bool: string; nul: string; punc: string;
}

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  ui: {
    abyss: string;   // fondo principal
    deep: string;    // sidebar / panel de respuesta
    kelp: string;    // campos y tarjetas
    mist: string;    // texto fuerte
    silver: string;  // texto normal
    slate: string;   // texto apagado
    iris: string;    // botón principal
    onprimary: string;
    accent: string;  // foco, enlaces
    hl: string;      // cifras / énfasis
    ok: string;      // éxito (verde)
    bad: string;     // error (rojo)
  };
  /** Colores del JSON de la respuesta */
  resp: JsonPalette & { link: string };
  /** Colores del JSON del body (distintos a los de la respuesta) */
  body: JsonPalette;
  grad: [string, string, string]; // degradado "cósmico" para acentos de texto
  stars: number;                  // opacidad del campo de estrellas (0 = sin estrellas)
}

const DARK_SEM = { ok: "#3ddc97", bad: "#ff5c6c" };

export const THEMES: Theme[] = [
  {
    id: "caesar", name: "Caesar (predeterminado)", dark: true,
    ui: { abyss: "#0d0d0d", deep: "#141414", kelp: "#1b1b1b", mist: "#ededed", silver: "#c4c4c4", slate: "#8a8a8a", iris: "#d8571f", onprimary: "#ffffff", accent: "#f0883e", hl: "#f2b35e", ...DARK_SEM },
    resp: { key: "#79b8ff", str: "#9ecb7b", num: "#f2a65a", bool: "#d2a8ff", nul: "#7d8590", punc: "#7d8590", link: "#f0883e" },
    body: { key: "#7aa2f7", str: "#e0af68", num: "#ff9e64", bool: "#bb9af7", nul: "#6a739f", punc: "#565f89" },
    grad: ["#f2b35e", "#f0883e", "#d8571f"], stars: 0,
  },
  {
    id: "monokai", name: "Monokai", dark: true,
    ui: { abyss: "#272822", deep: "#1e1f1c", kelp: "#3e3d32", mist: "#f8f8f2", silver: "#cfcfc2", slate: "#a8a8a4", iris: "#f92672", onprimary: "#000000", accent: "#a6e22e", hl: "#e6db74", ...DARK_SEM, bad: "#ff808c"},
    resp: { key: "#66d9ef", str: "#e6db74", num: "#ae81ff", bool: "#f92672", nul: "#fd971f", punc: "#90908a", link: "#a6e22e" },
    body: { key: "#a6e22e", str: "#fd971f", num: "#ae81ff", bool: "#f92672", nul: "#90908a", punc: "#75715e" },
    grad: ["#f92672", "#fd971f", "#a6e22e"], stars: 0,
  },
  {
    id: "catppuccin-mocha", name: "Catppuccin Mocha", dark: true,
    ui: { abyss: "#1e1e2e", deep: "#181825", kelp: "#313244", mist: "#cdd6f4", silver: "#bac2de", slate: "#9399b2", iris: "#cba6f7", onprimary: "#1e1e2e", accent: "#89b4fa", hl: "#f9e2af", ok: "#a6e3a1", bad: "#f38ba8" },
    resp: { key: "#89b4fa", str: "#a6e3a1", num: "#fab387", bool: "#cba6f7", nul: "#7f849c", punc: "#7f849c", link: "#94e2d5" },
    body: { key: "#f5c2e7", str: "#f9e2af", num: "#fab387", bool: "#89dceb", nul: "#7f849c", punc: "#6c7086" },
    grad: ["#f5c2e7", "#cba6f7", "#89b4fa"], stars: 0,
  },
  {
    id: "gruvbox-dark", name: "Gruvbox Dark", dark: true,
    ui: { abyss: "#282828", deep: "#1d2021", kelp: "#3c3836", mist: "#ebdbb2", silver: "#d5c4a1", slate: "#a89984", iris: "#d79921", onprimary: "#1d2021", accent: "#fabd2f", hl: "#fe8019", ok: "#b8bb26", bad: "#fb4934" },
    resp: { key: "#83a598", str: "#b8bb26", num: "#d3869b", bool: "#fb4934", nul: "#928374", punc: "#928374", link: "#8ec07c" },
    body: { key: "#fe8019", str: "#b8bb26", num: "#d3869b", bool: "#83a598", nul: "#928374", punc: "#7c6f64" },
    grad: ["#fe8019", "#fabd2f", "#b8bb26"], stars: 0,
  },
  {
    id: "github-dark", name: "GitHub Dark", dark: true,
    ui: { abyss: "#0d1117", deep: "#010409", kelp: "#161b22", mist: "#e6edf3", silver: "#c9d1d9", slate: "#8b949e", iris: "#238636", onprimary: "#ffffff", accent: "#58a6ff", hl: "#d29922", ok: "#3fb950", bad: "#ff7b72" },
    resp: { key: "#79c0ff", str: "#a5d6ff", num: "#ffa657", bool: "#ff7b72", nul: "#8b949e", punc: "#8b949e", link: "#7ee787" },
    body: { key: "#d2a8ff", str: "#a5d6ff", num: "#ffa657", bool: "#ff7b72", nul: "#8b949e", punc: "#6e7681" },
    grad: ["#58a6ff", "#d2a8ff", "#ff7b72"], stars: 0,
  },
  {
    id: "arcade", name: "Arcade / Retro Neon", dark: true,
    ui: { abyss: "#07060f", deep: "#04040b", kelp: "#14112b", mist: "#f2f6ff", silver: "#c7cdf0", slate: "#8e92c4", iris: "#ff6a00", onprimary: "#07060f", accent: "#00f0ff", hl: "#ff2bd6", ok: "#39ff14", bad: "#ff3b6b" },
    resp: { key: "#00f0ff", str: "#39ff14", num: "#ff9a1f", bool: "#ff2bd6", nul: "#8e92c4", punc: "#7a7fb5", link: "#39ff14" },
    body: { key: "#ff2bd6", str: "#c6ff3d", num: "#ff9a1f", bool: "#00f0ff", nul: "#8e92c4", punc: "#6a6fa5" },
    grad: ["#00f0ff", "#ff2bd6", "#ff9a1f"], stars: 0.5,
  },
  {
    id: "monokai-light", name: "Monokai Light", dark: false,
    ui: { abyss: "#fafafa", deep: "#f0f0ec", kelp: "#e5e5de", mist: "#272822", silver: "#49483e", slate: "#696655", iris: "#f92672", onprimary: "#000000", accent: "#087083", hl: "#935800", ok: "#137242", bad: "#c12535" },
    resp: { key: "#00809a", str: "#8a7b00", num: "#7a4fd6", bool: "#d6226a", nul: "#b36b00", punc: "#75715e", link: "#4d8a00" },
    body: { key: "#5c8f00", str: "#c26a00", num: "#7a4fd6", bool: "#d6226a", nul: "#75715e", punc: "#a59f85" },
    grad: ["#f92672", "#fd971f", "#a6e22e"], stars: 0,
  },
  {
    id: "dracula", name: "Dracula", dark: true,
    ui: { abyss: "#282a36", deep: "#21222c", kelp: "#343746", mist: "#f8f8f2", silver: "#d6d6e0", slate: "#969fcb", iris: "#bd93f9", onprimary: "#282a36", accent: "#bd93f9", hl: "#f1fa8c", ...DARK_SEM, bad: "#ff7381"},
    resp: { key: "#8be9fd", str: "#f1fa8c", num: "#bd93f9", bool: "#ff79c6", nul: "#ffb86c", punc: "#6272a4", link: "#50fa7b" },
    body: { key: "#ff79c6", str: "#50fa7b", num: "#ffb86c", bool: "#bd93f9", nul: "#6272a4", punc: "#6272a4" },
    grad: ["#ff79c6", "#bd93f9", "#8be9fd"], stars: 0.35,
  },
  {
    id: "tokyo-night", name: "Tokyo Night", dark: true,
    ui: { abyss: "#1a1b26", deep: "#16161e", kelp: "#24283b", mist: "#c0caf5", silver: "#a9b1d6", slate: "#868eb8", iris: "#7aa2f7", onprimary: "#1a1b26", accent: "#7aa2f7", hl: "#e0af68", ...DARK_SEM },
    resp: { key: "#7aa2f7", str: "#e0af68", num: "#ff9e64", bool: "#bb9af7", nul: "#6a739f", punc: "#6a739f", link: "#73daca" },
    body: { key: "#bb9af7", str: "#9ece6a", num: "#ff9e64", bool: "#7dcfff", nul: "#6a739f", punc: "#565f89" },
    grad: ["#bb9af7", "#7aa2f7", "#7dcfff"], stars: 0.45,
  },
  {
    id: "nord", name: "Nord", dark: true,
    ui: { abyss: "#2e3440", deep: "#272c36", kelp: "#3b4252", mist: "#eceff4", silver: "#d8dee9", slate: "#a5afc2", iris: "#88c0d0", onprimary: "#2e3440", accent: "#88c0d0", hl: "#ebcb8b", ...DARK_SEM, bad: "#ff8d98"},
    resp: { key: "#81a1c1", str: "#ebcb8b", num: "#b48ead", bool: "#d08770", nul: "#8f9bb3", punc: "#7b88a1", link: "#a3be8c" },
    body: { key: "#a3be8c", str: "#d08770", num: "#b48ead", bool: "#81a1c1", nul: "#7b88a1", punc: "#616e88" },
    grad: ["#88c0d0", "#81a1c1", "#b48ead"], stars: 0.3,
  },
  {
    id: "one-dark", name: "One Dark Pro", dark: true,
    ui: { abyss: "#282c34", deep: "#21252b", kelp: "#323842", mist: "#dcdfe4", silver: "#abb2bf", slate: "#9ba1ae", iris: "#61afef", onprimary: "#1e222a", accent: "#61afef", hl: "#e5c07b", ...DARK_SEM, bad: "#ff7381"},
    resp: { key: "#61afef", str: "#e5c07b", num: "#d19a66", bool: "#c678dd", nul: "#7f8697", punc: "#7f8697", link: "#98c379" },
    body: { key: "#e06c75", str: "#98c379", num: "#d19a66", bool: "#56b6c2", nul: "#7f8697", punc: "#5c6370" },
    grad: ["#e06c75", "#c678dd", "#61afef"], stars: 0,
  },
  {
    id: "github-light", name: "GitHub Light", dark: false,
    ui: { abyss: "#ffffff", deep: "#f6f8fa", kelp: "#eaeef2", mist: "#1f2328", silver: "#424a53", slate: "#636b74", iris: "#0969da", onprimary: "#ffffff", accent: "#0967d6", hl: "#916100", ok: "#197c36", bad: "#cf222e" },
    resp: { key: "#0550ae", str: "#9a6700", num: "#8250df", bool: "#cf222e", nul: "#6e7781", punc: "#6e7781", link: "#1a7f37" },
    body: { key: "#8250df", str: "#116329", num: "#953800", bool: "#0550ae", nul: "#6e7781", punc: "#8c959f" },
    grad: ["#0969da", "#8250df", "#bf3989"], stars: 0,
  },
];

export const DEFAULT_THEME = "caesar";
export const DEFAULT_LIGHT_THEME = "github-light";

export type ColorMode = "light" | "dark" | "system";

interface ThemePrefs { mode: ColorMode; dark: string; light: string }
export interface ThemeState extends ThemePrefs { /** Tema realmente aplicado ahora. */ themeId: string; /** El SO está en oscuro. */ systemDark: boolean }

const K_MODE = "caesar.colorMode", K_DARK = "caesar.themeDark", K_LIGHT = "caesar.themeLight", K_OLD = "caesar.theme";

const find = (id: string | null | undefined) => THEMES.find((t) => t.id === id);
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

function loadPrefs(): ThemePrefs {
  const p: ThemePrefs = { mode: "system", dark: DEFAULT_THEME, light: DEFAULT_LIGHT_THEME };
  const m = get(K_MODE);
  if (m === "light" || m === "dark" || m === "system") p.mode = m;
  const d = find(get(K_DARK)), l = find(get(K_LIGHT));
  if (d?.dark) p.dark = d.id;
  if (l && !l.dark) p.light = l.id;
  // Migración: antes había un solo tema; se respeta fijando el modo a su luminosidad.
  const old = find(get(K_OLD));
  if (old && !m) {
    if (old.dark) p.dark = old.id; else p.light = old.id;
    p.mode = old.dark ? "dark" : "light";
  }
  return p;
}

const mq: MediaQueryList | null = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let prefs = loadPrefs();
let state: ThemeState = compute();
const listeners = new Set<() => void>();

function compute(): ThemeState {
  const systemDark = mq ? mq.matches : true;
  const dark = prefs.mode === "system" ? systemDark : prefs.mode === "dark";
  return { ...prefs, systemDark, themeId: dark ? prefs.dark : prefs.light };
}

function refresh() {
  state = compute();
  applyTheme(state.themeId);
  listeners.forEach((f) => f());
}

let started = false;
/** Aplica el tema y escucha los cambios del modo claro/oscuro del sistema operativo (sin recargar). */
export function initTheme() {
  if (started) return;
  started = true;
  mq?.addEventListener("change", () => { if (prefs.mode === "system") refresh(); else { state = compute(); listeners.forEach((f) => f()); } });
  refresh();
}

export function setColorMode(mode: ColorMode) {
  prefs = { ...prefs, mode };
  put(K_MODE, mode);
  refresh();
}

/** Elige un tema: lo guarda en su hueco (oscuro o claro). Si no encaja con el modo actual, pasa a ese modo. */
export function chooseTheme(id: string) {
  const th = find(id);
  if (!th) return;
  prefs = { ...prefs, [th.dark ? "dark" : "light"]: id };
  put(th.dark ? K_DARK : K_LIGHT, id);
  const nowDark = prefs.mode === "system" ? (mq ? mq.matches : true) : prefs.mode === "dark";
  if (nowDark !== th.dark) {
    prefs.mode = th.dark ? "dark" : "light";
    put(K_MODE, prefs.mode);
  }
  refresh();
}

export function useTheme() {
  const st = useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => state);
  return { ...st, setMode: setColorMode, choose: chooseTheme };
}

/** Vuelca el tema a variables CSS y clases en <html> (.theme-dark / .theme-light / .theme-<id>). */
export function applyTheme(id: string) {
  const t = find(id) ?? THEMES[0];
  const root = document.documentElement;
  const s = root.style;
  const set = (k: string, v: string) => s.setProperty(`--t-${k}`, v);
  const u = t.ui;
  set("abyss", u.abyss); set("deep", u.deep); set("kelp", u.kelp);
  set("mist", u.mist); set("silver", u.silver); set("slate", u.slate);
  set("iris", u.iris); set("onprimary", u.onprimary); set("accent", u.accent);
  set("hl", u.hl); set("ok", u.ok); set("bad", u.bad);
  set("fg", t.dark ? "#ffffff" : "#000000");
  (Object.keys(t.resp) as (keyof Theme["resp"])[]).forEach((k) => set(`r-${k}`, t.resp[k]));
  (Object.keys(t.body) as (keyof JsonPalette)[]).forEach((k) => set(`b-${k}`, t.body[k]));
  set("g1", t.grad[0]); set("g2", t.grad[1]); set("g3", t.grad[2]);
  set("stars", String(t.stars));
  s.colorScheme = t.dark ? "dark" : "light";
  Array.from(root.classList).filter((c) => c.startsWith("theme-")).forEach((c) => root.classList.remove(c));
  root.classList.add(t.dark ? "theme-dark" : "theme-light", `theme-${t.id}`);
  root.dataset.theme = t.id;
}
