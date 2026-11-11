import { useState } from "react";
import { ChevronDown, ChevronRight, FileUp, Plus, Settings } from "lucide-react";
import SidebarTree, { type TreeActions } from "./SidebarTree";
import KVEditor from "./KVEditor";
import { clampSidebar, SIDEBAR_DEFAULT } from "../lib/prefs";
import type { KV, TreeNode } from "../types";

interface Props extends TreeActions {
  collections: TreeNode[];
  selectedPath: string | null;
  importing: boolean;
  error: string | null;
  vars: KV[];
  onVars: (v: KV[]) => void;
  onImport: () => void;
  onNewCollection: () => void;
  onSettings: () => void;
  /** Ancho actual en px y callback al arrastrar el borde derecho. */
  width: number;
  onWidth: (w: number) => void;
}

export default function Sidebar({
  collections, selectedPath, importing, error, vars, onVars, onImport, onNewCollection, onSettings, width, onWidth, ...actions
}: Props) {
  const [showVars, setShowVars] = useState(false);

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
    <aside style={{ width }} className="fs-scale fs-sidebar relative flex shrink-0 flex-col bg-deep">
      {/* Asa para cambiar el ancho (doble clic = tamaño original) */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => onWidth(SIDEBAR_DEFAULT)}
        title="Arrastra para cambiar el ancho · doble clic para restaurar"
        className="group absolute -right-1.5 top-0 z-30 flex h-full w-3 cursor-col-resize justify-center"
      >
        <span className="h-full w-0.5 rounded-full bg-transparent group-hover:bg-iris" />
      </div>
      <div className="p-4">
        <div className="mb-4 flex items-center gap-2 text-2xl font-normal tracking-[-0.04em] text-mist">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="text-iris">
            <path d="M12 2 22 20H2Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          </svg>
          <span className="cosmic-text">Caesar</span>
        </div>
        <button
          onClick={onImport}
          disabled={importing}
          className="btn-aurora flex w-full items-center justify-center gap-2 px-3 py-3 text-xs font-semibold disabled:opacity-50"
        >
          <FileUp size={15} /> {importing ? "Importando…" : "Importar Postman"}
        </button>
        <button
          onClick={onNewCollection}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.025em] text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40"
        >
          <Plus size={15} /> Nueva colección
        </button>
        {error && <p className="mt-2 text-xs text-rose">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {collections.length === 0 ? (
          <p className="p-4 text-center text-xs font-light text-slate">
            Crea una colección, importa una de Postman (v2.1) o pega un cURL en la barra de URL.
          </p>
        ) : (
          collections.map((c, i) => (
            <SidebarTree key={i} node={c} path={`${i}`} depth={0} selectedPath={selectedPath} {...actions} />
          ))
        )}
      </div>

      <div className="border-t border-fg/10">
        <button
          onClick={onSettings}
          className="flex w-full items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver hover:text-mist"
        >
          <Settings size={14} /> Ajustes
        </button>
        <button
          onClick={() => setShowVars((s) => !s)}
          className="flex w-full items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.025em] text-silver hover:text-mist"
        >
          {showVars ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Variables <span className="font-light text-slate">({vars.filter((v) => v.key).length})</span>
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
