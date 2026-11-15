import { DEFAULT_OPTIONS, type SnippetOptions } from "./types.ts";

const KEY = "caesar.codegen";

export interface CodegenPrefs {
  lang: string;
  opts: SnippetOptions;
  /** true = usar los valores de las variables; false = dejar {{variables}}. */
  resolveVars: boolean;
  lineNumbers: boolean;
  width: number;
}

export const DEFAULT_PREFS: CodegenPrefs = { lang: "curl", opts: DEFAULT_OPTIONS, resolveVars: true, lineNumbers: true, width: 420 };

export function loadPrefs(): CodegenPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") return { ...DEFAULT_PREFS, ...raw, opts: { ...DEFAULT_OPTIONS, ...(raw.opts ?? {}) } };
  } catch { /* sin almacenamiento */ }
  return DEFAULT_PREFS;
}

export function savePrefs(p: CodegenPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* sin almacenamiento */ }
}
