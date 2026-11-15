import { useEffect, useMemo } from "react";
import { diffLines } from "diff";
import { GitCompare, X } from "lucide-react";
import { t } from "../lib/i18n";

interface Props {
  /** Colección o espacio afectado (título). */
  name: string;
  /** JSON de la versión de la nube y de la local (se muestran con formato). */
  cloud: string;
  local: string;
  onKeepCloud: () => void;
  onForce: () => void;
  onClose: () => void;
}

type Row = { l: string | null; r: string | null; kind: "same" | "del" | "add" | "chg" } | { gap: number };

const pretty = (s: string) => {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
};

const lines = (v: string) => {
  const a = v.split("\n");
  if (a[a.length - 1] === "") a.pop();
  return a;
};

const CONTEXT = 3;
const MAX_ROWS = 3000;

/** Filas del panel dividido: izquierda = nube, derecha = local. Los tramos iguales largos se pliegan. */
export function buildRows(cloud: string, local: string): { rows: Row[]; changes: number; truncated: boolean } {
  const parts = diffLines(pretty(cloud), pretty(local));
  const all: { l: string | null; r: string | null; kind: "same" | "del" | "add" | "chg" }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      for (const ln of lines(p.value)) all.push({ l: ln, r: ln, kind: "same" });
    } else if (p.removed) {
      const next = parts[i + 1];
      const add = next?.added ? lines(next.value) : [];
      if (next?.added) i++;
      const del = lines(p.value);
      const n = Math.max(del.length, add.length);
      for (let k = 0; k < n; k++) {
        const l = del[k] ?? null;
        const r = add[k] ?? null;
        all.push({ l, r, kind: l !== null && r !== null ? "chg" : l !== null ? "del" : "add" });
      }
    } else {
      for (const ln of lines(p.value)) all.push({ l: null, r: ln, kind: "add" });
    }
  }
  const changes = all.filter((x) => x.kind !== "same").length;
  // Pliega los tramos sin cambios dejando algo de contexto.
  const keep = new Array(all.length).fill(false);
  all.forEach((x, i) => {
    if (x.kind !== "same") for (let k = Math.max(0, i - CONTEXT); k <= Math.min(all.length - 1, i + CONTEXT); k++) keep[k] = true;
  });
  const rows: Row[] = [];
  let hidden = 0;
  all.forEach((x, i) => {
    if (keep[i]) {
      if (hidden) rows.push({ gap: hidden }), (hidden = 0);
      rows.push(x);
    } else hidden++;
  });
  if (hidden) rows.push({ gap: hidden });
  const truncated = rows.length > MAX_ROWS;
  return { rows: truncated ? rows.slice(0, MAX_ROWS) : rows, changes, truncated };
}

const cell = (kind: string, side: "l" | "r") =>
  kind === "chg" || (kind === "del" && side === "l") || (kind === "add" && side === "r")
    ? side === "l"
      ? "bg-rose/15 text-rose"
      : "bg-leaf/15 text-leaf"
    : kind === "same"
      ? "text-mist"
      : "text-slate";

/** Vista previa de diferencias entre la nube y la copia local (solo lectura) con las dos salidas del conflicto. */
export default function ConflictDiffModal({ name, cloud, local, onKeepCloud, onForce, onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const { rows, changes, truncated } = useMemo(() => buildRows(cloud, local), [cloud, local]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-3 sm:p-6" onMouseDown={onClose}>
      <div role="dialog" aria-label={t("Conflicto de sincronización")} className="glass flex max-h-full min-h-0 w-full max-w-[min(64rem,100%)] flex-col gap-3 overflow-hidden rounded-2xl bg-kelp p-4 sm:p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <GitCompare size={18} className="text-amber-300" />
          <h2 className="min-w-0 flex-1 truncate text-lg text-mist">
            {t("Conflicto de sincronización")} <span className="text-slate">· {name}</span>
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate hover:text-mist" aria-label={t("Cerrar")}>
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate">{t("Otro miembro guardó antes que tú. Compara las dos versiones y elige cuál conservar.")}</p>
        <div className="grid grid-cols-2 gap-2 text-xs font-medium">
          <div className="rounded-lg bg-deep px-3 py-1.5 text-rose">{t("Versión de la nube")}</div>
          <div className="rounded-lg bg-deep px-3 py-1.5 text-leaf">{t("Tu versión local")}</div>
        </div>
        <div className="min-h-24 flex-1 overflow-y-auto overflow-x-hidden rounded-xl bg-deep font-mono text-[11px] leading-5">
          {changes === 0 ? (
            <p className="p-4 text-slate">{t("No hay diferencias visibles: las dos versiones tienen el mismo contenido.")}</p>
          ) : (
            <div>
              {rows.map((row, i) =>
                "gap" in row ? (
                  <div key={i} className="bg-kelp/60 px-3 py-0.5 text-center text-slate">{t("… {0} líneas sin cambios …", String(row.gap))}</div>
                ) : (
                  <div key={i} className="grid grid-cols-2">
                    <pre className={`whitespace-pre-wrap break-all border-r border-white/5 px-3 ${cell(row.kind, "l")}`}>{row.l ?? " "}</pre>
                    <pre className={`whitespace-pre-wrap break-all px-3 ${cell(row.kind, "r")}`}>{row.r ?? " "}</pre>
                  </div>
                ),
              )}
              {truncated && <div className="px-3 py-1 text-center text-amber-300">{t("Vista recortada: hay demasiadas diferencias para mostrarlas todas.")}</div>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onKeepCloud} className="rounded-xl px-4 py-2 text-sm text-mist ring-1 ring-white/20 hover:bg-white/10">
            {t("Descartar y usar versión de la nube")}
          </button>
          <button onClick={onForce} className="rounded-xl bg-amber-500/20 px-4 py-2 text-sm text-amber-300 ring-1 ring-amber-400/60 hover:bg-amber-500/30">
            {t("Forzar mis cambios")}
          </button>
        </div>
      </div>
    </div>
  );
}
