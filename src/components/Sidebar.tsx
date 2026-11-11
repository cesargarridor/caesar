import { useState } from "react";
import { ChevronDown, ChevronRight, Download, FileUp, Plus, Settings } from "lucide-react";
import SidebarTree, { type TreeActions } from "./SidebarTree";
import KVEditor from "./KVEditor";
import CatLogo from "./CatLogo";
import { clampSidebar, SIDEBAR_DEFAULT } from "../lib/prefs";
import type { KV, TreeNode } from "../types";
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
  onImport: () => void;
  onNewCollection: () => void;
  onSettings: () => void;
  /** Ancho actual en px y callback al arrastrar el borde derecho. */
  width: number;
  onWidth: (w: number) => void;
}

export default function Sidebar({
  collections, selectedPath, importing, error, vars, onVars, collName, collVars, onCollVars, onImport, onNewCollection, onSettings, width, onWidth, ...actions
}: Props) {
  const [showVars, setShowVars] = useState(false);
  const [showColl, setShowColl] = useState(false);
  const [showExport, setShowExport] = useState(false);
  /** Colecciones de primer nivel (las que se pueden exportar). */
  const exportable = collections.flatMap((c, i) => (c.type === "folder" ? [{ path: String(i), name: c.name }] : []));

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
        <div className="relative flex shrink-0 gap-2">
          <button
            onClick={onImport}
            disabled={importing}
            className="btn-aurora flex min-w-0 flex-1 items-center justify-center gap-2 px-3 py-3 text-xs font-semibold disabled:opacity-50"
          >
            <FileUp size={15} /> {importing ? t("Importando…") : t("Importar")}
          </button>
          <button
            onClick={() => {
              if (exportable.length === 1) actions.onExport(exportable[0].path);
              else setShowExport((s) => !s);
            }}
            disabled={exportable.length === 0}
            title={exportable.length ? t("Exportar una colección (Postman v2.1)") : t("No hay colecciones que exportar")}
            className="flex flex-1 items-center justify-center gap-2 rounded-[10px] px-3 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40 disabled:opacity-40"
          >
            <Download size={15} /> {t("Exportar")}
          </button>
          {showExport && exportable.length > 1 && (
            <>
              <div className="fixed inset-0 z-40" onMouseDown={() => setShowExport(false)} />
              <div className="glass absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl bg-kelp p-1 shadow-lg ring-1 ring-fg/15">
                <p className="eyebrow px-2.5 py-1.5">{t("Exportar colección")}</p>
                {exportable.map((c) => (
                  <button
                    key={c.path}
                    onClick={() => {
                      setShowExport(false);
                      actions.onExport(c.path);
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

      <div className="min-h-[8rem] flex-1 overflow-y-auto pb-2">
        {collections.length === 0 ? (
          <p className="p-4 text-center text-xs font-light text-slate">
            {t("Crea una colección, importa una de Postman (v2.1) o pega un cURL en la barra de URL.")}
          </p>
        ) : (
          collections.map((c, i) => (
            <SidebarTree key={i} node={c} path={`${i}`} depth={0} selectedPath={selectedPath} {...actions} />
          ))
        )}
      </div>

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
