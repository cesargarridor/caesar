import { useEffect } from "react";
import { FolderOpen, Library, Plus, Save, X } from "lucide-react";
import type { TreeNode } from "../types";
import { t } from "../lib/i18n";

interface Props {
  collections: TreeNode[];
  /** Nombre con el que se guardará la petición. */
  name: string;
  /** Ruta de la carpeta o colección elegida ("0", "0/2"…), o "new" para crear una colección nueva. */
  onPick: (to: string) => void;
  onClose: () => void;
}

/** «¿Dónde quieres guardar esta petición?»: se abre al guardar una petición huérfana (p. ej. un cURL pegado) que no cuelga de ninguna colección. */
export default function SaveToDialog({ collections, name, onPick, onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const rows = (nodes: TreeNode[], base: string, depth: number): React.ReactNode[] =>
    nodes.flatMap((n, i) => {
      if (n.type !== "folder") return [];
      const path = base ? `${base}/${i}` : `${i}`;
      return [
        <button
          key={path}
          onClick={() => onPick(path)}
          style={{ paddingLeft: 10 + depth * 16 }}
          className="flex w-full items-center gap-2 rounded-lg py-1.5 pr-3 text-left text-sm text-mist hover:bg-aqua/15"
        >
          {depth === 0 ? <Library size={15} className="shrink-0 text-iris" /> : <FolderOpen size={15} className="shrink-0 text-aqua" />}
          <span className="flex-1 truncate">{n.name}</span>
        </button>,
        ...rows(n.children, path, depth + 1),
      ];
    });

  const list = rows(collections, "", 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-6" onMouseDown={onClose}>
      <div role="dialog" aria-label={t("¿Dónde quieres guardar esta petición?")} className="glass flex max-h-full w-full max-w-md flex-col gap-3 rounded-2xl bg-kelp p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Save size={18} className="text-aqua" />
          <h2 className="min-w-0 flex-1 truncate text-lg text-mist">{t("¿Dónde quieres guardar esta petición?")}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate hover:text-mist" aria-label={t("Cerrar")}>
            <X size={16} />
          </button>
        </div>
        <p className="truncate text-xs text-slate">{name}</p>
        <p className="text-xs text-slate">{t("Elige la carpeta o colección de destino.")}</p>
        {list.length > 0 && <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-deep p-1.5">{list}</div>}
        <button onClick={() => onPick("new")} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-mist ring-1 ring-fg/30 hover:ring-fg/60">
          <Plus size={15} /> {t("Nueva colección")}
        </button>
      </div>
    </div>
  );
}
