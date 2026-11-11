import { useRef, type ReactNode } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** false = textarea normal sin colores */
  highlight?: boolean;
  autoFocus?: boolean;
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

const shared = "text-[13px] leading-6 p-3 whitespace-pre break-normal";
// Estilos inline: el reset global `textarea { font-family: inherit }` anula las clases de Tailwind y desalinea la capa coloreada.
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontWeight: 400,
  letterSpacing: "normal",
  fontFeatureSettings: "normal",
  fontVariantLigatures: "none",
  tabSize: 2,
};

export default function JsonEditor({ value, onChange, placeholder, className = "", highlight = true, autoFocus }: Props) {
  const pre = useRef<HTMLPreElement>(null);
  const colored = highlight && value.length <= MAX;

  return (
    <div className={`relative overflow-hidden rounded-[10px] bg-kelp ring-1 ring-fg/10 focus-within:ring-aqua glass ${className}`}>
      {colored && (
        <pre ref={pre} aria-hidden style={mono} className={`pointer-events-none absolute inset-0 m-0 overflow-hidden ${shared}`}>
          {paint(value)}
          {"\n"}
        </pre>
      )}
      <textarea
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (pre.current) {
            pre.current.scrollTop = e.currentTarget.scrollTop;
            pre.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
        spellCheck={false}
        wrap="off"
        placeholder={placeholder}
        style={{ ...mono, color: colored ? "transparent" : undefined, caretColor: "var(--t-mist)" }}
        className={`absolute inset-0 block h-full w-full resize-none bg-transparent outline-none placeholder:text-slate/60 ${shared} ${colored ? "" : "text-silver"}`}
      />
    </div>
  );
}
