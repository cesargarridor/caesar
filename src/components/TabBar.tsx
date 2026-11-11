import { Plus, X } from "lucide-react";
import { METHOD_COLORS } from "./SidebarTree";
import { suggestName } from "../lib/tree";
import type { Tab } from "../types";

interface Props {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export const tabTitle = (t: Tab) => (t.path ? t.name : t.req.url ? suggestName(t.req).replace(/^\S+\s/, "") : "Nueva petición");

/** Pestañas de peticiones abiertas, como en Postman. El punto indica cambios sin guardar. */
export default function TabBar({ tabs, activeId, onSelect, onClose, onNew }: Props) {
  return (
    <div className="flex items-end gap-1 overflow-x-auto px-3 pt-2">
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
            title={tabTitle(t)}
            className={`group flex max-w-[210px] shrink-0 cursor-pointer items-center gap-2 rounded-t-[10px] px-3 py-2 text-xs ${
              active ? "bg-deep text-mist" : "text-slate hover:bg-fg/5 hover:text-silver"
            }`}
          >
            <span className={`text-[10px] font-semibold ${METHOD_COLORS[t.req.method] ?? "text-silver"}`}>{t.req.method}</span>
            <span className="truncate">{tabTitle(t)}</span>
            {t.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lav" title="Cambios sin guardar" />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className="shrink-0 rounded p-0.5 text-slate opacity-0 hover:bg-fg/10 hover:text-mist group-hover:opacity-100"
              title="Cerrar pestaña"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button onClick={onNew} className="mb-1 shrink-0 rounded-[10px] p-1.5 text-slate hover:bg-fg/10 hover:text-mist" title="Nueva pestaña">
        <Plus size={15} />
      </button>
    </div>
  );
}
