import { useLayoutEffect, useRef, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";

const VAR = /\{\{[^{}\n]*\}\}/g;

/** Texto con las variables {{x}} en otro color (el mismo que en el body JSON). */
function paint(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(VAR)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(<span key={n++} style={{ color: "var(--t-hl)" }}>{m[0]}</span>);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Props = InputHTMLAttributes<HTMLInputElement> & { value: string };

/**
 * `<input>` normal que pinta las variables {{nombre}} de otro color. Solo cuando hay alguna variable el texto del input pasa a
 * transparente y una capa coloreada (misma tipografía y relleno, copiados del input) se ve debajo del cursor; sin variables es un
 * input corriente. Mantiene intactos el cursor, la selección, el deshacer y el selector de variables.
 */
export default function VarInput({ className = "", style, onScroll, onSelect, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const ov = useRef<HTMLDivElement>(null);
  const has = props.type !== "password" && /\{\{[^{}\n]*\}\}/.test(props.value);

  const sync = () => {
    const i = ref.current;
    const o = ov.current;
    if (!i || !o) return;
    const cs = getComputedStyle(i);
    o.style.padding = cs.padding;
    o.style.borderWidth = cs.borderWidth;
    o.style.borderStyle = "solid";
    o.style.borderColor = "transparent";
    o.style.font = cs.font;
    o.style.letterSpacing = cs.letterSpacing;
    o.style.lineHeight = cs.lineHeight;
    o.style.borderRadius = cs.borderRadius;
    o.scrollLeft = i.scrollLeft;
  };
  useLayoutEffect(() => {
    if (has) sync();
  });

  // El ancho/flex que pedía el input se traslada al contenedor; el input rellena el contenedor.
  const flex = /\bflex-1\b/.test(className);
  const wrap = flex ? "relative min-w-0 flex-1" : "relative w-full min-w-0";
  const inputStyle: CSSProperties = has ? { ...style, color: "transparent", caretColor: "var(--t-mist)" } : { ...style };

  return (
    <div className={wrap}>
      <input
        {...props}
        ref={ref}
        style={inputStyle}
        className={`${className.replace(/\bflex-1\b/, "")} w-full`}
        onScroll={(e) => {
          if (ov.current) ov.current.scrollLeft = e.currentTarget.scrollLeft;
          onScroll?.(e);
        }}
        onSelect={(e) => {
          if (ov.current && ref.current) ov.current.scrollLeft = ref.current.scrollLeft;
          onSelect?.(e);
        }}
      />
      {has && (
        <div
          ref={ov}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-mist"
          style={{ boxSizing: "border-box" }}
        >
          {paint(props.value)}
        </div>
      )}
    </div>
  );
}
