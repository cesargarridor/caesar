import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DelayTip from "./DelayTip";
import { Check, ChevronDown, Download, ChevronRight, Copy, FilePlus2, Folder, Play, Plug, Server, FolderOpen, FolderInput, FolderPlus, Library, Lock, MoreHorizontal, Pencil, Plus, RefreshCw, Share2, SlidersHorizontal, Trash2, Users } from "lucide-react";
import type { RequestNode, TreeNode } from "../types";
import { t } from "../lib/i18n";
import { useAccount } from "../lib/account";

// Colores de método: mismo tono en todos los temas, ajustado en applyTheme para que siempre se lean (4.5:1).
export const METHOD_COLORS: Record<string, string> = {
  GET: "text-[var(--t-m-get)]",
  POST: "text-[var(--t-m-post)]",
  PUT: "text-[var(--t-m-put)]",
  PATCH: "text-[var(--t-m-post)]",
  DELETE: "text-[var(--t-m-del)]",
  HEAD: "text-[var(--t-m-get)]",
  OPTIONS: "text-[var(--t-m-put)]",
  WS: "text-[var(--t-m-ws)]",
};

export interface TreeActions {
  renaming: string | null;
  onSelect: (path: string, req: RequestNode) => void;
  onStartRename: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onCancelRename: () => void;
  onAddRequest: (path: string) => void;
  /** Nueva petición WebSocket dentro de la carpeta. */
  onAddSocket: (path: string) => void;
  onAddFolder: (path: string) => void;
  /** Clonar la petición o carpeta (la copia queda justo debajo). */
  onClone: (path: string) => void;
  onDelete: (path: string) => void;
  onExport: (path: string, format?: "json" | "yaml" | "har") => void;
  /** Compartir una colección con un equipo / ver su código. */
  onShare: (path: string) => void;
  /** Collection Runner (Pro): ejecutar la carpeta con un CSV. */
  onRun: (path: string) => void;
  /** Servidor Mock local con las peticiones de la carpeta. */
  onMock: (path: string) => void;
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
  /** Abre el editor de variables y autorización de la colección (carpeta raíz). */
  onCollSettings: (path: string) => void;
  /** Abre Ajustes en la sección de cuenta (función que requiere Pro). */
  onGoPro: () => void;
  /** Abre el selector «Mover a…» para el elemento (carpeta o petición, no colecciones). */
  onMoveTo: (path: string) => void;
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
      <span className="-ml-1 h-2 w-2 shrink-0 rounded-full bg-aqua" />
      <span className="h-0.5 flex-1 bg-aqua shadow-[0_0_6px_var(--t-accent)]" />
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
      className="min-w-0 flex-1 select-text rounded-lg bg-kelp px-2 py-0.5 text-sm text-mist outline-none ring-1 ring-aqua"
    />
  );
}

function IconBtn({ title, onClick, children, danger, disabled }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
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

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** No cierra el menú al pulsar (confirmación de borrado). */
  keepOpen?: boolean;
  /** Requiere Pro y el usuario no lo tiene: se ve en gris con candado, avisa y al pulsar lleva a la cuenta. */
  locked?: boolean;
  /** Línea separadora encima. */
  sep?: boolean;
}

/** Menú flotante pequeño anclado a unas coordenadas; se cierra al pulsar fuera o con Escape. */
function FloatMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [x, y, onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
        className="fixed min-w-[13rem] rounded-xl border border-fg/10 bg-kelp p-1 shadow-xl"
      >
        {items.map((it) => (
          <div key={it.label}>
            {it.sep && <div className="my-1 h-px bg-fg/10" />}
            <button
              role="menuitem"
              aria-disabled={it.disabled || it.locked}
              title={it.locked ? t("Requiere el plan Pro") : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (it.disabled) return;
                if (!it.keepOpen) onClose();
                it.onClick();
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
                it.disabled ? "cursor-not-allowed text-slate opacity-50" : it.locked ? "text-slate opacity-60 hover:bg-fg/10" : it.danger ? "text-rose hover:bg-fg/10" : "text-silver hover:bg-fg/10 hover:text-mist"
              }`}
            >
              {it.icon}
              {it.label}
              {it.locked && <Lock size={12} className="ml-auto shrink-0" aria-hidden />}
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Componente recursivo: Colección -> Carpetas -> Requests, con colapso y acciones al pasar el ratón. */
export default function SidebarTree(props: Props) {
  const { node, path, depth, selectedPath, renaming } = props;
  const guest = !useAccount().account.is_pro;
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "add" | "more" | "all" } | null>(null);
  const indent = 8 + depth * 14;
  const isCollection = depth === 0;
  const isRenaming = renaming === path;

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  const dragging = props.drag?.from === path;
  const closeMenu = () => { setMenu(null); setConfirm(false); };
  const delItem: MenuItem = {
    label: confirm ? t("Pulsa otra vez para borrar") : t("Eliminar"),
    icon: confirm ? <Check size={14} /> : <Trash2 size={14} />,
    danger: true,
    keepOpen: !confirm,
    sep: true,
    onClick: () => (confirm ? props.onDelete(path) : setConfirm(true)),
  };
  const openAt = (kind: "add" | "more") => (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, kind });
  };
  const addItems: MenuItem[] = [
    { label: t("Nueva petición"), icon: <FilePlus2 size={14} />, onClick: () => { props.onOpenFolder(node.type === "folder" ? node.uid : undefined); props.onAddRequest(path); } },
    { label: t("Nueva petición WebSocket"), icon: <Plug size={14} />, onClick: () => { props.onOpenFolder(node.type === "folder" ? node.uid : undefined); props.onAddSocket(path); } },
    { label: t("Nueva carpeta"), icon: <FolderPlus size={14} />, onClick: () => { props.onOpenFolder(node.type === "folder" ? node.uid : undefined); props.onAddFolder(path); } },
  ];
  const moreItems: MenuItem[] = node.type === "folder"
    ? [
        { label: t("Renombrar"), icon: <Pencil size={14} />, onClick: () => props.onStartRename(path) },
        { label: t("Clonar"), icon: <Copy size={14} />, onClick: () => props.onClone(path) },
        ...(depth > 0 ? [{ label: t("Mover a…"), icon: <FolderInput size={14} />, onClick: () => props.onMoveTo(path) }] : []),
        ...(depth === 0 ? [{ label: t("Variables y autorización de la colección"), icon: <SlidersHorizontal size={14} />, onClick: () => props.onCollSettings(path) }] : []),
        { label: t("Servidor Mock (gratis)"), icon: <Server size={14} />, onClick: () => props.onMock(path) },
        ...(depth === 0
          ? [
              node.team
                ? { label: t("Equipo: código y opciones"), icon: <Users size={14} />, onClick: () => props.onTeamInfo(path) }
                : { label: t("Compartir con un equipo"), icon: <Share2 size={14} />, locked: guest, onClick: () => (guest ? props.onGoPro() : props.onShare(path)) },
              { label: t("Exportar colección (JSON)"), icon: <Download size={14} />, onClick: () => props.onExport(path) },
            ]
          : []),
        delItem,
      ]
    : [
        { label: t("Renombrar"), icon: <Pencil size={14} />, onClick: () => props.onStartRename(path) },
        { label: t("Clonar"), icon: <Copy size={14} />, onClick: () => props.onClone(path) },
        { label: t("Mover a…"), icon: <FolderInput size={14} />, onClick: () => props.onMoveTo(path) },
        delItem,
      ];
  const menuItems = menu?.kind === "add" ? addItems : menu?.kind === "all" && node.type === "folder" ? [...addItems, { ...moreItems[0], sep: true }, ...moreItems.slice(1)] : moreItems;
  const floating = menu && <FloatMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />;
  const onCtx = (e: React.MouseEvent) => {
    if (isRenaming) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, kind: node.type === "folder" ? "all" : "more" });
  };

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
          className={`group flex select-none items-center gap-1.5 pr-2 text-sm ${
            dropHere
              ? "bg-aqua/25 ring-2 ring-inset ring-aqua"
              : isCollection
                ? "mt-1 border-l-[3px] border-iris bg-iris/10 py-1.5 hover:bg-iris/20"
                : "py-1 hover:bg-fg/5"
          } ${isCollection && dropHere ? "mt-1 py-1.5" : ""} ${dragging ? "opacity-40" : ""}`}
          onClick={() => !isRenaming && props.onToggleOpen(node.uid)}
          onPointerDown={(e) => !isRenaming && props.onRowDown(path, node.name, e)}
          onContextMenu={onCtx}
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
            <DelayTip text={t("Recargar colección")}>
              <button
                aria-label={t("Recargar colección")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onTeamRefresh(node.team!.code);
                }}
                className="p-0.5 text-slate hover:text-mist"
              >
                <RefreshCw size={14} className={props.refreshingTeams.includes(node.team.code) ? "animate-spin text-aqua" : ""} />
              </button>
            </DelayTip>
          )}
          {!isRenaming && (
            <span className={`flex items-center gap-0.5 ${menu ? "" : "invisible group-hover:visible"}`}>
              <IconBtn disabled={guest} title={guest ? t("Collection Runner con CSV (requiere el plan Pro)") : t("Collection Runner con CSV")} onClick={() => (guest ? props.onGoPro() : props.onRun(path))}><Play size={13} /></IconBtn>
              <button title={t("Añadir")} aria-label={t("Añadir")} aria-haspopup="menu" onClick={openAt("add")} className="p-0.5 text-slate hover:text-aqua"><Plus size={15} /></button>
              <button title={t("Más acciones")} aria-label={t("Más acciones")} aria-haspopup="menu" onClick={openAt("more")} className="p-0.5 text-slate hover:text-mist"><MoreHorizontal size={15} /></button>
            </span>
          )}
        </div>
        {floating}
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
      className={`relative group flex select-none items-center gap-2 py-1 pr-2 text-sm hover:bg-fg/5 ${selected ? "bg-fg/10" : ""} ${dragging ? "opacity-40" : ""}`}
      onClick={() => !isRenaming && props.onSelect(path, node)}
      onPointerDown={(e) => !isRenaming && props.onRowDown(path, node.name, e)}
      onContextMenu={onCtx}
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
        <span className={`flex items-center ${menu ? "" : "invisible group-hover:visible"}`}>
          <button title={t("Más acciones")} aria-label={t("Más acciones")} aria-haspopup="menu" onClick={openAt("more")} className="p-0.5 text-slate hover:text-mist"><MoreHorizontal size={15} /></button>
        </span>
      )}
      {floating}
    </div>
  );
}
