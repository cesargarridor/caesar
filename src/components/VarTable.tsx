import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, Lock, Search, Trash2 } from "lucide-react";
import type { KV } from "../types";
import { t } from "../lib/i18n";
import { filterVarIdx } from "../lib/vars";
import VarInput from "./VarInput";

interface Props {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  /** Sidebar estrecha: el tipo se cambia con un candado en vez de un desplegable. */
  compact?: boolean;
  /** Texto del estado vacío. */
  empty?: string;
}

const input =
  "w-full bg-kelp border border-fg/10 rounded-md px-2 py-1 text-sm focus:outline-none focus-visible:border-aqua focus-visible:ring-1 focus-visible:ring-aqua";

/** Tabla de variables al estilo de Postman: activar, Variable, Tipo (default/secret), Valor, buscador, fila vacía al final y borrar. */
export default function VarTable({ rows, onChange, compact = false, empty }: Props) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState<Set<number>>(new Set());
  const searchId = useId();
  const idx = filterVarIdx(rows, q);
  const named = rows.filter((r) => r.key).length;

  const update = (i: number, patch: Partial<KV>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const setSecret = (i: number, on: boolean) => {
    const { secret: _s, ...rest } = rows[i];
    onChange(rows.map((r, n) => (n === i ? (on ? { ...rest, secret: true } : rest) : r)));
  };
  const toggleShow = (i: number) =>
    setShown((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const remove = (i: number) => {
    onChange(rows.filter((_, n) => n !== i));
    setShown(new Set());
  };
  const box = useRef<HTMLDivElement>(null);
  const focus = useRef<{ i: number; f: "k" | "v"; pos: number } | null>(null);
  const addFrom = (patch: Partial<KV>) => {
    focus.current = { i: rows.length, f: patch.key !== undefined ? "k" : "v", pos: (patch.key ?? patch.value ?? "").length };
    onChange([...rows, { key: "", value: "", enabled: true, ...patch }]);
  };
  // La fila nueva toma el foco para seguir escribiendo sin perder el cursor.
  useEffect(() => {
    const f = focus.current;
    if (!f) return;
    focus.current = null;
    const el = box.current?.querySelector<HTMLInputElement>(`[data-vr="${f.f}${f.i}"]`);
    el?.focus();
    el?.setSelectionRange(f.pos, f.pos);
  });

  const grid = compact ? "grid-cols-[auto_minmax(0,1fr)_minmax(0,1.2fr)_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_7rem_minmax(0,1.6fr)_auto]";

  return (
    <div ref={box} className="space-y-1.5" role="group" aria-label={t("Tabla de variables")}>
      <div className="flex items-center gap-2">
        <label htmlFor={searchId} className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate" />
          <input
            id={searchId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Buscar variables")}
            aria-label={t("Buscar variables")}
            spellCheck={false}
            className={`${input} pl-7`}
          />
        </label>
        <span className="shrink-0 text-[11px] text-slate" aria-live="polite">
          {q.trim() ? `${idx.length}/${rows.length}` : `${named} ${named === 1 ? t("variable") : t("variables")}`}
        </span>
      </div>

      {rows.length === 0 && !q && <p className="px-1 text-xs text-slate">{empty ?? t("Aún no hay variables. Escribe en la última fila para añadir la primera.")}</p>}
      {rows.length > 0 && idx.length === 0 && <p className="px-1 text-xs text-slate">{t("Ninguna variable coincide con la búsqueda.")}</p>}

      {!compact && rows.length > 0 && (
        <div className={`grid ${grid} items-center gap-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.025em] text-slate`}>
          <span className="w-4" />
          <span>{t("Variable")}</span>
          <span>{t("Tipo")}</span>
          <span>{t("Valor")}</span>
          <span className="w-4" />
        </div>
      )}

      {idx.map((i) => {
        const row = rows[i];
        const reveal = shown.has(i);
        return (
          <div key={i} className={`grid ${grid} items-center gap-1.5 ${row.enabled ? "" : "opacity-60"}`}>
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              className="accent-[var(--t-accent)]"
              aria-label={t("Activar variable")}
              title={t("Activar o desactivar esta variable")}
            />
            <VarInput data-vr={`k${i}`} className={input} placeholder={t("nombre")} aria-label={t("Variable")} value={row.key} onChange={(e) => update(i, { key: e.target.value })} />
            {!compact && (
              <select
                value={row.secret ? "secret" : "default"}
                onChange={(e) => setSecret(i, e.target.value === "secret")}
                aria-label={t("Tipo")}
                className={input}
              >
                <option value="default">default</option>
                <option value="secret">secret</option>
              </select>
            )}
            {row.secret && !reveal ? (
              <input
                type="password"
                data-vr={`v${i}`}
                autoComplete="off"
                className={input}
                placeholder={t("Valor")}
                aria-label={t("Valor (oculto)")}
                value={row.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            ) : (
              <VarInput data-vr={`v${i}`} className={input} placeholder={t("Valor")} aria-label={t("Valor")} value={row.value} onChange={(e) => update(i, { value: e.target.value })} />
            )}
            {compact ? (
              <button
                onClick={() => setSecret(i, !row.secret)}
                className={`rounded p-0.5 ${row.secret ? "text-aqua" : "text-slate hover:text-mist"}`}
                title={row.secret ? t("Secreta: valor oculto (clic para hacerla normal)") : t("Marcar como secreta (oculta el valor)")}
                aria-pressed={!!row.secret}
                aria-label={t("Variable secreta")}
              >
                <Lock size={13} />
              </button>
            ) : (
              <span className="flex items-center gap-1">
                {row.secret ? (
                  <button onClick={() => toggleShow(i)} className="text-slate hover:text-mist" title={reveal ? t("Ocultar valor") : t("Mostrar valor")} aria-label={reveal ? t("Ocultar valor") : t("Mostrar valor")}>
                    {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                ) : (
                  <span className="w-[14px]" />
                )}
                <button onClick={() => remove(i)} className="text-slate hover:text-rose" title={t("Eliminar")} aria-label={t("Eliminar variable")}>
                  <Trash2 size={14} />
                </button>
              </span>
            )}
            {compact && (
              <button onClick={() => remove(i)} className="text-slate hover:text-rose" title={t("Eliminar")} aria-label={t("Eliminar variable")}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      })}

      {/* Fila vacía al final: escribir en ella crea la variable. */}
      {!q.trim() && (
        <div className={`grid ${grid} items-center gap-1.5 opacity-80`}>
          <span className="w-4" />
          <input
            className={input}
            placeholder={t("Añadir variable")}
            aria-label={t("Añadir variable")}
            value=""
            onChange={(e) => addFrom({ key: e.target.value })}
          />
          {!compact && <span />}
          <input className={input} placeholder={t("Valor")} aria-label={t("Valor de la nueva variable")} value="" onChange={(e) => addFrom({ value: e.target.value })} />
          <span className="w-4" />
          {compact && <span className="w-4" />}
        </div>
      )}
    </div>
  );
}
