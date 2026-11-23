import { localLoad } from "../api";
import { DEFAULT_WS, saveWsList, wsKey, type WsMeta } from "./workspaces";

/** ¿Hay alguna colección guardada en el almacenamiento del WebView? */
function hasLocalCollections(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("caesar.collections")) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? "[]");
      if (Array.isArray(v) && v.length > 0) return true;
    }
  } catch {
    /* sin almacenamiento: se trata como vacío */
  }
  return false;
}

/**
 * Si el almacenamiento del WebView se perdió (reinstalar, arrancar con otro sistema, perfil estropeado…) pero el disco
 * conserva `datos.json` o una copia, se vuelcan al almacenamiento ANTES de montar la app. Solo actúa si no hay ninguna colección local.
 */
export async function restoreFromDisk(): Promise<void> {
  if (hasLocalCollections()) return;
  try {
    const raw = await localLoad();
    if (!raw) return;
    const d = JSON.parse(raw);
    const ws: any[] = Array.isArray(d?.workspaces) ? d.workspaces.filter((w: any) => w && typeof w.id === "string") : [];
    const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
    if (ws.length === 0) {
      if (Array.isArray(d?.collections)) set(wsKey("collections", DEFAULT_WS), d.collections);
      if (Array.isArray(d?.vars)) set(wsKey("vars", DEFAULT_WS), d.vars);
      return;
    }
    const list: WsMeta[] = ws.map((w) => ({
      id: w.id,
      name: typeof w.name === "string" && w.name ? w.name : "Personal",
      ...(typeof w.updatedAt === "number" ? { updatedAt: w.updatedAt } : {}),
    }));
    for (const w of ws) {
      set(wsKey("collections", w.id), Array.isArray(w.collections) ? w.collections : []);
      set(wsKey("vars", w.id), Array.isArray(w.vars) ? w.vars : []);
      if (w.envs !== undefined) set(wsKey("envs", w.id), w.envs);
    }
    saveWsList(list);
    if (Array.isArray(d?.tombstones)) set("caesar.tombstones", d.tombstones);
  } catch {
    /* sin copia en disco o ilegible: arranque normal */
  }
}
