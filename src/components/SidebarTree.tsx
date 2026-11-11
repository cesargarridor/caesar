import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, ChevronRight, FilePlus2, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import type { RequestNode, TreeNode } from "../types";

// Colores de método FIJOS: no cambian con el tema.
export const METHOD_COLORS: Record<string, string> = {
  GET: "text-[#3ccfae]",
  POST: "text-[#ffb829]",
  PUT: "text-[#b9a2ff]",
  PATCH: "text-[#ffb829]",
  DELETE: "text-[#ff6b6b]",
};

export interface TreeActions {
  renaming: string | null;
  onSelect: (path: string, req: RequestNode) => void;
  onStartRename: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onCancelRename: () => void;
  onAddRequest: (path: string) => void;
  onAddFolder: (path: string) => void;
  onDelete: (path: string) => void;
  onExport: (path: string) => void;
}

interface Props extends TreeActions {
  node: TreeNode;
  /** Ruta única del nodo ("0/2/1"). */
  path: string;
  depth: number;
  selectedPath: string | null;
}

function RenameInput({ initial, onDone, onCancel }: { initial: string; onDone: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => (v.trim() ? onDone(v.trim()) : onCancel())}
      onKeyDown={(e) => {
        if (e.key === "Enter") v.trim() ? onDone(v.trim()) : onCancel();
        if (e.key === "Escape") onCancel();
      }}
      className="min-w-0 flex-1 rounded-lg bg-kelp px-2 py-0.5 text-sm text-mist outline-none ring-1 ring-aqua"
    />
  );
}

function IconBtn({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`p-0.5 ${danger ? "text-rose" : "text-slate hover:text-mist"}`}
    >
      {children}
    </button>
  );
}

/** Componente recursivo: Colección -> Carpetas -> Requests, con colapso y acciones al pasar el ratón. */
export default function SidebarTree(props: Props) {
  const { node, path, depth, selectedPath, renaming } = props;
  const [open, setOpen] = useState(depth === 0);
  const [confirm, setConfirm] = useState(false);
  const indent = 8 + depth * 14;
  const isRenaming = renaming === path;

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  const del = (
    <IconBtn
      title={confirm ? "Pulsa otra vez para borrar" : "Eliminar"}
      danger={confirm}
      onClick={() => (confirm ? props.onDelete(path) : setConfirm(true))}
    >
      {confirm ? <Check size={14} /> : <Trash2 size={14} />}
    </IconBtn>
  );

  if (node.type === "folder") {
    return (
      <div>
        <div
          style={{ paddingLeft: indent }}
          className="group flex items-center gap-1.5 py-1 pr-2 text-sm hover:bg-fg/5"
          onClick={() => !isRenaming && setOpen((o) => !o)}
          role="button"
        >
          {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          {open ? <FolderOpen size={15} className="shrink-0 text-aqua" /> : <Folder size={15} className="shrink-0 text-aqua" />}
          {isRenaming ? (
            <RenameInput initial={node.name} onDone={(v) => props.onRename(path, v)} onCancel={props.onCancelRename} />
          ) : (
            <span className="flex-1 truncate text-mist" onDoubleClick={() => props.onStartRename(path)}>
              {node.name}
            </span>
          )}
          {!isRenaming && (
            <span className={`flex items-center gap-0.5 ${confirm ? "" : "invisible group-hover:visible"}`}>
              {!confirm && (
                <>
                  <IconBtn title="Nueva petición" onClick={() => { setOpen(true); props.onAddRequest(path); }}><FilePlus2 size={14} /></IconBtn>
                  <IconBtn title="Nueva carpeta" onClick={() => { setOpen(true); props.onAddFolder(path); }}><FolderPlus size={14} /></IconBtn>
                  <IconBtn title="Renombrar" onClick={() => props.onStartRename(path)}><Pencil size={13} /></IconBtn>
                  {depth === 0 && <IconBtn title="Exportar colección (Postman v2.1)" onClick={() => props.onExport(path)}><Download size={14} /></IconBtn>}
                </>
              )}
              {del}
            </span>
          )}
        </div>
        {open &&
          (node.children.length === 0 ? (
            <p style={{ paddingLeft: indent + 34 }} className="py-1 text-xs text-slate">Vacío</p>
          ) : (
            node.children.map((child, i) => (
              <SidebarTree key={i} {...props} node={child} path={`${path}/${i}`} depth={depth + 1} />
            ))
          ))}
      </div>
    );
  }

  const selected = selectedPath === path;
  return (
    <div
      style={{ paddingLeft: indent + 18 }}
      className={`group flex items-center gap-2 py-1 pr-2 text-sm hover:bg-fg/5 ${selected ? "bg-fg/10" : ""}`}
      onClick={() => !isRenaming && props.onSelect(path, node)}
      role="button"
    >
      <span className={`w-12 shrink-0 text-[10px] font-semibold ${METHOD_COLORS[node.method] ?? "text-silver"}`}>{node.method}</span>
      {isRenaming ? (
        <RenameInput initial={node.name} onDone={(v) => props.onRename(path, v)} onCancel={props.onCancelRename} />
      ) : (
        <span className="flex-1 truncate" onDoubleClick={() => props.onStartRename(path)}>{node.name}</span>
      )}
      {!isRenaming && (
        <span className={`flex items-center gap-0.5 ${confirm ? "" : "invisible group-hover:visible"}`}>
          {!confirm && <IconBtn title="Renombrar" onClick={() => props.onStartRename(path)}><Pencil size={13} /></IconBtn>}
          {del}
        </span>
      )}
    </div>
  );
}
