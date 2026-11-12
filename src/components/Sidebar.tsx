import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileUp, Plus, Settings } from "lucide-react";
import SidebarTree, { type DragState, type TreeActions } from "./SidebarTree";
import KVEditor from "./KVEditor";
import AuthEditor from "./AuthEditor";
import CatLogo from "./CatLogo";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import type { WsMeta } from "../lib/workspaces";
import { clampSidebar, SIDEBAR_DEFAULT } from "../lib/prefs";
import { canMove, canMoveRelative } from "../lib/tree";
import type { AuthData, KV, TreeNode } from "../types";
import { t } from "../lib/i18n";

interface Props extends TreeActions {
  collections: TreeNode[];
  selectedPath: string | null;
  importing: boolean;
  error: string | null;
  vars: KV[];
  onVars: (v: KV[]) => void;
  /** Variables de la colección de la pestaña activa (pisan a las globales). */
  collName: string | null;
  collVars: KV[];
  onCollVars: (v: KV[]) => void;
  /** Autorización de la colección (la usan las peticiones con "Inherit"). */
  collAuth: AuthData | null;
  onCollAuth: (a: AuthData) => void;
  workspaces: WsMeta[];
  activeWs: string;
  onSwitchWs: (id: string) => void;
  onAddWs: (name: string) => void;
  onRenameWs: (id: string, name: string) => void;
  onDeleteWs: (id: string) => void;
  onImport: () => void;
  onNewCollection: () => void;
  onSettings: () => void;
  /** Ancho actual en px y callback al arrastrar el borde derecho. */
  width: number;
  onWidth: (w: number) => void;
}

export default function Sidebar({
  collections, selectedPath, importing, error, vars, onVars, collName, collVars, onCollVars, collAuth, onCollAuth, workspaces, activeWs, onSwitchWs, onAddWs, onRenameWs, onDeleteWs, onImport, onNewCollection, onSettings, width, onWidth, ...actions
}: Props) {
  const [showVars, setShowVars] = useState(false);
  const [showColl, setShowColl] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
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
          // Línea de inserción entre elementos: arriba/abajo de la fila = antes/después; centro de una carpeta = dentro.
          const isFolder = hit.dataset.kind === "folder";
          const row = isFolder ? (hit.firstElementChild as HTMLElement | null) : hit;
          const r = row?.getBoundingClientRect();
          const f = r && r.height ? (ev.clientY - r.top) / r.height : 0.5;
          const isColl = !target.includes("/");
          if (!isColl && canMoveRelative(path, target)) {
            if (!isFolder) pos = f < 0.5 ? "before" : "after";
            else if (f < 0.25) pos = "before";
            else if (f > 0.75 && hit.dataset.open !== "1") pos = "after";
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
        <WorkspaceSwitcher list={workspaces} activeId={activeWs} onSwitch={onSwitchWs} onAdd={onAddWs} onRename={onRenameWs} onDelete={onDeleteWs} />
        <div className="relative flex shrink-0 gap-2">
          <button
            onClick={onImport}
            disabled={importing}
            className="btn-aurora flex min-w-0 flex-1 items-center justify-center gap-2 px-3 py-3 text-xs font-semibold disabled:opacity-50"
          >
            <FileUp size={15} /> {importing ? t("Importando…") : t("Importar")}
          </button>
          <button
            onClick={() => setShowExport((s) => !s)}
            disabled={exportable.length === 0}
            title={exportable.length ? t("Exportar una colección (JSON, YAML o HAR)") : t("No hay colecciones que exportar")}
            className="flex flex-1 items-center justify-center gap-2 rounded-[10px] px-3 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40 disabled:opacity-40"
          >
            <Download size={15} /> {t("Exportar")}
          </button>
          {showExport && exportable.length > 0 && (
            <>
              <div className="fixed inset-0 z-40" onMouseDown={() => setShowExport(false)} />
              <div className="glass absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl bg-kelp p-1 shadow-lg ring-1 ring-fg/15">
                <p className="eyebrow px-2.5 py-1.5">{t("Formato")}</p>
                <div className="mb-1 flex gap-1 px-1.5">
                  {([["json", "JSON"], ["yaml", "YAML"], ["har", "HAR"]] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setFmt(id)}
                      title={id === "json" ? "JSON" : id === "yaml" ? "YAML" : "HTTP Archive 1.2"}
                      className={`flex-1 rounded-lg px-2 py-1 text-xs ${fmt === id ? "bg-aqua text-ink" : "text-silver ring-1 ring-fg/15 hover:text-mist"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="eyebrow px-2.5 py-1.5">{t("Exportar colección")}</p>
                {exportable.map((c) => (
                  <button
                    key={c.path}
                    onClick={() => {
                      setShowExport(false);
                      actions.onExport(c.path, fmt);
                    }}
                    className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-silver hover:bg-fg/10 hover:text-mist"
                    title={c.name}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={onNewCollection}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40"
        >
          <Plus size={15} /> {t("Nueva colección")}
        </button>
        {error && <p className="mt-2 text-xs text-rose">{error}</p>}
      </div>

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
        <button
          onClick={onSettings}
          className="flex w-full items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver hover:text-mist"
        >
          <Settings size={14} /> {t("Ajustes")}
        </button>
        <button
          onClick={() => setShowColl((s) => !s)}
          className="flex w-full items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver hover:text-mist"
        >
          {showColl ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="truncate">{t("Variables de colección")}</span>{" "}
          <span className="font-light text-slate">({collVars.filter((v) => v.key).length})</span>
        </button>
        {showColl && (
          <div className="max-h-64 overflow-y-auto p-2">
            {collName === null ? (
              <p className="px-2 py-2 text-xs text-slate">{t("Abre una petición de una colección para editar sus variables.")}</p>
            ) : (
              <>
                <p className="eyebrow truncate px-1 pb-1.5" title={collName}>{collName}</p>
                <KVEditor rows={collVars} onChange={onCollVars} keyPlaceholder="nombre" />
              </>
            )}
          </div>
        )}
        <button
          onClick={() => setShowAuth((s) => !s)}
          className="flex w-full items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver hover:text-mist"
        >
          {showAuth ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="truncate">{t("Autorización de la colección")}</span>{" "}
          {collAuth && collAuth.type !== "none" && <span className="font-bold text-aqua">•</span>}
        </button>
        {showAuth && (
          <div className="max-h-72 overflow-y-auto p-2">
            {collAuth === null ? (
              <p className="px-2 py-2 text-xs text-slate">{t("Abre una petición de una colección para editar su autorización.")}</p>
            ) : (
              <>
                <p className="eyebrow truncate px-1 pb-1.5" title={collName ?? ""}>{collName}</p>
                <div className="[&_label]:flex-col [&_label]:items-start [&_label]:gap-1 [&_input]:max-w-none [&_select]:max-w-none [&_span.relative]:max-w-none">
                  <AuthEditor auth={collAuth} onChange={onCollAuth} allowInherit={false} />
                </div>
              </>
            )}
          </div>
        )}
        <button
          onClick={() => setShowVars((s) => !s)}
          className="flex w-full items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver hover:text-mist"
        >
          {showVars ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("Variables globales")} <span className="font-light text-slate">({vars.filter((v) => v.key).length})</span>
        </button>
        {showVars && (
          <div className="max-h-64 overflow-y-auto p-2">
            <KVEditor rows={vars} onChange={onVars} keyPlaceholder="nombre" />
          </div>
        )}
      </div>
    </aside>
  );
}
