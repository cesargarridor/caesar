import { useEffect, useMemo, useRef, useState } from "react";
import type { KV } from "../types";
import { t } from "../lib/i18n";

/**
 * Ctrl+Espacio en cualquier campo de texto (URL, params, headers, body, auth, scripts…) abre la lista de variables
 * disponibles (de la colección y globales). Al elegir una se inserta como {{nombre}}; si ya habías escrito "{{par",
 * se completa en su lugar. Un solo listener global: no hace falta cablear cada campo.
 */

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Open {
  field: Field;
  x: number;
  y: number;
  /** Rango del texto que se sustituye (lo ya escrito tras "{{"). */
  from: number;
  to: number;
  initial: string;
}

const TEXT_INPUTS = new Set(["text", "search", "url", "email", "password", "tel", ""]);

function asField(el: Element | null): Field | null {
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled) return el;
  return null;
}

function insertAt(f: Field, from: number, to: number, text: string) {
  f.focus();
  f.setSelectionRange(from, to);
  const ok = document.execCommand("insertText", false, text); // mantiene el historial de deshacer y avisa a React
  if (!ok) {
    f.setRangeText(text, from, to, "end");
    f.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export default function VarPicker({ vars }: { vars: KV[] }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState(0);
  const varsRef = useRef(vars);
  varsRef.current = vars;
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Lo lanza el comando «Elegir una variable de entorno» (atajo editable en Ajustes).
    const onKey = () => {
      const f = asField(document.activeElement);
      if (!f) return;
      const caret = f.selectionStart ?? f.value.length;
      const before = f.value.slice(0, caret);
      const m = /\{\{\s*([\w.$-]*)$/.exec(before);
      let from = caret;
      let to = f.selectionEnd ?? caret;
      if (m) {
        from = caret - m[0].length;
        if (f.value.slice(to, to + 2) === "}}") to += 2;
      }
      const r = f.getBoundingClientRect();
      setFilter(m?.[1] ?? "");
      setSel(0);
      setOpen({ field: f, x: Math.max(8, Math.min(r.left, window.innerWidth - 360)), y: r.bottom + 4, from, to, initial: m?.[1] ?? "" });
    };
    window.addEventListener("caesar-var-picker", onKey);
    return () => window.removeEventListener("caesar-var-picker", onKey);
  }, []);

  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  const items = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vars) if (v.enabled && v.key) map.set(v.key, v.value); // las de la colección van después y pisan a las globales
    const q = filter.trim().toLowerCase();
    return [...map].filter(([k]) => k.toLowerCase().includes(q));
  }, [vars, filter, open]);

  if (!open) return null;

  const close = () => {
    open.field.focus();
    setOpen(null);
  };
  const pick = (key: string) => {
    insertAt(open.field, open.from, open.to, `{{${key}}}`);
    setOpen(null);
  };
  const active = Math.min(sel, Math.max(0, items.length - 1));
  const top = open.y + 280 > window.innerHeight ? Math.max(8, open.y - 290) : open.y;

  return (
    <div className="fixed inset-0 z-[80]" onMouseDown={close}>
      <div
        style={{ left: open.x, top, width: 340 }}
        className="absolute flex max-h-72 flex-col overflow-hidden rounded-xl bg-kelp text-xs shadow-2xl ring-1 ring-fg/20"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel(Math.min(items.length - 1, active + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel(Math.max(0, active - 1));
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              if (items[active]) pick(items[active][0]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          placeholder={t("Buscar variable…")}
          spellCheck={false}
          className="border-b border-fg/10 bg-transparent px-3 py-2 text-mist outline-none placeholder:text-slate/60"
        />
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-slate">{vars.some((v) => v.key) ? t("Ninguna variable coincide.") : t("No hay variables definidas. Créalas en la barra lateral.")}</p>
          ) : (
            items.map(([k, v], i) => (
              <button
                key={k}
                ref={(el) => {
                  if (i === active) el?.scrollIntoView({ block: "nearest" });
                }}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(k)}
                className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left ${i === active ? "bg-iris/30 text-mist" : "text-silver"}`}
              >
                <span className="shrink-0 font-mono text-aqua">{k}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-slate" title={v}>{v}</span>
              </button>
            ))
          )}
        </div>
        <p className="border-t border-fg/10 px-3 py-1 text-[10px] text-slate">{t("↑↓ elegir · Enter insertar · Esc cerrar")}</p>
      </div>
    </div>
  );
}
