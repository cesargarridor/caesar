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

/** Perfil de variables (como un Environment de Postman): conjunto con nombre que se activa con el selector junto a «Enviar». */
export interface VarProfile {
  id: string;
  name: string;
  vars: KV[];
}

/** Perfiles de un espacio de trabajo y el que está activo (null = ninguno). */
export interface ProfilesState {
  list: VarProfile[];
  active: string | null;
}

export type BodyMode = "none" | "json" | "text" | "formdata" | "urlencoded";

export interface BodyData {
  mode: BodyMode;
  raw: string;
  formdata: KV[];
  urlencoded: KV[];
}

export type AuthType =
  | "none" | "inherit" | "bearer" | "basic" | "apikey"
  | "digest" | "ntlm" | "oauth1" | "oauth2" | "wsse" | "awsv4" | "akamai";

export interface AuthData {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  key: string;
  value: string;
  in: "header" | "query";
  /** Campos propios de cada tipo (OAuth, AWS, NTLM…). */
  extra?: Record<string, string>;
}

export interface Settings {
  followRedirects: boolean;
  timeoutSecs: number;
  verifySsl: boolean;
  /** Versión de HTTP: automática (por defecto), 1.1 o 2. Opcional: lo guardado antes no la tiene. */
  httpVersion?: "auto" | "1.1" | "2";
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
  /** Script (post-respuesta). Opcional: borradores antiguos no lo tienen. */
  tests?: string;
}

export type TreeNode =
  | { type: "folder"; name: string; children: TreeNode[]; /** Id estable (para recordar si está desplegada aunque cambie su posición). */ uid?: string; /** Última modificación (ms), para el merge LWW. */ updatedAt?: number; /** Variables de la colección (solo carpeta raíz). */ variables?: KV[]; /** Colección compartida con un equipo (solo carpeta raíz): código, si la creó esta cuenta y marca de la última versión de la nube. */ team?: { code: string; owner: boolean; seen: number; /** Huella del contenido de la última versión sincronizada (evita subidas innecesarias). */ h?: string }; /** Autorización de la colección o carpeta (la heredan las peticiones con "Inherit"). */ auth?: Partial<AuthData> & { type?: string } }
  | {
      type: "request";
      name: string;
      /** Id estable y última modificación (ms) para el merge LWW. */
      id?: string;
      updatedAt?: number;
      method: string;
      url: string;
      headers: KV[];
      body: Partial<BodyData> & { mode: string };
      auth: Partial<AuthData> & { type?: string };
      tests?: string;
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

/** Estado del actualizador de la app. */
export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "uptodate" }
  | { phase: "available"; version: string; current: string; notes: string | null }
  | { phase: "installing"; version: string; downloaded: number; total: number | null }
  | { phase: "error"; message: string };

/** Pestaña de petición abierta. `path` enlaza con el nodo guardado en la colección (null = borrador). */
export interface Tab {
  id: string;
  req: RequestState;
  path: string | null;
  name: string;
  dirty: boolean;
}

/** Lápida de un nodo borrado (merge LWW entre equipos). */
export interface Tombstone { id: string; at: number }
