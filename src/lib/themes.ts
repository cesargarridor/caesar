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
    ui: { abyss: "#1a1640", deep: "#130f30", kelp: "#2a2563", mist: "#f4f0ff", silver: "#cfcdeb", slate: "#9f9bd0", iris: "#8052ff", onprimary: "#ffffff", accent: "#9382ff", hl: "#ffb829", ...DARK_SEM },
    resp: { key: "#6cb6ff", str: "#ffd866", num: "#ffb454", bool: "#ff9ec4", nul: "#b3b0d9", punc: "#8d89c4", link: "#5ff0b4" },
    body: { key: "#e59cff", str: "#7ee0c3", num: "#ffa66b", bool: "#9cb2ff", nul: "#9b97c4", punc: "#8d89c4" },
    grad: ["#e59cff", "#ba9cff", "#9cb2ff"], stars: 0.55,
  },
  {
    id: "monokai", name: "Monokai", dark: true,
    ui: { abyss: "#272822", deep: "#1e1f1c", kelp: "#3e3d32", mist: "#f8f8f2", silver: "#cfcfc2", slate: "#90908a", iris: "#f92672", onprimary: "#ffffff", accent: "#a6e22e", hl: "#e6db74", ...DARK_SEM },
    resp: { key: "#66d9ef", str: "#e6db74", num: "#ae81ff", bool: "#f92672", nul: "#fd971f", punc: "#90908a", link: "#a6e22e" },
    body: { key: "#a6e22e", str: "#fd971f", num: "#ae81ff", bool: "#f92672", nul: "#90908a", punc: "#75715e" },
    grad: ["#f92672", "#fd971f", "#a6e22e"], stars: 0,
  },
  {
    id: "monokai-light", name: "Monokai White", dark: false,
    ui: { abyss: "#fafafa", deep: "#f0f0ec", kelp: "#e5e5de", mist: "#272822", silver: "#49483e", slate: "#75715e", iris: "#f92672", onprimary: "#ffffff", accent: "#0a8fa8", hl: "#b36b00", ok: "#1a9f5c", bad: "#d6293b" },
    resp: { key: "#00809a", str: "#8a7b00", num: "#7a4fd6", bool: "#d6226a", nul: "#b36b00", punc: "#75715e", link: "#4d8a00" },
    body: { key: "#5c8f00", str: "#c26a00", num: "#7a4fd6", bool: "#d6226a", nul: "#75715e", punc: "#a59f85" },
    grad: ["#f92672", "#fd971f", "#a6e22e"], stars: 0,
  },
  {
    id: "dracula", name: "Dracula", dark: true,
    ui: { abyss: "#282a36", deep: "#21222c", kelp: "#343746", mist: "#f8f8f2", silver: "#d6d6e0", slate: "#7f8ac0", iris: "#bd93f9", onprimary: "#282a36", accent: "#bd93f9", hl: "#f1fa8c", ...DARK_SEM },
    resp: { key: "#8be9fd", str: "#f1fa8c", num: "#bd93f9", bool: "#ff79c6", nul: "#ffb86c", punc: "#6272a4", link: "#50fa7b" },
    body: { key: "#ff79c6", str: "#50fa7b", num: "#ffb86c", bool: "#bd93f9", nul: "#6272a4", punc: "#6272a4" },
    grad: ["#ff79c6", "#bd93f9", "#8be9fd"], stars: 0.35,
  },
  {
    id: "tokyo-night", name: "Tokyo Night", dark: true,
    ui: { abyss: "#1a1b26", deep: "#16161e", kelp: "#24283b", mist: "#c0caf5", silver: "#a9b1d6", slate: "#7982b0", iris: "#7aa2f7", onprimary: "#1a1b26", accent: "#7aa2f7", hl: "#e0af68", ...DARK_SEM },
    resp: { key: "#7aa2f7", str: "#e0af68", num: "#ff9e64", bool: "#bb9af7", nul: "#6a739f", punc: "#6a739f", link: "#73daca" },
    body: { key: "#bb9af7", str: "#9ece6a", num: "#ff9e64", bool: "#7dcfff", nul: "#6a739f", punc: "#565f89" },
    grad: ["#bb9af7", "#7aa2f7", "#7dcfff"], stars: 0.45,
  },
  {
    id: "nord", name: "Nord", dark: true,
    ui: { abyss: "#2e3440", deep: "#272c36", kelp: "#3b4252", mist: "#eceff4", silver: "#d8dee9", slate: "#8f9bb3", iris: "#88c0d0", onprimary: "#2e3440", accent: "#88c0d0", hl: "#ebcb8b", ...DARK_SEM },
    resp: { key: "#81a1c1", str: "#ebcb8b", num: "#b48ead", bool: "#d08770", nul: "#8f9bb3", punc: "#7b88a1", link: "#a3be8c" },
    body: { key: "#a3be8c", str: "#d08770", num: "#b48ead", bool: "#81a1c1", nul: "#7b88a1", punc: "#616e88" },
    grad: ["#88c0d0", "#81a1c1", "#b48ead"], stars: 0.3,
  },
  {
    id: "one-dark", name: "One Dark", dark: true,
    ui: { abyss: "#282c34", deep: "#21252b", kelp: "#323842", mist: "#dcdfe4", silver: "#abb2bf", slate: "#7f8697", iris: "#61afef", onprimary: "#1e222a", accent: "#61afef", hl: "#e5c07b", ...DARK_SEM },
    resp: { key: "#61afef", str: "#e5c07b", num: "#d19a66", bool: "#c678dd", nul: "#7f8697", punc: "#7f8697", link: "#98c379" },
    body: { key: "#e06c75", str: "#98c379", num: "#d19a66", bool: "#56b6c2", nul: "#7f8697", punc: "#5c6370" },
    grad: ["#e06c75", "#c678dd", "#61afef"], stars: 0,
  },
  {
    id: "github-light", name: "GitHub Light", dark: false,
    ui: { abyss: "#ffffff", deep: "#f6f8fa", kelp: "#eaeef2", mist: "#1f2328", silver: "#424a53", slate: "#6e7781", iris: "#0969da", onprimary: "#ffffff", accent: "#0969da", hl: "#9a6700", ok: "#1a7f37", bad: "#cf222e" },
    resp: { key: "#0550ae", str: "#9a6700", num: "#8250df", bool: "#cf222e", nul: "#6e7781", punc: "#6e7781", link: "#1a7f37" },
    body: { key: "#8250df", str: "#116329", num: "#953800", bool: "#0550ae", nul: "#6e7781", punc: "#8c959f" },
    grad: ["#0969da", "#8250df", "#bf3989"], stars: 0,
  },
];

export const DEFAULT_THEME = "caesar";
const KEY = "caesar.theme";

export function loadThemeId(): string {
  try {
    const id = localStorage.getItem(KEY);
    if (id && THEMES.some((t) => t.id === id)) return id;
  } catch {
    /* sin almacenamiento */
  }
  return DEFAULT_THEME;
}

export function saveThemeId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* sin almacenamiento */
  }
}

/** Vuelca el tema a variables CSS en <html>. */
export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const s = document.documentElement.style;
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
  document.documentElement.dataset.theme = t.id;
}
