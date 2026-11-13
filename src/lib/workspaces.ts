import { t } from "./i18n";
import type { KV, ProfilesState, Tombstone, TreeNode } from "../types";

/**
 * Espacios de trabajo: cada uno es un conjunto independiente de colecciones, variables y pestañas guardado en local.
 * Cambiar de espacio es instantáneo: no hay red ni pantalla de carga, solo se lee otro bloque del disco.
 * El espacio «default» usa las claves de siempre, así que quien ya tenía datos no tiene que migrar nada.
 */
export interface WsMeta {
  id: string;
  name: string;
  /** Última modificación del espacio (ms), para el merge LWW. */
  updatedAt?: number;
  /** Espacio compartido con un equipo: código, si lo creó esta cuenta, marca de la última versión de la nube, huella del contenido y si también se comparten las variables. */
  team?: { code: string; owner: boolean; seen: number; h?: string; vars: boolean };
}

export const DEFAULT_WS = "default";
const LIST_KEY = "caesar.workspaces";
const ACTIVE_KEY = "caesar.workspace";

export const wsKey = (base: "collections" | "vars" | "tabs" | "envs", id: string) =>
  id === DEFAULT_WS ? `caesar.${base}` : `caesar.${base}.${id}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento */
  }
}

export function loadWsList(): WsMeta[] {
  const l = read<WsMeta[]>(LIST_KEY, []);
  const ok = Array.isArray(l) ? l.filter((w) => w && typeof w.id === "string" && typeof w.name === "string") : [];
  return ok.length ? ok : [{ id: DEFAULT_WS, name: t("Personal") }];
}
export const saveWsList = (l: WsMeta[]) => write(LIST_KEY, l);

export function loadWsActive(list: WsMeta[]): string {
  let id = "";
  try {
    id = localStorage.getItem(ACTIVE_KEY) ?? "";
  } catch {
    /* sin almacenamiento */
  }
  return list.some((w) => w.id === id) ? id : list[0].id;
}
export function saveWsActive(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* sin almacenamiento */
  }
}

export const newWsId = () => "w" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

export function removeWsData(id: string) {
  try {
    for (const b of ["collections", "vars", "tabs", "envs"] as const) localStorage.removeItem(wsKey(b, id));
  } catch {
    /* sin almacenamiento */
  }
}

export interface WsData {
  id: string;
  name: string;
  collections: TreeNode[];
  vars: KV[];
  /** Perfiles de variables y el activo. Opcional: lo guardado antes no lo tiene. */
  envs?: ProfilesState;
  updatedAt?: number;
}

/** Normaliza lo leído de disco o de la nube (acepta cualquier cosa y devuelve siempre un estado válido). */
export function normProfiles(raw: unknown): ProfilesState {
  const r = raw as Partial<ProfilesState> | null | undefined;
  const list = Array.isArray(r?.list)
    ? r.list.filter((p) => p && typeof p.id === "string" && typeof p.name === "string").map((p) => ({ id: p.id, name: p.name, vars: Array.isArray(p.vars) ? p.vars : [] }))
    : [];
  const active = typeof r?.active === "string" && list.some((p) => p.id === r.active) ? r.active : null;
  return { list, active };
}
export const loadProfiles = (id: string): ProfilesState => normProfiles(read<unknown>(wsKey("envs", id), null));
export const newProfileId = () => "p" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

/** Sin plan Pro (invitado o cuenta sin pagar): un solo espacio de trabajo. Solo Pro puede tener varios. */
export const canCreateWorkspace = (isPro: boolean, list: WsMeta[]) => isPro || list.length < 1;

// ───── lápidas de nodos borrados (se emiten en el snapshot para que el merge no los resucite) ─────
const TOMB_KEY = "caesar.tombstones";
const TOMB_TTL = 90 * 24 * 3600 * 1000;
export function loadTombstones(): Tombstone[] {
  const l = read<Tombstone[]>(TOMB_KEY, []);
  const min = Date.now() - TOMB_TTL;
  return Array.isArray(l) ? l.filter((x) => x && typeof x.id === "string" && typeof x.at === "number" && x.at > min) : [];
}
export function addTombstones(ids: string[]) {
  if (!ids.length) return;
  const at = Date.now();
  const have = new Set(ids);
  write(TOMB_KEY, [...loadTombstones().filter((x) => !have.has(x.id)), ...ids.map((id) => ({ id, at }))]);
}
/** Ids (de carpetas con `uid` y peticiones con `id`) de un nodo y todo lo que contiene. */
export function collectNodeIds(n: TreeNode): string[] {
  if (n.type === "request") return n.id ? [n.id] : [];
  return [...(n.uid ? [n.uid] : []), ...n.children.flatMap(collectNodeIds)];
}

/**
 * Lo que se sincroniza con la cuenta: todos los espacios PERSONALES (los compartidos con un equipo viajan por su propio código). Además se deja `collections`/`vars` del espacio principal en la
 * raíz para que versiones anteriores de Caesar (que no conocen los espacios) sigan leyendo sus datos.
 */
export function snapshotAll(list: WsMeta[], activeId: string, collections: TreeNode[], vars: KV[], envs: ProfilesState) {
  const workspaces: WsData[] = list.filter((w) => !w.team).map((w) =>
    w.id === activeId
      ? { id: w.id, name: w.name, collections, vars, envs, updatedAt: w.updatedAt }
      : { id: w.id, name: w.name, collections: read<TreeNode[]>(wsKey("collections", w.id), []), vars: read<KV[]>(wsKey("vars", w.id), []), envs: loadProfiles(w.id), updatedAt: w.updatedAt },
  );
  const main = workspaces.find((w) => w.id === DEFAULT_WS) ?? workspaces[0];
  return { v: 3, workspaces, collections: main?.collections ?? [], vars: main?.vars ?? [], tombstones: loadTombstones() };
}
