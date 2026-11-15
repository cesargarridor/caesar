import { useEffect, useState } from "react";

export type SyncState = "idle" | "syncing" | "saved";

interface Props {
  /** "syncing" mientras Rust sube los datos; pásalo a "saved" (o a "idle") al terminar. */
  state: SyncState;
  className?: string;
}

/**
 * Indicador discreto de sincronización. "syncing": punto con halo pulsante suave.
 * "saved": check que se muestra 2 s y se desvanece solo. Solo anima opacity/transform
 * (compositor, sin repintar layout) y respeta prefers-reduced-motion.
 */
export default function SyncIndicator({ state, className = "" }: Props) {
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (state !== "saved") return setShowSaved(false);
    setShowSaved(true);
    const id = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(id);
  }, [state]);

  const syncing = state === "syncing";
  const label = syncing ? "Sincronizando..." : showSaved ? "Guardado" : "";

  return (
    <div role="status" aria-live="polite" className={`flex h-5 items-center gap-1.5 text-[11px] text-slate ${className}`}>
      <span className="relative flex size-4 items-center justify-center">
        {/* Punto + halo: ping mitigado (escala corta, opacidad baja) */}
        <span className={`absolute size-2 rounded-full bg-aqua/40 transition-opacity duration-300 motion-safe:animate-[sync-halo_1.6s_ease-out_infinite] ${syncing ? "opacity-100" : "opacity-0"}`} />
        <span className={`absolute size-2 rounded-full bg-aqua transition-[opacity,transform] duration-300 ${syncing ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
        {/* Check */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`absolute size-3.5 text-aqua transition-[opacity,transform] duration-300 ${showSaved ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={`transition-opacity duration-300 ${label ? "opacity-100" : "opacity-0"}`}>{label}</span>
    </div>
  );
}
