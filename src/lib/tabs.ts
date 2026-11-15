/** Lógica pura de pestañas (sin React): qué pestañas se cierran y cuál queda activa. Se prueba con node --test. */

export interface TabLite {
  id: string;
  dirty?: boolean;
}

export type CloseMode = "one" | "others" | "right" | "all";

/** Ids que se cierran al pedir `mode` desde la pestaña `id`. */
export function idsToClose(tabs: TabLite[], id: string | null, mode: CloseMode): string[] {
  if (mode === "all") return tabs.map((t) => t.id);
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return [];
  if (mode === "one") return [id as string];
  if (mode === "others") return tabs.filter((t) => t.id !== id).map((t) => t.id);
  return tabs.slice(i + 1).map((t) => t.id);
}

/** Ids con cambios sin guardar entre los indicados. */
export function dirtyIds(tabs: TabLite[], ids: string[]): string[] {
  const set = new Set(ids);
  return tabs.filter((t) => set.has(t.id) && t.dirty).map((t) => t.id);
}

/** Pestaña activa tras cerrar `closed`: la misma si sigue abierta; si no, la vecina más cercana que quede; null si no queda ninguna. */
export function activeAfterClose(tabs: TabLite[], closed: string[], activeId: string | null): string | null {
  const gone = new Set(closed);
  const rest = tabs.filter((t) => !gone.has(t.id));
  if (rest.length === 0) return null;
  if (activeId && !gone.has(activeId)) return activeId;
  const i = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  // primera superviviente a la derecha de la activa; si no, la última de la izquierda
  for (let k = i; k < tabs.length; k++) if (!gone.has(tabs[k].id)) return tabs[k].id;
  return rest[rest.length - 1].id;
}
