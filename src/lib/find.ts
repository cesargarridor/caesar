/** Búsqueda (Ctrl+F) compartida por el visor de respuesta y los editores. */

export const MAX_MATCHES = 5000;

/** Posiciones de inicio de cada coincidencia (sin distinguir mayúsculas, sin solaparse). */
export function findAll(text: string, q: string, limit = MAX_MATCHES): number[] {
  if (!q || !text) return [];
  const t = text.toLowerCase();
  const n = q.toLowerCase();
  const out: number[] = [];
  let i = 0;
  while (out.length < limit) {
    const j = t.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + n.length;
  }
  return out;
}

/** Índice circular válido para `total` coincidencias. */
export const wrapIndex = (cur: number, total: number) => (total ? ((cur % total) + total) % total : 0);

let hover: EventTarget | null = null;
const scopeOf = (el: Element | null | undefined) => el?.closest<HTMLElement>("[data-find-scope]") ?? null;

/**
 * Abre el buscador de la zona correcta (modal abierto > campo con foco > zona bajo el ratón > respuesta). Cada zona es un
 * elemento con `data-find-scope` que escucha el evento "caesar-find". Lo lanza el comando «Buscar» (atajo editable).
 */
export function triggerFind() {
  const target =
    document.querySelector<HTMLElement>("[data-modal] [data-find-scope]") ??
    scopeOf(document.activeElement) ??
    scopeOf(hover instanceof Element ? hover : null) ??
    document.querySelector<HTMLElement>('[data-find-scope="response"]');
  target?.dispatchEvent(new CustomEvent("caesar-find"));
}

/** Sigue al ratón para saber en qué zona buscar. El atajo lo gestiona el despachador de atajos (keymap). */
export function installFindShortcut(): () => void {
  const onMove = (e: MouseEvent) => {
    hover = e.target;
  };
  window.addEventListener("mousemove", onMove, true);
  return () => window.removeEventListener("mousemove", onMove, true);
}
