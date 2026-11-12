import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Link2, Pencil, Plus, RefreshCw, Share2, Trash2, Users } from "lucide-react";
import { t } from "../lib/i18n";
import type { WsMeta } from "../lib/workspaces";

interface Props {
  list: WsMeta[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Compartir el espacio abierto con un equipo / ver su código. */
  onShare: () => void;
  onInfo: () => void;
  /** Unirse a un espacio compartido con su código. */
  onJoin: (code: string) => Promise<void>;
  /** Rueda de actualizar del espacio compartido abierto. */
  onRefresh: () => void;
  refreshing: boolean;
}

const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-silver hover:bg-fg/10 hover:text-mist disabled:opacity-40";

/** Selector de espacio de trabajo: el cambio es instantáneo (todo vive en local). */
export default function WorkspaceSwitcher({ list, activeId, onSwitch, onAdd, onRename, onDelete, onShare, onInfo, onJoin, onRefresh, refreshing }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<null | "new" | "rename" | "join">(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const active = list.find((w) => w.id === activeId) ?? list[0];

  const close = () => {
    setOpen(false);
    setMode(null);
    setConfirmDel(false);
    setErr(null);
  };
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const submit = async () => {
    const name = text.trim();
    if (!name) return;
    if (mode === "join") {
      setBusy(true);
      setErr(null);
      try {
        await onJoin(name);
        setBusy(false);
        close();
      } catch (e) {
        setErr(typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));
        setBusy(false);
      }
      return;
    }
    if (mode === "new") onAdd(name);
    else if (mode === "rename") onRename(active.id, name);
    close();
  };

  return (
    <div ref={box} className="relative mb-3">
      <div className="flex gap-1.5">
        <button
          onClick={() => (open ? close() : setOpen(true))}
          title={t("Espacio de trabajo")}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] bg-kelp px-3 py-2 text-sm text-mist ring-1 ring-fg/10 hover:ring-fg/30"
        >
          {active.team && <Users size={14} className="shrink-0 text-aqua" aria-label={t("Espacio de equipo")} />}
          <span className="flex-1 truncate text-left">{active.name}</span>
          <ChevronsUpDown size={14} className="shrink-0 text-slate" />
        </button>
        {active.team && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            title={t("Actualizar espacio de equipo")}
            className="shrink-0 rounded-[10px] bg-kelp px-2.5 text-slate ring-1 ring-fg/10 hover:text-mist hover:ring-fg/30"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin text-aqua" : ""} />
          </button>
        )}
      </div>
      {open && (
        <div className="glass absolute left-0 right-0 top-full z-40 mt-1 rounded-xl bg-kelp p-1 shadow-lg">
          <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-slate">{t("Espacios de trabajo")}</p>
          <div className="max-h-56 overflow-y-auto">
            {list.map((w) => (
              <button key={w.id} className={item} onClick={() => { if (w.id !== activeId) onSwitch(w.id); close(); }}>
                {w.team && <Users size={13} className="shrink-0 text-aqua" />}
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === activeId && <Check size={14} className="text-aqua" />}
              </button>
            ))}
          </div>
          <div className="my-1 border-t border-fg/10" />
          {mode ? (
            <div className="p-1">
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={text}
                  onChange={(e) => setText(mode === "join" ? e.target.value.toUpperCase() : e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void submit()}
                  placeholder={mode === "join" ? "TEAM-XXXX-XXXX-XXXX" : t("Nombre del espacio")}
                  spellCheck={false}
                  className={`min-w-0 flex-1 rounded-lg bg-deep px-3 py-1.5 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua ${mode === "join" ? "font-mono" : ""}`}
                />
                <button onClick={() => void submit()} disabled={busy} className="rounded-lg px-3 text-sm text-white disabled:opacity-50" style={{ background: "var(--t-iris)" }}>
                  <Check size={14} />
                </button>
              </div>
              {err && <p className="mt-1.5 px-1 text-xs text-rose">{err}</p>}
            </div>
          ) : (
            <>
              <button className={item} onClick={() => { setText(""); setMode("new"); }}>
                <Plus size={14} /> {t("Nuevo espacio de trabajo")}
              </button>
              <button className={item} onClick={() => { setText(""); setMode("join"); }}>
                <Link2 size={14} /> {t("Unirme a un espacio con un código")}
              </button>
              {active.team ? (
                <button className={item} onClick={() => { onInfo(); close(); }}>
                  <Users size={14} /> {t("Equipo: código y opciones")}
                </button>
              ) : (
                <button className={item} onClick={() => { onShare(); close(); }}>
                  <Share2 size={14} /> {t("Compartir este espacio con un equipo")}
                </button>
              )}
              <button className={item} onClick={() => { setText(active.name); setMode("rename"); }}>
                <Pencil size={13} /> {t("Renombrar este espacio")}
              </button>
              <button
                className={`${item} ${confirmDel ? "text-rose" : ""}`}
                disabled={list.length <= 1}
                onClick={() => {
                  if (!confirmDel) return setConfirmDel(true);
                  onDelete(active.id);
                  close();
                }}
              >
                <Trash2 size={13} /> {confirmDel ? t("Pulsa otra vez: se borra con todo lo que contiene") : t("Eliminar este espacio")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
