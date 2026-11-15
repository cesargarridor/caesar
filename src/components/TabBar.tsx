import { useEffect, useRef, useState } from "react";
import { Globe, Plug, Plus, X, XCircle } from "lucide-react";
import { METHOD_COLORS } from "./SidebarTree";
import { suggestName } from "../lib/tree";
import type { Tab } from "../types";
import { t as tr } from "../lib/i18n";
import type { CloseMode } from "../lib/tabs";

interface Props {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Nueva pestaña WebSocket (menú del «+»). */
  onNewWs?: () => void;
  /** Cierra varias pestañas (menú contextual y botón «cerrar todas»); `id` = pestaña sobre la que se pidió. */
  onCloseMany?: (mode: CloseMode, id: string | null) => void;
}

export const tabTitle = (t: Tab) => (t.path ? t.name : t.req.url ? suggestName(t.req).replace(/^\S+\s/, "") : tr("Nueva petición"));

/** Pestañas de peticiones abiertas. El punto indica cambios sin guardar. */
export default function TabBar({ tabs, activeId, onSelect, onClose, onNew, onNewWs, onCloseMany }: Props) {
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => !box.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setCtx(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("blur", close);
    };
  }, [ctx]);
  const ctxTab = ctx ? tabs.findIndex((x) => x.id === ctx.id) : -1;
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-silver hover:bg-fg/10 hover:text-mist disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-silver";
  return (
    <div role="tablist" className="flex items-end gap-1 overflow-x-auto px-3 pt-2">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(t.id)}
            onMouseDown={(e) => {
              // Rueda del ratón: cerrar (preventDefault evita el autoscroll de WebView2)
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
            onAuxClick={(e) => e.button === 1 && e.preventDefault()}
            onContextMenu={(e) => {
              if (!onCloseMany) return;
              e.preventDefault();
              setMenu(false);
              setCtx({ id: t.id, x: e.clientX, y: e.clientY });
            }}
            title={tabTitle(t)}
            className={`group flex max-w-[210px] shrink-0 cursor-pointer items-center gap-2 rounded-t-[10px] px-3 py-2 text-xs ${
              active ? "bg-deep text-mist" : "text-slate hover:bg-fg/5 hover:text-silver"
            }`}
          >
            <span className={`text-[10px] font-semibold ${METHOD_COLORS[t.req.method] ?? "text-silver"}`}>{t.req.method}</span>
            <span className="truncate">{tabTitle(t)}</span>
            {t.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lav" title={tr("Cambios sin guardar")} />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className="shrink-0 rounded p-0.5 text-slate opacity-0 hover:bg-fg/10 hover:text-mist group-hover:opacity-100"
              title={tr("Cerrar pestaña")}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <div ref={box} className="relative mb-1 shrink-0">
        <button
          onClick={(e) => {
            if (!onNewWs) return onNew();
            const r = e.currentTarget.getBoundingClientRect();
            setPos({ x: r.left, y: r.bottom + 4 });
            setMenu((m) => !m);
          }}
          aria-haspopup={onNewWs ? "menu" : undefined}
          aria-expanded={onNewWs ? menu : undefined}
          className="rounded-[10px] p-1.5 text-slate hover:bg-fg/10 hover:text-mist"
          title={tr("Nueva pestaña")}
          aria-label={tr("Nueva pestaña")}
        >
          <Plus size={15} />
        </button>
        {menu && (
          <div role="menu" style={{ left: pos.x, top: pos.y }} className="fixed z-50 w-44 rounded-xl bg-kelp p-1 text-xs shadow-lg ring-1 ring-fg/15">
            <button role="menuitem" onClick={() => { setMenu(false); onNew(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-silver hover:bg-fg/10 hover:text-mist">
              <Globe size={14} /> HTTP
            </button>
            <button role="menuitem" onClick={() => { setMenu(false); onNewWs?.(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-silver hover:bg-fg/10 hover:text-mist">
              <Plug size={14} /> WebSocket
            </button>
          </div>
        )}
      </div>
      {onCloseMany && tabs.length > 0 && (
        <button
          onClick={() => onCloseMany("all", null)}
          className="mb-1 shrink-0 rounded-[10px] p-1.5 text-slate hover:bg-fg/10 hover:text-mist"
          title={tr("Cerrar todas las pestañas")}
          aria-label={tr("Cerrar todas las pestañas")}
        >
          <XCircle size={15} />
        </button>
      )}
      {ctx && onCloseMany && (
        <div
          role="menu"
          style={{ left: Math.min(ctx.x, window.innerWidth - 200), top: Math.min(ctx.y, window.innerHeight - 160) }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-xl bg-kelp p-1 text-xs shadow-lg ring-1 ring-fg/15"
        >
          <button role="menuitem" className={item} onClick={() => { onCloseMany("one", ctx.id); setCtx(null); }}>
            {tr("Cerrar")}
          </button>
          <button role="menuitem" className={item} disabled={tabs.length < 2} onClick={() => { onCloseMany("others", ctx.id); setCtx(null); }}>
            {tr("Cerrar las demás")}
          </button>
          <button role="menuitem" className={item} disabled={ctxTab < 0 || ctxTab >= tabs.length - 1} onClick={() => { onCloseMany("right", ctx.id); setCtx(null); }}>
            {tr("Cerrar las de la derecha")}
          </button>
          <button role="menuitem" className={item} onClick={() => { onCloseMany("all", null); setCtx(null); }}>
            {tr("Cerrar todas")}
          </button>
        </div>
      )}
    </div>
  );
}
