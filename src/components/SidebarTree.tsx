import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, ChevronRight, FilePlus2, Folder, FolderOpen, FolderPlus, Library, Pencil, RefreshCw, Share2, Trash2, Users } from "lucide-react";
import type { RequestNode, TreeNode } from "../types";
import { t } from "../lib/i18n";
import { useAccount } from "../lib/account";

// Colores de método FIJOS: no cambian con el tema.
export const METHOD_COLORS: Record<string, string> = {
  GET: "text-[#3ccfae]",
  POST: "text-[#ffb829]",
  PUT: "text-[#b9a2ff]",
  PATCH: "text-[#ffb829]",
  DELETE: "text-[#ff6b6b]",
  HEAD: "text-[#3ccfae]",
  OPTIONS: "text-[#b9a2ff]",
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
  onExport: (path: string, format?: "json" | "yaml" | "har") => void;
  /** Compartir una colección con un equipo / ver su código. */
  onShare: (path: string) => void;
  onTeamInfo: (path: string) => void;
  /** Rueda de actualizar: baja la colección de equipo solo si hay una versión más nueva. */
  onTeamRefresh: (code: string) => void;
  /** Códigos de equipo que se están actualizando ahora (la rueda gira). */
  refreshingTeams: string[];
  /** Arrastrar y soltar: mueve `from` dentro de la carpeta `to` ("root" = nivel raíz). */
  onMove: (from: string, to: string, pos?: "before" | "after") => void;
  isOpen: (uid?: string) => boolean;
  onToggleOpen: (uid?: string) => void;
  onOpenFolder: (uid?: string) => void;
}

export interface DragState {
  from: string;
  /** Carpeta sobre la que está el cursor y donde se puede soltar (null = ninguna). */
  over: string | null;
  /** Al reordenar: dónde se insertará respecto al elemento `over` (línea de inserción). */
  pos?: "before" | "after";
  x: number;
  y: number;
  label: string;
}

export interface DragProps {
  drag: DragState | null;
  onRowDown: (path: string, label: string, e: React.PointerEvent) => void;
}

interface Props extends TreeActions, DragProps {
  node: TreeNode;
  /** Ruta única del nodo ("0/2/1"). */
  path: string;
  depth: number;
  selectedPath: string | null;
}

function DropLine({ pos, indent }: { pos: "before" | "after"; indent: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-1 z-10 flex items-center"
      style={{ left: indent, [pos === "before" ? "top" : "bottom"]: -1 }}
    >
      <span className="-ml-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
      <span className="h-0.5 flex-1 bg-accent" />
    </div>
  );
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

function IconBtn({ title, onClick, children, danger, disabled }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-disabled={disabled}
      className={`p-0.5 ${disabled ? "cursor-not-allowed text-slate opacity-40" : danger ? "text-rose" : "text-slate hover:text-mist"}`}
    >
      {children}
    </button>
  );
}

/** Componente recursivo: Colección -> Carpetas -> Requests, con colapso y acciones al pasar el ratón. */
export default function SidebarTree(props: Props) {
  const { node, path, depth, selectedPath, renaming } = props;
  const guest = !useAccount().account.is_pro;
  const [confirm, setConfirm] = useState(false);
  const indent = 8 + depth * 14;
  const isCollection = depth === 0;
  const isRenaming = renaming === path;

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  const del = (
    <IconBtn
      title={confirm ? t("Pulsa otra vez para borrar") : t("Eliminar")}
      danger={confirm}
      onClick={() => (confirm ? props.onDelete(path) : setConfirm(true))}
    >
      {confirm ? <Check size={14} /> : <Trash2 size={14} />}
    </IconBtn>
  );

  const dragging = props.drag?.from === path;

  if (node.type === "folder") {
    const open = props.isOpen(node.uid);
    const isOver = props.drag?.over === path;
    const reorder = isOver && !!props.drag?.pos;
    const dropHere = isOver && !reorder;
    return (
      <div data-drop={path} data-kind="folder" data-open={open ? "1" : "0"} className="relative">
        {reorder && props.drag?.pos && <DropLine pos={props.drag.pos} indent={isCollection ? 0 : indent} />}
        <div
          style={{ paddingLeft: indent }}
          className={`group flex items-center gap-1.5 pr-2 text-sm ${
            dropHere
              ? "bg-aqua/20 ring-1 ring-inset ring-aqua"
              : isCollection
                ? "mt-1 border-l-[3px] border-iris bg-iris/10 py-1.5 hover:bg-iris/20"
                : "py-1 hover:bg-fg/5"
          } ${isCollection && dropHere ? "mt-1 py-1.5" : ""} ${dragging ? "opacity-40" : ""}`}
          onClick={() => !isRenaming && props.onToggleOpen(node.uid)}
          onPointerDown={(e) => !isRenaming && props.onRowDown(path, node.name, e)}
          role="button"
        >
          {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          {isCollection ? (
            node.team ? <Users size={16} className="shrink-0 text-aqua" aria-label={t("Colección de equipo")} /> : <Library size={16} className="shrink-0 text-iris" />
          ) : open ? (
            <FolderOpen size={15} className="shrink-0 text-aqua" />
          ) : (
            <Folder size={15} className="shrink-0 text-aqua" />
          )}
          {isRenaming ? (
            <RenameInput initial={node.name} onDone={(v) => props.onRename(path, v)} onCancel={props.onCancelRename} />
          ) : (
            <span className={`flex-1 truncate ${isCollection ? "font-semibold text-mist" : "text-mist"}`} onDoubleClick={() => props.onStartRename(path)}>
              {node.name}
            </span>
          )}
          {!isRenaming && depth === 0 && node.team && (
            <IconBtn title={t("Actualizar colección de equipo")} onClick={() => props.onTeamRefresh(node.team!.code)}>
              <RefreshCw size={14} className={props.refreshingTeams.includes(node.team.code) ? "animate-spin text-aqua" : ""} />
            </IconBtn>
          )}
          {!isRenaming && (
            <span className={`flex items-center gap-0.5 ${confirm ? "" : "invisible group-hover:visible"}`}>
              {!confirm && (
                <>
                  <IconBtn title={t("Nueva petición")} onClick={() => { props.onOpenFolder(node.uid); props.onAddRequest(path); }}><FilePlus2 size={14} /></IconBtn>
                  <IconBtn title={t("Nueva carpeta")} onClick={() => { props.onOpenFolder(node.uid); props.onAddFolder(path); }}><FolderPlus size={14} /></IconBtn>
                  <IconBtn title={t("Renombrar")} onClick={() => props.onStartRename(path)}><Pencil size={13} /></IconBtn>
                  {depth === 0 && (node.team
                    ? <IconBtn title={t("Equipo: código y opciones")} onClick={() => props.onTeamInfo(path)}><Users size={14} /></IconBtn>
                    : <IconBtn disabled={guest} title={guest ? t("Compartir con un equipo (requiere el plan Pro)") : t("Compartir con un equipo")} onClick={() => !guest && props.onShare(path)}><Share2 size={14} /></IconBtn>)}
                  {depth === 0 && <IconBtn title={t("Exportar colección (JSON)")} onClick={() => props.onExport(path)}><Download size={14} /></IconBtn>}
                </>
              )}
              {del}
            </span>
          )}
        </div>
        {open &&
          (node.children.length === 0 ? (
            <p style={{ paddingLeft: indent + 34 }} className="py-1 text-xs text-slate" data-drop={path}>{t("Vacío")}</p>
          ) : (
            node.children.map((child, i) => (
              <SidebarTree key={child.type === "folder" ? (child.uid ?? i) : i} {...props} node={child} path={`${path}/${i}`} depth={depth + 1} />
            ))
          ))}
      </div>
    );
  }

  const selected = selectedPath === path;
  const lineHere = props.drag?.over === path ? props.drag.pos : undefined;
  return (
    <div
      data-drop={path}
      data-kind="request"
      style={{ paddingLeft: indent + 18 }}
      className={`relative group flex items-center gap-2 py-1 pr-2 text-sm hover:bg-fg/5 ${selected ? "bg-fg/10" : ""} ${dragging ? "opacity-40" : ""}`}
      onClick={() => !isRenaming && props.onSelect(path, node)}
      onPointerDown={(e) => !isRenaming && props.onRowDown(path, node.name, e)}
      role="button"
    >
      {lineHere && <DropLine pos={lineHere} indent={indent + 6} />}
      <span className={`min-w-[3rem] shrink-0 text-[10px] font-semibold ${METHOD_COLORS[node.method] ?? "text-silver"}`}>{node.method}</span>
      {isRenaming ? (
        <RenameInput initial={node.name} onDone={(v) => props.onRename(path, v)} onCancel={props.onCancelRename} />
      ) : (
        <span className="flex-1 truncate" onDoubleClick={() => props.onStartRename(path)}>{node.name}</span>
      )}
      {!isRenaming && (
        <span className={`flex items-center gap-0.5 ${confirm ? "" : "invisible group-hover:visible"}`}>
          {!confirm && <IconBtn title={t("Renombrar")} onClick={() => props.onStartRename(path)}><Pencil size={13} /></IconBtn>}
          {del}
        </span>
      )}
    </div>
  );
}
