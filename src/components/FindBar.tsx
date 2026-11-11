import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  /** Coincidencia actual (0-based) y total. */
  index: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Cambia cada vez que se pulsa Ctrl+F para volver a enfocar y seleccionar el texto. */
  focusKey: number;
  className?: string;
}

/** Barra de búsqueda: Enter = siguiente, Shift+Enter = anterior, Esc = cerrar. */
export default function FindBar({ query, onQuery, index, total, onNext, onPrev, onClose, focusKey, className = "" }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  const btn = "rounded p-0.5 text-slate hover:bg-fg/10 hover:text-mist disabled:opacity-30";
  return (
    <div
      className={`flex items-center gap-1.5 rounded-[10px] bg-kelp px-2 py-1 text-xs shadow-lg ring-1 ring-fg/20 ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.shiftKey ? onPrev() : onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // no cierres también el modal que contiene la búsqueda
            onClose();
          }
        }}
        placeholder="Buscar…"
        spellCheck={false}
        className="w-40 bg-transparent text-mist outline-none placeholder:text-slate/60"
      />
      <span className={`min-w-12 text-right tabular-nums ${query && total === 0 ? "text-rose" : "text-slate"}`}>
        {query ? (total ? `${index + 1}/${total}` : "0/0") : ""}
      </span>
      <button onClick={onPrev} disabled={!total} className={btn} title="Anterior (Mayús+Enter)">
        <ChevronUp size={14} />
      </button>
      <button onClick={onNext} disabled={!total} className={btn} title="Siguiente (Enter)">
        <ChevronDown size={14} />
      </button>
      <button onClick={onClose} className={btn} title="Cerrar (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}
