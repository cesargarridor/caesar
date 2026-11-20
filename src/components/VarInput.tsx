import { useEffect, useLayoutEffect, useRef, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";

const VAR = /\{\{[^{}\n]*\}\}/g;

/** Texto con las variables {{x}} en otro color (el mismo que en el body JSON). */
export function paintVars(text: string): ReactNode[] {
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
 * transparente y una capa coloreada (misma tipografía, relleno y desplazamiento horizontal) se ve debajo del cursor; sin variables es un
 * input corriente. Mantiene intactos el cursor, la selección, el deshacer y el selector de variables.
 */
export default function VarInput({ className = "", style, onScroll, onSelect, onKeyUp, onMouseUp, onFocus, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const ov = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const has = props.type !== "password" && /\{\{[^{}\n]*\}\}/.test(props.value);

  const syncScroll = () => {
    const i = ref.current;
    const sp = inner.current;
    if (!i || !sp) return;
    sp.style.transform = i.scrollLeft ? `translateX(${-i.scrollLeft}px)` : "none";
  };

  const sync = () => {
    const i = ref.current;
    const o = ov.current;
    if (!i || !o) return;
    const cs = getComputedStyle(i);
    o.style.paddingLeft = cs.paddingLeft;
    o.style.paddingRight = cs.paddingRight;
    o.style.borderWidth = cs.borderWidth;
    o.style.borderStyle = "solid";
    o.style.borderColor = "transparent";
    o.style.fontFamily = cs.fontFamily;
    o.style.fontSize = cs.fontSize;
    o.style.fontWeight = cs.fontWeight;
    o.style.fontStyle = cs.fontStyle;
    o.style.fontFeatureSettings = cs.fontFeatureSettings;
    o.style.fontVariantLigatures = cs.fontVariantLigatures;
    o.style.letterSpacing = cs.letterSpacing;
    o.style.borderRadius = cs.borderRadius;
    syncScroll();
  };

  useLayoutEffect(() => {
    if (has) sync();
  });

  // Cuando el usuario arrastra el ratón para seleccionar un texto largo, el <input> puede hacer auto-scroll horizontal
  // sin emitir evento "scroll" en todos los motores: sincronizamos mientras esté enfocado y haya selección activa.
  useEffect(() => {
    if (!has) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (e.buttons === 1 && document.activeElement === ref.current) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(syncScroll);
      }
    };
    const onSel = () => {
      if (document.activeElement === ref.current) syncScroll();
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("selectionchange", onSel);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("selectionchange", onSel);
    };
  }, [has]);

  // El ancho/flex que pedía el input se traslada al contenedor; el input rellena el contenedor.
  const flex = /\bflex-1\b/.test(className);
  const wrap = flex ? "relative min-w-0 flex-1" : "relative w-full min-w-0";
  const inputStyle: CSSProperties = has
    ? { ...style, color: "transparent", WebkitTextFillColor: "transparent", caretColor: "var(--t-mist)" }
    : { ...style };

  return (
    <div className={wrap}>
      <input
        {...props}
        ref={ref}
        style={inputStyle}
        className={`${className.replace(/\bflex-1\b/, "")} w-full ${has ? "caesar-transparent-text" : ""}`}
        onScroll={(e) => {
          syncScroll();
          onScroll?.(e);
        }}
        onSelect={(e) => {
          syncScroll();
          onSelect?.(e);
        }}
        onKeyUp={(e) => {
          syncScroll();
          onKeyUp?.(e);
        }}
        onMouseUp={(e) => {
          syncScroll();
          onMouseUp?.(e);
        }}
        onFocus={(e) => {
          syncScroll();
          onFocus?.(e);
        }}
      />
      {has && (
        <div
          ref={ov}
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-mist"
          style={{ boxSizing: "border-box" }}
        >
          <span ref={inner} className="inline-block will-change-transform">
            {paintVars(props.value)}
          </span>
        </div>
      )}
    </div>
  );
}
