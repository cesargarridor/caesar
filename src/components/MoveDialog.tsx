import { useEffect } from "react";
import { FolderInput, FolderOpen, Library, X } from "lucide-react";
import type { TreeNode } from "../types";
import { canMove } from "../lib/tree";
import { t } from "../lib/i18n";

interface Props {
  collections: TreeNode[];
  /** Ruta del elemento que se mueve ("0/2/1"). */
  from: string;
  /** Nombre del elemento, para el título. */
  name: string;
  onPick: (to: string) => void;
  onClose: () => void;
}

/** Elegir con precisión a qué carpeta o colección se mueve una carpeta o una petición. */
export default function MoveDialog({ collections, from, name, onPick, onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const parent = from.slice(0, from.lastIndexOf("/"));

  const rows = (nodes: TreeNode[], base: string, depth: number): React.ReactNode[] =>
    nodes.flatMap((n, i) => {
      if (n.type !== "folder") return [];
      const path = base ? `${base}/${i}` : `${i}`;
      const here = path === parent;
      const ok = canMove(from, path);
      return [
        <button
          key={path}
          disabled={!ok}
          onClick={() => onPick(path)}
          style={{ paddingLeft: 10 + depth * 16 }}
          className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-3 text-left text-sm ${ok ? "text-mist hover:bg-aqua/15" : "cursor-not-allowed text-slate opacity-50"}`}
        >
          {depth === 0 ? <Library size={15} className="shrink-0 text-iris" /> : <FolderOpen size={15} className="shrink-0 text-aqua" />}
          <span className="flex-1 truncate">{n.name}</span>
          {here && <span className="text-[11px] text-slate">{t("Aquí está ahora")}</span>}
        </button>,
        ...rows(n.children, path, depth + 1),
      ];
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-6" onMouseDown={onClose}>
      <div role="dialog" aria-label={t("Mover a…")} className="glass flex max-h-full w-full max-w-md flex-col gap-3 rounded-2xl bg-kelp p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <FolderInput size={18} className="text-aqua" />
          <h2 className="min-w-0 flex-1 truncate text-lg text-mist">{t("Mover a…")} <span className="text-slate">· {name}</span></h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate hover:text-mist" aria-label={t("Cerrar")}>
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate">{t("Elige la carpeta o colección de destino.")}</p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-deep p-1.5">{rows(collections, "", 0)}</div>
      </div>
    </div>
  );
}
