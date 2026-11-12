/** Fuentes de la interfaz. Todas son libres (SIL OFL / Apache) y se empaquetan con la app vía @fontsource:
 *  no se descarga nada de internet. Cada una se carga solo cuando se elige. */

export interface FontOption {
  id: string;
  name: string;
  /** Valor para font-family (null = la pila por defecto de Caesar). */
  family: string | null;
  load: () => Promise<unknown>;
}

const both = (a: () => Promise<unknown>, b: () => Promise<unknown>) => () => Promise.all([a(), b()]);

export const FONT_OPTIONS: FontOption[] = [
  { id: "default", name: "Caesar (predeterminada)", family: null, load: async () => {} },
  { id: "inter", name: "Inter", family: '"Inter", sans-serif', load: both(() => import("@fontsource/inter/latin-400.css"), () => import("@fontsource/inter/latin-700.css")) },
  { id: "roboto", name: "Roboto", family: '"Roboto", sans-serif', load: both(() => import("@fontsource/roboto/latin-400.css"), () => import("@fontsource/roboto/latin-700.css")) },
  { id: "open-sans", name: "Open Sans", family: '"Open Sans", sans-serif', load: both(() => import("@fontsource/open-sans/latin-400.css"), () => import("@fontsource/open-sans/latin-700.css")) },
  { id: "lato", name: "Lato", family: '"Lato", sans-serif', load: both(() => import("@fontsource/lato/latin-400.css"), () => import("@fontsource/lato/latin-700.css")) },
  { id: "montserrat", name: "Montserrat", family: '"Montserrat", sans-serif', load: both(() => import("@fontsource/montserrat/latin-400.css"), () => import("@fontsource/montserrat/latin-700.css")) },
  { id: "poppins", name: "Poppins", family: '"Poppins", sans-serif', load: both(() => import("@fontsource/poppins/latin-400.css"), () => import("@fontsource/poppins/latin-700.css")) },
  { id: "source-sans-3", name: "Source Sans 3", family: '"Source Sans 3", sans-serif', load: both(() => import("@fontsource/source-sans-3/latin-400.css"), () => import("@fontsource/source-sans-3/latin-700.css")) },
  { id: "nunito", name: "Nunito", family: '"Nunito", sans-serif', load: both(() => import("@fontsource/nunito/latin-400.css"), () => import("@fontsource/nunito/latin-700.css")) },
  { id: "noto-sans", name: "Noto Sans", family: '"Noto Sans", sans-serif', load: both(() => import("@fontsource/noto-sans/latin-400.css"), () => import("@fontsource/noto-sans/latin-700.css")) },
  { id: "ubuntu", name: "Ubuntu", family: '"Ubuntu", sans-serif', load: both(() => import("@fontsource/ubuntu/latin-400.css"), () => import("@fontsource/ubuntu/latin-700.css")) },
  { id: "fira-sans", name: "Fira Sans", family: '"Fira Sans", sans-serif', load: both(() => import("@fontsource/fira-sans/latin-400.css"), () => import("@fontsource/fira-sans/latin-700.css")) },
  { id: "ibm-plex-sans", name: "IBM Plex Sans", family: '"IBM Plex Sans", sans-serif', load: both(() => import("@fontsource/ibm-plex-sans/latin-400.css"), () => import("@fontsource/ibm-plex-sans/latin-700.css")) },
  { id: "work-sans", name: "Work Sans", family: '"Work Sans", sans-serif', load: both(() => import("@fontsource/work-sans/latin-400.css"), () => import("@fontsource/work-sans/latin-700.css")) },
  { id: "rubik", name: "Rubik", family: '"Rubik", sans-serif', load: both(() => import("@fontsource/rubik/latin-400.css"), () => import("@fontsource/rubik/latin-700.css")) },
  { id: "dm-sans", name: "DM Sans", family: '"DM Sans", sans-serif', load: both(() => import("@fontsource/dm-sans/latin-400.css"), () => import("@fontsource/dm-sans/latin-700.css")) },
  { id: "raleway", name: "Raleway", family: '"Raleway", sans-serif', load: both(() => import("@fontsource/raleway/latin-400.css"), () => import("@fontsource/raleway/latin-700.css")) },
  { id: "mulish", name: "Mulish", family: '"Mulish", sans-serif', load: both(() => import("@fontsource/mulish/latin-400.css"), () => import("@fontsource/mulish/latin-700.css")) },
  { id: "pt-sans", name: "PT Sans", family: '"PT Sans", sans-serif', load: both(() => import("@fontsource/pt-sans/latin-400.css"), () => import("@fontsource/pt-sans/latin-700.css")) },
  { id: "merriweather", name: "Merriweather", family: '"Merriweather", serif', load: both(() => import("@fontsource/merriweather/latin-400.css"), () => import("@fontsource/merriweather/latin-700.css")) },
  { id: "lora", name: "Lora", family: '"Lora", serif', load: both(() => import("@fontsource/lora/latin-400.css"), () => import("@fontsource/lora/latin-700.css")) },
];

const KEY = "caesar.fontFamily";

export function loadFontId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && FONT_OPTIONS.some((f) => f.id === v)) return v;
  } catch {
    /* sin almacenamiento */
  }
  return "default";
}

export function saveFontId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* sin almacenamiento */
  }
}

/** Aplica la fuente a toda la interfaz (los editores de código siguen en monoespaciada). */
export async function applyFontFamily(id: string) {
  const f = FONT_OPTIONS.find((o) => o.id === id) ?? FONT_OPTIONS[0];
  const el = document.documentElement;
  if (!f.family) {
    el.style.removeProperty("--font-ui");
    el.style.removeProperty("--font-ui-weight");
    return;
  }
  try {
    await f.load();
  } catch {
    /* si falla la carga se usa la fuente de reserva */
  }
  el.style.setProperty("--font-ui", `${f.family}, ui-sans-serif, system-ui, "Segoe UI", sans-serif`);
  el.style.setProperty("--font-ui-weight", "400");
}
