import { t } from "./i18n";
import type { KV, TreeNode } from "../types";

/**
 * Espacios de trabajo: cada uno es un conjunto independiente de colecciones, variables y pestañas guardado en local.
 * Cambiar de espacio es instantáneo: no hay red ni pantalla de carga, solo se lee otro bloque del disco.
 * El espacio «default» usa las claves de siempre, así que quien ya tenía datos no tiene que migrar nada.
 */
export interface WsMeta {
  id: string;
  name: string;
  /** Espacio compartido con un equipo: código, si lo creó esta cuenta, marca de la última versión de la nube, huella del contenido y si también se comparten las variables. */
  team?: { code: string; owner: boolean; seen: number; h?: string; vars: boolean };
}

export const DEFAULT_WS = "default";
const LIST_KEY = "caesar.workspaces";
const ACTIVE_KEY = "caesar.workspace";

export const wsKey = (base: "collections" | "vars" | "tabs", id: string) =>
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
    for (const b of ["collections", "vars", "tabs"] as const) localStorage.removeItem(wsKey(b, id));
  } catch {
    /* sin almacenamiento */
  }
}

export interface WsData {
  id: string;
  name: string;
  collections: TreeNode[];
  vars: KV[];
}

/**
 * Lo que se sincroniza con la cuenta: todos los espacios PERSONALES (los compartidos con un equipo viajan por su propio código). Además se deja `collections`/`vars` del espacio principal en la
 * raíz para que versiones anteriores de Caesar (que no conocen los espacios) sigan leyendo sus datos.
 */
export function snapshotAll(list: WsMeta[], activeId: string, collections: TreeNode[], vars: KV[]) {
  const workspaces: WsData[] = list.filter((w) => !w.team).map((w) =>
    w.id === activeId
      ? { id: w.id, name: w.name, collections, vars }
      : { id: w.id, name: w.name, collections: read<TreeNode[]>(wsKey("collections", w.id), []), vars: read<KV[]>(wsKey("vars", w.id), []) },
  );
  const main = workspaces.find((w) => w.id === DEFAULT_WS) ?? workspaces[0];
  return { v: 2, workspaces, collections: main?.collections ?? [], vars: main?.vars ?? [] };
}
