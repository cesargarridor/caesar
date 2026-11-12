import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Kind = "ok" | "err" | "info";
interface ToastItem { id: number; kind: Kind; text: string }
interface ToastApi { show: (text: string, kind?: Kind, ms?: number) => void }

const Ctx = createContext<ToastApi>({ show: () => {} });

/** Avisos efímeros arriba a la derecha. Uso: `const toast = useToast(); toast.show("Hecho")`. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, kind: Kind = "ok", ms = 5000) => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), ms);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[90] flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {items.map((x) => (
          <div
            key={x.id}
            className={`pointer-events-auto rounded-xl bg-kelp px-4 py-3 text-sm shadow-lg ring-1 ${x.kind === "err" ? "text-rose ring-rose/40" : "text-mist ring-fg/20"}`}
            onClick={() => setItems((l) => l.filter((y) => y.id !== x.id))}
          >
            {x.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
