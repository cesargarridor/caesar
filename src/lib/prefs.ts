import { useSyncExternalStore } from "react";

/** Preferencias de visualización: tamaños de letra por zona y ancho del lateral. */

export interface FontPrefs {
  /** Toda la interfaz (px de la letra base; escala también los espacios). */
  general: number;
  /** Barra lateral (% sobre el tamaño general). */
  sidebar: number;
  /** Zona de la petición: pestañas, barra de URL, Params, Headers, Auth… (% sobre el general). */
  request: number;
  /** Editor del body que envías (JSON/Text), Edit data y Scripts (px). */
  body: number;
  /** Cuerpo de la respuesta que recibes (px). */
  response: number;
}

export const FONT_DEFAULTS: FontPrefs = { general: 16, sidebar: 100, request: 100, body: 13, response: 13 };

export const FONT_FIELDS: { key: keyof FontPrefs; label: string; hint: string; min: number; max: number; step: number; unit: string }[] = [
  { key: "general", label: "General", hint: "Toda la aplicación", min: 12, max: 22, step: 1, unit: "px" },
  { key: "sidebar", label: "Barra lateral", hint: "Colecciones, carpetas y variables", min: 70, max: 170, step: 5, unit: "%" },
  { key: "request", label: "Petición", hint: "Pestañas, URL, Params, Headers y Auth", min: 70, max: 170, step: 5, unit: "%" },
  { key: "body", label: "Body que envías", hint: "Editor JSON/Text, Edit data y Scripts", min: 10, max: 26, step: 1, unit: "px" },
  { key: "response", label: "Respuesta recibida", hint: "Cuerpo de la respuesta (JSON)", min: 10, max: 26, step: 1, unit: "px" },
];

const FONT_KEY = "caesar.fonts";
const WIDTH_KEY = "caesar.sidebarW";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function loadFonts(): FontPrefs {
  const out = { ...FONT_DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(FONT_KEY) ?? "{}") as Partial<FontPrefs>;
    for (const f of FONT_FIELDS) {
      const v = Number(raw[f.key]);
      if (Number.isFinite(v) && raw[f.key] !== undefined) out[f.key] = clamp(v, f.min, f.max);
    }
  } catch {
    /* sin almacenamiento o JSON inválido */
  }
  return out;
}

export function saveFonts(f: FontPrefs) {
  try {
    localStorage.setItem(FONT_KEY, JSON.stringify(f));
  } catch {
    /* sin almacenamiento */
  }
}

/** Vuelca los tamaños a variables CSS / <html>. */
export function applyFonts(f: FontPrefs) {
  const el = document.documentElement;
  el.style.fontSize = `${f.general}px`;
  el.style.setProperty("--fs-body", `${f.body}px`);
  el.style.setProperty("--fs-resp", `${f.response}px`);
  el.style.setProperty("--fs-k-sidebar", String(f.sidebar / 100));
  el.style.setProperty("--fs-k-request", String(f.request / 100));
}

const HIDE_EMPTY_KEY = "caesar.hideEmpty";

/** Ocultar null / [] / {} en la respuesta: desactivado por defecto. */
export function loadHideEmpty(): boolean {
  try {
    return localStorage.getItem(HIDE_EMPTY_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveHideEmpty(on: boolean) {
  try {
    localStorage.setItem(HIDE_EMPTY_KEY, on ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
}

const UPDATE_KEY = "caesar.autoUpdate";

/** Actualizaciones automáticas: activadas por defecto. */
export function loadAutoUpdate(): boolean {
  try {
    return localStorage.getItem(UPDATE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAutoUpdate(on: boolean) {
  try {
    localStorage.setItem(UPDATE_KEY, on ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
}

export const SIDEBAR_DEFAULT = 288;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 640;

export function loadSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(v) && v > 0) return clamp(v, SIDEBAR_MIN, SIDEBAR_MAX);
  } catch {
    /* sin almacenamiento */
  }
  return SIDEBAR_DEFAULT;
}

export function saveSidebarWidth(w: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
  } catch {
    /* sin almacenamiento */
  }
}

export const clampSidebar = (w: number) => clamp(w, SIDEBAR_MIN, SIDEBAR_MAX);

const CAT_KEY = "caesar.catAnim";

/** Animaciones del gatito (idle, clic y pantalla de actualización): activadas por defecto. */
let catAnim = (() => {
  try {
    return localStorage.getItem(CAT_KEY) !== "0";
  } catch {
    return true;
  }
})();
const catListeners = new Set<() => void>();

export function setCatAnim(on: boolean) {
  catAnim = on;
  try {
    localStorage.setItem(CAT_KEY, on ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
  document.documentElement.toggleAttribute("data-cat-static", !on);
  catListeners.forEach((f) => f());
}

export const getCatAnim = () => catAnim;

const NET_KEY = "caesar.netAnim";

/** Red de nodos de la pantalla de carga: activada por defecto. */
let netAnim = (() => {
  try {
    return localStorage.getItem(NET_KEY) !== "0";
  } catch {
    return true;
  }
})();
const netListeners = new Set<() => void>();

export function setNetAnim(on: boolean) {
  netAnim = on;
  try {
    localStorage.setItem(NET_KEY, on ? "1" : "0");
  } catch {
    /* sin almacenamiento */
  }
  netListeners.forEach((f) => f());
}

export function useNetAnim(): boolean {
  return useSyncExternalStore(
    (f) => {
      netListeners.add(f);
      return () => netListeners.delete(f);
    },
    () => netAnim,
  );
}

export function useCatAnim(): boolean {
  return useSyncExternalStore(
    (f) => {
      catListeners.add(f);
      return () => catListeners.delete(f);
    },
    () => catAnim,
  );
}
