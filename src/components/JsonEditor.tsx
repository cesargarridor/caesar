import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import FindBar from "./FindBar";
import { findAll, wrapIndex } from "../lib/find";
import { handleEditKey, handlePasteJson, parsePairs } from "../lib/editing";
import { checkJson, issueText } from "../lib/jsonCheck";
import { AlertCircle } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** false = textarea normal sin colores */
  highlight?: boolean;
  autoFocus?: boolean;
  /** Pares que se cierran solos, 2 caracteres por par (por defecto {} [] () ""). */
  autoClose?: string;
  /** Resaltado propio (p. ej. GraphQL) en lugar del de JSON. Sin validación JSON. */
  paintText?: (text: string) => ReactNode[];
  /** Acceso al textarea (para insertar texto o leer el cursor). */
  taRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** Se ejecuta antes que el manejo normal de teclas; devuelve true si la tecla ya se gestionó. */
  onKeyDownExtra?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Clic o pérdida de foco (para cerrar popups). */
  onCaretMove?: () => void;
  /** Superposición dentro del editor (popup de sugerencias). */
  children?: ReactNode;
}

const TOKEN = /("(?:\\.|[^"\\\n])*")(\s*:)?|\{\{[^{}\n]*\}\}|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;
const MAX = 300_000;

/** Editor JSON con colores PROPIOS del body (distintos a los de la respuesta): textarea transparente sobre una capa coloreada. */
function paint(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const t = m[0];
    let color = "var(--t-b-punc)";
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push(
          <span key={n++}>
            <span style={{ color: "var(--t-b-key)" }}>{m[1]}</span>
            <span style={{ color: "var(--t-b-punc)" }}>{m[2]}</span>
          </span>,
        );
        last = i + t.length;
        continue;
      }
      color = "var(--t-b-str)";
    } else if (t.startsWith("{{")) color = "var(--t-hl)"; // variables {{x}}
    else if (t === "true" || t === "false") color = "var(--t-b-bool)";
    else if (t === "null") color = "var(--t-b-nul)";
    else if (!/^[{}[\],:]$/.test(t)) color = "var(--t-b-num)";
    out.push(<span key={n++} style={{ color }}>{t}</span>);
    last = i + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const shared = "p-3 whitespace-pre break-normal";
// Estilos inline: el reset global `textarea { font-family: inherit }` anula las clases de Tailwind y desalinea la capa coloreada.
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  // Tamaño configurable en Ajustes (--fs-body); el interlineado sigue al tamaño.
  fontSize: "var(--fs-body, 13px)",
  lineHeight: "calc(var(--fs-body, 13px) * 1.846)",
  fontWeight: 400,
  letterSpacing: "normal",
  fontFeatureSettings: "normal",
  fontVariantLigatures: "none",
  tabSize: 2,
};

const PAD = 12; // p-3
/** Alto de línea y ancho de carácter reales según el tamaño de letra actual del textarea. */
function metrics(t: HTMLTextAreaElement) {
  const cs = getComputedStyle(t);
  const fs = parseFloat(cs.fontSize) || 13;
  return { lineH: parseFloat(cs.lineHeight) || fs * 1.846, charW: fs * 0.6 };
}

export default function JsonEditor({
  value, onChange, placeholder, className = "", highlight = true, autoFocus, autoClose = '{}[]()""', paintText, taRef, onKeyDownExtra, onCaretMove, children,
}: Props) {
  const pairs = useMemo(() => parsePairs(autoClose), [autoClose]);
  const box = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const setTa = (el: HTMLTextAreaElement | null) => {
    ta.current = el;
    if (taRef) taRef.current = el;
  };
  const pre = useRef<HTMLPreElement>(null);
  const markPre = useRef<HTMLPreElement>(null);
  const colored = (highlight || !!paintText) && value.length <= MAX;

  // ── validación del JSON con el error exacto ──
  const issue = useMemo(() => (highlight && !paintText && value.length <= MAX ? checkJson(value) : null), [highlight, paintText, value]);
  const goTo = (pos: number) => {
    const t = ta.current;
    if (!t) return;
    t.focus();
    t.setSelectionRange(pos, Math.min(value.length, pos + 1));
    const before = value.slice(0, pos);
    const line = before.split("\n").length - 1;
    const { lineH } = metrics(t);
    t.scrollTop = Math.max(0, PAD + line * lineH - t.clientHeight / 2 + lineH / 2);
  };

  // ── búsqueda (Ctrl+F) ──
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cur, setCur] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const matches = useMemo(() => (findOpen ? findAll(value, query) : []), [findOpen, value, query]);
  const idx = wrapIndex(cur, matches.length);
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const open = () => {
      const t = ta.current;
      const sel = t ? t.value.slice(t.selectionStart, t.selectionEnd) : "";
      if (sel && sel.length <= 100 && !sel.includes("\n")) {
        setQuery(sel);
        setCur(0);
      }
      setFindOpen(true);
      setFocusKey((k) => k + 1);
    };
    el.addEventListener("caesar-find", open);
    return () => el.removeEventListener("caesar-find", open);
  }, []);

  // Al cambiar de coincidencia, desplazar el textarea para centrarla.
  useEffect(() => {
    const t = ta.current;
    const m = matchesRef.current[idx];
    if (!findOpen || !t || m === undefined) return;
    const before = value.slice(0, m);
    const line = before.split("\n").length - 1;
    const col = m - (before.lastIndexOf("\n") + 1);
    const { lineH, charW } = metrics(t);
    t.scrollTop = Math.max(0, PAD + line * lineH - t.clientHeight / 2 + lineH / 2);
    t.scrollLeft = Math.max(0, col * charW - t.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, query, findOpen]);

  const closeFind = () => {
    setFindOpen(false);
    ta.current?.focus();
  };

  const marks = useMemo(() => {
    if (!findOpen || !matches.length || !query || value.length > MAX) return null;
    const out: ReactNode[] = [];
    let last = 0;
    matches.forEach((m, k) => {
      if (m > last) out.push(value.slice(last, m));
      const isCur = k === idx;
      out.push(
        <mark
          key={k}
          style={{
            color: "transparent",
            borderRadius: 2,
            background: isCur ? "color-mix(in srgb, var(--t-hl) 75%, transparent)" : "color-mix(in srgb, var(--t-hl) 35%, transparent)",
            outline: isCur ? "1px solid var(--t-hl)" : undefined,
          }}
        >
          {value.slice(m, m + query.length)}
        </mark>,
      );
      last = m + query.length;
    });
    out.push(value.slice(last));
    return out;
  }, [findOpen, matches, idx, query, value]);

  // La capa de marcas aparece/desaparece: alinearla con el scroll actual del textarea.
  useEffect(() => {
    const t = ta.current;
    if (!t || !markPre.current) return;
    markPre.current.scrollTop = t.scrollTop;
    markPre.current.scrollLeft = t.scrollLeft;
  }, [marks]);

  return (
    <div
      ref={box}
      data-find-scope="editor"
      onKeyDown={(e) => {
        if (!findOpen) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeFind();
        } else if (e.key === "F3") {
          e.preventDefault();
          setCur((c) => c + (e.shiftKey ? -1 : 1));
        }
      }}
      className={`relative overflow-hidden rounded-[10px] bg-kelp ring-1 ring-fg/10 focus-within:ring-aqua glass ${className}`}
    >
      {marks && (
        <pre ref={markPre} aria-hidden style={{ ...mono, color: "transparent" }} className={`pointer-events-none absolute inset-0 m-0 overflow-hidden ${shared}`}>
          {marks}
          {"\n"}
        </pre>
      )}
      {colored && (
        <pre ref={pre} aria-hidden style={mono} className={`pointer-events-none absolute inset-0 m-0 overflow-hidden ${shared}`}>
          {paintText ? paintText(value) : paint(value)}
          {"\n"}
        </pre>
      )}
      <textarea
        ref={setTa}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (onKeyDownExtra?.(e)) return;
          handleEditKey(e, pairs);
        }}
        onClick={onCaretMove}
        onBlur={onCaretMove}
        onPaste={(e) => highlight && !paintText && handlePasteJson(e)}
        onScroll={(e) => {
          const { scrollTop, scrollLeft } = e.currentTarget;
          for (const p of [pre.current, markPre.current]) {
            if (p) {
              p.scrollTop = scrollTop;
              p.scrollLeft = scrollLeft;
            }
          }
        }}
        spellCheck={false}
        wrap="off"
        placeholder={placeholder}
        style={{ ...mono, color: colored ? "transparent" : undefined, caretColor: "var(--t-mist)" }}
        className={`absolute inset-0 block h-full w-full resize-none bg-transparent outline-none placeholder:text-slate/60 ${shared} ${colored ? "" : "text-silver"}`}
      />
      {children}
      {issue && (
        <button
          type="button"
          onClick={() => goTo(issue.pos)}
          title={issue.snippet.trim().slice(0, 200)}
          className="absolute inset-x-0 bottom-0 z-10 flex items-start gap-2 bg-deep/95 px-3 py-1.5 text-left text-xs text-rose ring-1 ring-rose/40 hover:bg-deep"
        >
          <AlertCircle size={14} className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{issueText(issue)}</span>
        </button>
      )}
      {findOpen && (
        <FindBar
          className="absolute right-4 top-2 z-20"
          query={query}
          onQuery={(q) => {
            setQuery(q);
            setCur(0);
          }}
          index={idx}
          total={matches.length}
          onNext={() => setCur((c) => c + 1)}
          onPrev={() => setCur((c) => c - 1)}
          onClose={closeFind}
          focusKey={focusKey}
        />
      )}
    </div>
  );
}
