import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
}

/**
 * Botón con loader: al cargar, el texto se desvanece y se encoge un pelín, y un spinner SVG
 * entra con opacidad + escala en el centro. Sin librerías: solo transiciones de Tailwind.
 * El ancho no cambia (el texto sigue ocupando su sitio), así que no hay saltos de layout.
 */
export default function LoadingButton({ isLoading = false, disabled, className = "", children, onClick, ...rest }: Props) {
  // Cargando no se usa `disabled`: así el botón conserva el foco del teclado y se evitan dobles envíos ignorando el clic.
  return (
    <button
      {...rest}
      disabled={disabled}
      aria-disabled={isLoading || undefined}
      aria-busy={isLoading}
      onClick={(e) => !isLoading && onClick?.(e)}
      className={`btn-aurora relative inline-flex items-center justify-center px-5 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${isLoading ? "cursor-progress" : ""} ${className}`}
    >
      <span className={`transition-[opacity,transform] duration-200 ease-out ${isLoading ? "scale-90 opacity-0" : "scale-100 opacity-100"}`}>
        {children}
      </span>
      <span
        aria-hidden={!isLoading}
        className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-200 ease-out ${
          isLoading ? "scale-100 opacity-100" : "scale-50 opacity-0"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" className={`size-4 ${isLoading ? "animate-spin" : ""}`} style={{ animationDuration: "0.7s" }}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
    </button>
  );
}
