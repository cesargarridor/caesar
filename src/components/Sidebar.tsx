import { useEffect, useRef, useState } from "react";
import { Download, FileUp, History, Maximize2, MoreHorizontal, Plus, RefreshCw, Settings, SlidersHorizontal, Variable } from "lucide-react";
import SidebarTree, { type DragState, type TreeActions } from "./SidebarTree";
import VarTable from "./VarTable";
import ProfilesPanel from "./ProfilesPanel";
import CatLogo from "./CatLogo";
import HistoryPanel from "./HistoryPanel";
import type { HistoryEntry } from "../api";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import type { WsMeta } from "../lib/workspaces";
import { clampSidebar, SIDEBAR_DEFAULT } from "../lib/prefs";
import { canMove, canMoveRelative } from "../lib/tree";
import type { KV, ProfilesState, TreeNode } from "../types";
import type { VarsSection } from "./VarsDialog";
import { t } from "../lib/i18n";

interface Props extends TreeActions {
  collections: TreeNode[];
  selectedPath: string | null;
  importing: boolean;
  error: string | null;
  vars: KV[];
  onVars: (v: KV[]) => void;
  /** Perfiles de variables (Desarrollo, Producción…) y el activo. */
  profiles: ProfilesState;
  onProfiles: (p: ProfilesState) => void;
  /** Sube cada vez que se pide «Gestionar perfiles…» desde el selector: abre esa sección. */
  manageProfilesTick: number;
  /** Abre el editor grande (globales, perfiles…). Las variables y la autorización de cada colección se editan desde su icono en el árbol. */
  onOpenVars: (section: VarsSection) => void;
  workspaces: WsMeta[];
  activeWs: string;
  onSwitchWs: (id: string) => void;
  onAddWs: (name: string) => void;
  onRenameWs: (id: string, name: string) => void;
  onDeleteWs: (id: string) => void;
  onShareWs: () => void;
  onInfoWs: () => void;
  onJoinWs: (code: string) => Promise<void>;
  onRefreshWs: () => void;
  refreshingWs: boolean;
  onImport: () => void;
  /** Importar un OpenAPI / Swagger (JSON o YAML). */
  onImportOpenApi: () => void;
  /** Abrir una petición del historial en una pestaña nueva. */
  onOpenHistory: (e: HistoryEntry) => void;
  onNewCollection: () => void;
  onSettings: () => void;
  /** Sincronización rápida (cuenta entre ordenadores + espacio y colecciones compartidas si las hay). */
  onSync?: () => void;
  syncing?: boolean;
  /** Ancho actual en px y callback al arrastrar el borde derecho. */
  width: number;
  onWidth: (w: number) => void;
}

export default function Sidebar({
  collections, selectedPath, importing, error, vars, onVars, profiles, onProfiles, manageProfilesTick, onOpenVars, workspaces, activeWs, onSwitchWs, onAddWs, onRenameWs, onDeleteWs, onShareWs, onInfoWs, onJoinWs, onRefreshWs, refreshingWs, onImport, onImportOpenApi, onOpenHistory, onNewCollection, onSettings, onSync, syncing, width, onWidth, ...actions
}: Props) {
  const [dock, setDock] = useState<"history" | "vars" | "profiles" | null>(null);
  useEffect(() => {
    if (manageProfilesTick > 0) setDock("profiles");
  }, [manageProfilesTick]);
  const [showExport, setShowExport] = useState(false);
  const [fmt, setFmt] = useState<"json" | "yaml" | "har">("json");
  /** Colecciones de primer nivel (las que se pueden exportar). */
  const exportable = collections.flatMap((c, i) => (c.type === "folder" ? [{ path: String(i), name: c.name }] : []));

  // Arrastrar y soltar en el árbol, con eventos de puntero (el DnD nativo no funciona en la webview de Windows).
  const [drag, setDrag] = useState<DragState | null>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelDrag.current?.(), []);

  const onRowDown = (path: string, label: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const isRoot = !path.includes("/");
    if ((e.target as HTMLElement).closest("button,input")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    let over: string | null = null;
    let pos: "before" | "after" | undefined;
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      cancelDrag.current = null;
      setDrag(null);
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        started = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const hit = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
      const target = hit?.dataset.drop ?? null;
      pos = undefined;
      if (isRoot) {
        // Reordenar colecciones: antes/después de la colección sobre la que está el cursor.
        const last = String(collections.length - 1);
        const key = target === "root" ? last : target ? target.split("/")[0] : null;
        over = key && key !== path ? key : null;
        if (over) {
          const head = document.querySelector<HTMLElement>(`[data-drop="${over}"]`)?.firstElementChild;
          const r = head?.getBoundingClientRect();
          pos = target !== "root" && r && ev.clientY < r.top + r.height / 2 ? "before" : "after";
        }
      } else {
        over = null;
        if (target && target !== "root" && hit) {
          // Línea de inserción entre elementos: bordes de la fila (20 %) = antes/después; el centro de una carpeta = dentro.
          const isFolder = hit.dataset.kind === "folder";
          const row = isFolder ? (hit.firstElementChild as HTMLElement | null) : hit;
          const r = row?.getBoundingClientRect();
          const f = r && r.height ? (ev.clientY - r.top) / r.height : 0.5;
          const isColl = !target.includes("/");
          if (!isColl && canMoveRelative(path, target)) {
            if (!isFolder) pos = f < 0.5 ? "before" : "after";
            else if (f < 0.2) pos = "before";
            else if (f > 0.8 && hit.dataset.open !== "1") pos = "after";
          }
          if (pos) over = target;
        }
        if (!over) over = target && canMove(path, target) ? target : null;
      }
      setDrag({ from: path, over, pos, x: ev.clientX, y: ev.clientY, label });
    };
    const up = () => {
      const wasDrag = started;
      const target = over;
      const where = pos;
      cleanup();
      if (!wasDrag) return;
      // El clic que sigue a soltar no debe abrir/cerrar la carpeta ni abrir la petición.
      const swallow = (ce: Event) => ce.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 50);
      if (target) actions.onMove(path, target, where);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        started = false;
        over = null;
        cleanup();
      }
    };
    cancelDrag.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = width;
    el.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => onWidth(clampSidebar(startW + ev.clientX - startX));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <aside style={{ width }} className="fs-scale fs-sidebar relative flex shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-deep">
      {/* Asa para cambiar el ancho (doble clic = tamaño original) */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => onWidth(SIDEBAR_DEFAULT)}
        title={t("Arrastra para cambiar el ancho · doble clic para restaurar")}
        className="group absolute right-0 top-0 z-30 flex h-full w-2 cursor-col-resize justify-center"
      >
        <span className="h-full w-0.5 rounded-full bg-transparent group-hover:bg-iris" />
      </div>
      <div className="shrink-0 p-4">
        <div className="mb-4 flex items-center gap-2 text-2xl font-normal tracking-[-0.04em] text-mist">
          <CatLogo size={30} />
          <span className="cosmic-text">Caesar</span>
        </div>
        <WorkspaceSwitcher list={workspaces} activeId={activeWs} onSwitch={onSwitchWs} onAdd={onAddWs} onRename={onRenameWs} onDelete={onDeleteWs} onShare={onShareWs} onInfo={onInfoWs} onJoin={onJoinWs} onRefresh={onRefreshWs} refreshing={refreshingWs} onGoPro={actions.onGoPro} />
      </div>

      <div className="relative flex shrink-0 items-center gap-1 px-4 pb-1">
        <span className="eyebrow flex-1">{t("Colecciones")}</span>
        <button onClick={onNewCollection} className="rounded-md p-1.5 text-silver hover:bg-fg/10 hover:text-aqua" title={t("Nueva colección")} aria-label={t("Nueva colección")}>
          <Plus size={16} />
        </button>
        <button onClick={() => setShowExport((s) => !s)} className="rounded-md p-1.5 text-silver hover:bg-fg/10 hover:text-mist" title={t("Importar y exportar")} aria-label={t("Importar y exportar")} aria-haspopup="menu" aria-expanded={showExport}>
          <MoreHorizontal size={16} />
        </button>
        {showExport && (
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setShowExport(false)} />
            <div role="menu" className="glass absolute right-3 top-full z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-xl bg-kelp p-1 shadow-lg ring-1 ring-fg/15">
              <button role="menuitem" disabled={importing} onClick={() => { setShowExport(false); onImport(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-silver hover:bg-fg/10 hover:text-mist disabled:opacity-50">
                <FileUp size={14} /> {importing ? t("Importando…") : t("Importar")}
              </button>
              <button role="menuitem" disabled={importing} onClick={() => { setShowExport(false); onImportOpenApi(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-silver hover:bg-fg/10 hover:text-mist disabled:opacity-50">
                <FileUp size={14} /> {t("Importar OpenAPI")}
              </button>
              <p className="eyebrow flex items-center gap-1.5 px-2.5 pb-1 pt-2"><Download size={12} /> {t("Exportar")}</p>
              {exportable.length === 0 ? (
                <p className="px-2.5 py-1.5 text-xs text-slate">{t("No hay colecciones que exportar")}</p>
              ) : (
                <>
                  <div className="mb-1 flex gap-1 px-1.5">
                    {([["json", "JSON"], ["yaml", "YAML"], ["har", "HAR"]] as const).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setFmt(id)}
                        title={id === "json" ? "JSON" : id === "yaml" ? "YAML" : "HTTP Archive 1.2"}
                        className={`flex-1 rounded-lg px-2 py-1 text-xs ${fmt === id ? "bg-aqua/20 text-aqua ring-1 ring-aqua" : "text-silver ring-1 ring-fg/15 hover:text-mist"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {exportable.map((c) => (
                    <button
                      key={c.path}
                      onClick={() => { setShowExport(false); actions.onExport(c.path, fmt); }}
                      className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-silver hover:bg-fg/10 hover:text-mist"
                      title={c.name}
                    >
                      {c.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {error && <p className="shrink-0 px-4 pb-1 text-xs text-rose">{error}</p>}
      <div
        data-drop="root"
        className={`min-h-[8rem] flex-1 overflow-y-auto pb-2 ${drag?.over === "root" ? "bg-aqua/10 ring-1 ring-inset ring-aqua" : ""}`}
      >
        {collections.length === 0 ? (
          <p className="p-4 text-center text-xs font-light text-slate">
            {t("Crea una colección, importa una (JSON, YAML o HAR) o pega un cURL en la barra de URL.")}
          </p>
        ) : (
          collections.map((c, i) => (
            <SidebarTree key={c.type === "folder" ? (c.uid ?? i) : i} node={c} path={`${i}`} depth={0} selectedPath={selectedPath} drag={drag} onRowDown={onRowDown} {...actions} />
          ))
        )}
      </div>

      {drag && (
        <div
          style={{ left: drag.x + 12, top: drag.y + 8 }}
          className="pointer-events-none fixed z-[60] max-w-[14rem] truncate rounded-lg bg-iris px-2.5 py-1 text-xs font-semibold text-onprimary shadow-lg"
        >
          {drag.label}
        </div>
      )}

      <div className="shrink-0 border-t border-fg/10">
        {dock === "history" && (
          <div className="max-h-[40vh] overflow-y-auto"><HistoryPanel bare onOpen={onOpenHistory} /></div>
        )}
        {dock === "vars" && (
          <div className="max-h-[40vh] overflow-y-auto p-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="eyebrow">{t("Variables globales")} <span className="font-light text-slate">({vars.filter((v) => v.key).length})</span></span>
              <button onClick={() => onOpenVars("globals")} className="text-slate hover:text-aqua" title={t("Abrir en una ventana grande")} aria-label={t("Abrir en una ventana grande")}><Maximize2 size={13} /></button>
            </div>
            <VarTable compact rows={vars} onChange={onVars} />
          </div>
        )}
        {dock === "profiles" && (
          <div className="max-h-[40vh] overflow-y-auto p-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="eyebrow">{t("Perfiles de variables")} <span className="font-light text-slate">({profiles.list.length})</span></span>
              <button onClick={() => onOpenVars("profiles")} className="text-slate hover:text-aqua" title={t("Abrir en una ventana grande")} aria-label={t("Abrir en una ventana grande")}><Maximize2 size={13} /></button>
            </div>
            <ProfilesPanel profiles={profiles} onChange={onProfiles} />
          </div>
        )}
        <div className="flex items-center justify-around px-2 py-1.5">
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              title={t("Sincronizar ahora")}
              aria-label={t("Sincronizar ahora")}
              className="rounded-lg p-2 text-silver hover:bg-fg/10 hover:text-mist"
            >
              <RefreshCw size={16} className={syncing ? "animate-spin text-aqua" : ""} />
            </button>
          )}
          {([
            ["history", History, t("Historial")],
            ["vars", Variable, t("Variables globales")],
            ["profiles", SlidersHorizontal, t("Perfiles de variables")],
          ] as const).map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={() => setDock((d) => (d === id ? null : id))}
              aria-pressed={dock === id}
              title={label}
              aria-label={label}
              className={`rounded-lg p-2 ${dock === id ? "bg-aqua/15 text-aqua" : "text-silver hover:bg-fg/10 hover:text-mist"}`}
            >
              <Icon size={16} />
            </button>
          ))}
          <button onClick={onSettings} title={t("Ajustes")} aria-label={t("Ajustes")} className="rounded-lg p-2 text-silver hover:bg-fg/10 hover:text-mist">
            <Settings size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
