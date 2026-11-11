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

/**
 * Ctrl+F global: evita el buscador nativo del webview y abre el de la zona correcta
 * (modal abierto > campo con foco > zona bajo el ratón > respuesta). Cada zona es un elemento con
 * `data-find-scope` que escucha el evento "caesar-find".
 */
export function installFindShortcut(): () => void {
  let hover: EventTarget | null = null;
  const onMove = (e: MouseEvent) => {
    hover = e.target;
  };
  const scopeOf = (el: Element | null | undefined) => el?.closest<HTMLElement>("[data-find-scope]") ?? null;
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
    e.preventDefault();
    const target =
      document.querySelector<HTMLElement>("[data-modal] [data-find-scope]") ??
      scopeOf(document.activeElement) ??
      scopeOf(hover instanceof Element ? hover : null) ??
      document.querySelector<HTMLElement>('[data-find-scope="response"]');
    target?.dispatchEvent(new CustomEvent("caesar-find"));
  };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("keydown", onKey, true);
  };
}
