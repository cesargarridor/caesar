import { useEffect, useRef, useState } from "react";

/** Tooltip propio que sale tras 1 s con el ratón encima (el `title` nativo tarda según el sistema y no se puede ajustar). */
export default function DelayTip({ text, children, delay = 1000 }: { text: string; children: React.ReactNode; delay?: number }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };
  useEffect(() => hide, []);
  return (
    <span
      className="inline-flex"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setPos({ x: r.left + r.width / 2, y: r.bottom + 6 }), delay);
      }}
      onMouseLeave={hide}
      onMouseDown={hide}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          style={{ left: pos.x, top: pos.y, transform: "translateX(-50%)" }}
          className="pointer-events-none fixed z-[70] whitespace-nowrap rounded-md bg-kelp px-2.5 py-1 text-xs text-mist shadow-lg ring-1 ring-fg/20"
        >
          {text}
        </span>
      )}
    </span>
  );
}
