/** Entrada normalizada del generador de código (sin React ni Tauri). */
export interface SnippetField {
  key: string;
  value: string;
  /** Solo form-data: la parte es un archivo (value/path = ruta). */
  file: boolean;
  path: string;
  contentType: string;
}

export type SnippetBody =
  | { kind: "none" }
  | { kind: "raw"; text: string }
  | { kind: "urlencoded"; fields: { key: string; value: string }[] }
  | { kind: "formdata"; fields: SnippetField[] };

export interface SnippetInput {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: SnippetBody;
}

export interface SnippetOptions {
  /** Espacios por nivel; 0 = tabulador. */
  indent: number;
  /** Segundos; 0 = sin límite. */
  timeout: number;
  follow: boolean;
}

export const DEFAULT_OPTIONS: SnippetOptions = { indent: 2, timeout: 0, follow: true };

export type OptKey = "indent" | "timeout" | "follow";
/** Tipo de resaltado: comentarios con // (c), con # (hash), flags de cURL, o ninguno. */
export type HlKind = "c" | "hash" | "curl" | "none";

export interface Lang {
  id: string;
  label: string;
  hl: HlKind;
  ext: string;
  /** Opciones que respeta este generador. */
  opts: OptKey[];
  gen: (i: SnippetInput, o: SnippetOptions) => string;
}
