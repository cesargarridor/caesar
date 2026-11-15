import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History, Trash2, X } from "lucide-react";
import { historyClear, historyList, type HistoryEntry } from "../api";
import { t } from "../lib/i18n";

/** Aviso interno: la interfaz lo lanza tras apuntar una petición en el historial para que el panel se relea. */
export const HISTORY_EVENT = "caesar-history";

const COLORS: Record<string, string> = { GET: "text-[#4ad295]", POST: "text-[#ffb454]", PUT: "text-[#5ab0ff]", PATCH: "text-[#c792ea]", DELETE: "text-[#ff6b7a]" };

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t("ahora");
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/** Historial local (gratis): las últimas peticiones sueltas. Un clic la abre en una pestaña nueva. */
export default function HistoryPanel({ onOpen }: { onOpen: (e: HistoryEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<HistoryEntry[]>([]);
  const load = useCallback(() => { historyList().then(setList).catch(() => {}); }, []);
  useEffect(() => {
    load();
    window.addEventListener(HISTORY_EVENT, load);
    return () => window.removeEventListener(HISTORY_EVENT, load);
  }, [load]);

  return (
    <div className="shrink-0 border-t border-fg/10">
      <div className="flex items-center pr-3">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver hover:text-mist"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <History size={14} />
          <span className="truncate">{t("Historial")}</span> <span className="font-light text-slate">({list.length})</span>
        </button>
        {open && list.length > 0 && (
          <button onClick={() => { historyClear().then(load).catch(() => {}); }} className="text-slate hover:text-red-400" title={t("Vaciar el historial")} aria-label={t("Vaciar el historial")}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-56 overflow-y-auto px-2 pb-2">
          {list.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs font-light text-slate">{t("Aquí aparecen las últimas peticiones que envíes sin guardarlas en una colección.")}</p>
          ) : (
            list.map((e) => (
              <div key={e.id} className="group flex items-center gap-1 rounded-lg hover:bg-fg/10">
                <button onClick={() => onOpen(e)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" title={e.url}>
                  <span className={`w-12 shrink-0 text-[10px] font-semibold ${COLORS[e.method] ?? "text-silver"}`}>{e.method}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-silver">{e.url.replace(/^https?:\/\//, "")}</span>
                  <span className="shrink-0 text-[10px] text-slate">{e.status ? `${e.status} · ` : ""}{ago(e.at)}</span>
                </button>
                <button onClick={() => { historyClear(e.id).then(load).catch(() => {}); }} className="invisible mr-1 text-slate hover:text-red-400 group-hover:visible" title={t("Quitar del historial")} aria-label={t("Quitar del historial")}>
                  <X size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
