export interface KV {
  key: string;
  value: string;
  enabled: boolean;
  /** Solo form-data: "text" (por defecto) o "file" */
  kind?: "text" | "file";
  /** Ruta del archivo elegido con el selector nativo (kind === "file") */
  path?: string;
  /** Solo form-data: Content-Type de esa parte (p. ej. application/json). Vacío = automático. */
  contentType?: string;
}

export type BodyMode = "none" | "json" | "text" | "formdata" | "urlencoded";

export interface BodyData {
  mode: BodyMode;
  raw: string;
  formdata: KV[];
  urlencoded: KV[];
}

export type AuthType = "none" | "bearer" | "basic" | "apikey";

export interface AuthData {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  key: string;
  value: string;
  in: "header" | "query";
}

export interface Settings {
  followRedirects: boolean;
  timeoutSecs: number;
  verifySsl: boolean;
}

/** Estado editable de una petición. `url` es la base SIN query; los params viven en `params`. */
export interface RequestState {
  method: string;
  url: string;
  params: KV[];
  headers: KV[];
  auth: AuthData;
  body: BodyData;
  settings: Settings;
}

export type TreeNode =
  | { type: "folder"; name: string; children: TreeNode[] }
  | {
      type: "request";
      name: string;
      method: string;
      url: string;
      headers: KV[];
      body: Partial<BodyData> & { mode: string };
      auth: Partial<AuthData> & { type?: string };
    };

export type RequestNode = Extract<TreeNode, { type: "request" }>;

export interface ImportedCollection {
  root: TreeNode;
  variables: KV[];
}

export interface ResponseData {
  status: number;
  statusText: string;
  timeMs: number;
  sizeBytes: number;
  truncated: boolean;
  headers: [string, string][];
  body: string;
  pretty: string | null;
  timeline: { id: string; label: string; ms: number; detail: string }[];
}

export interface StepState {
  id: string;
  label: string;
  state: "pending" | "active" | "done" | "error";
  ms: number;
  detail: string;
}

export interface ProgressEvent {
  id: string;
  label: string;
  state: "start" | "progress" | "done" | "error";
  ms: number;
  detail: string;
}

/** Pestaña de petición abierta. `path` enlaza con el nodo guardado en la colección (null = borrador). */
export interface Tab {
  id: string;
  req: RequestState;
  path: string | null;
  name: string;
  dirty: boolean;
}
