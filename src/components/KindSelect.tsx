import { useEffect, useRef, useState } from "react";
import { Braces, ChevronDown, Globe, Plug } from "lucide-react";
import type { RequestKind } from "../types";
import { t } from "../lib/i18n";

interface Props {
  kind: RequestKind;
  onChange: (kind: RequestKind) => void;
}

const KINDS: { id: RequestKind; label: string; short: string; color: string; Icon: typeof Globe }[] = [
  { id: "http", label: "HTTP", short: "HTTP", color: "text-silver", Icon: Globe },
  { id: "gql", label: "GraphQL", short: "GQL", color: "text-[var(--t-m-gql)]", Icon: Braces },
  { id: "ws", label: "WebSocket", short: "WS", color: "text-[var(--t-m-ws)]", Icon: Plug },
];

/** Selector compacto del tipo de petición (HTTP, GraphQL, WebSocket), situado a la izquierda del método GET/POST/… */
export default function KindSelect({ kind, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const cur = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  const CurIcon = cur.Icon;

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${t("Tipo de petición")}: ${cur.label}`}
        aria-label={`${t("Tipo de petición")}: ${cur.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-full items-center gap-1 rounded-[10px] bg-kelp px-2 py-2 text-[11px] font-medium ring-1 ring-fg/10 transition-colors hover:ring-aqua/60 focus:outline-none focus:ring-aqua ${cur.color}`}
      >
        <CurIcon size={12} strokeWidth={1.75} className="shrink-0" />
        <span className="tracking-tight">{cur.short}</span>
        <ChevronDown size={10} strokeWidth={1.75} className="shrink-0 text-slate" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1.5 w-36 rounded-xl bg-kelp p-1 text-xs shadow-xl ring-1 ring-fg/15"
        >
          {KINDS.map((k) => {
            const Icon = k.Icon;
            const active = k.id === kind;
            return (
              <button
                key={k.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (k.id !== kind) onChange(k.id);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                  active ? "bg-fg/10 font-semibold text-mist" : "text-silver hover:bg-fg/5 hover:text-mist"
                }`}
              >
                <Icon size={13} strokeWidth={1.75} className={k.color} />
                <span>{k.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
