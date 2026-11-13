import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { KV, VarProfile } from "../types";
import { t } from "../lib/i18n";

interface Props {
  /** Variables globales del espacio. */
  vars: KV[];
  onVars: (v: KV[]) => void;
  /** Perfil de variables activo (pisa a la colección y a las globales). null = ninguno. */
  profile: VarProfile | null;
  onProfileVars: (v: KV[]) => void;
  /** Variables de la colección abierta (pisan a las globales). null = no hay colección abierta. */
  collVars: KV[] | null;
  onCollVars: ((v: KV[]) => void) | null;
}

interface Open {
  name: string;
  x: number;
  y: number;
}

const TOKEN = /\{\{\s*([\w.$-]+)\s*\}\}/g;

/** Nombre de la variable {{x}} que hay bajo el cursor de un campo de texto (null si el cursor no está sobre ninguna). */
export function variableAt(text: string, caret: number): string | null {
  for (const m of text.matchAll(TOKEN)) {
    const s = m.index ?? 0;
    if (caret >= s && caret <= s + m[0].length) return m[1];
  }
  return null;
}

const upsert = (list: KV[], key: string, value: string): KV[] =>
  list.some((v) => v.key === key) ? list.map((v) => (v.key === key ? { ...v, value } : v)) : [...list, { key, value, enabled: true }];

/**
 * Ctrl+clic (Cmd+clic en macOS) sobre una variable {{nombre}} de cualquier campo: abre una pestañita con su valor para verlo y
 * editarlo. Si la variable está en la colección se edita ahí; si es global, en las globales; si no existe se crea (en la colección
 * abierta o, si no hay, en las globales).
 */
export default function VarPeek({ vars, onVars, profile, onProfileVars, collVars, onCollVars }: Props) {
  const [open, setOpen] = useState<Open | null>(null);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ref = useRef({ vars, collVars, profVars: profile?.vars ?? null });
  ref.current = { vars, collVars, profVars: profile?.vars ?? null };

  const where = (name: string): "prof" | "coll" | "global" | "new" =>
    profile?.vars.some((v) => v.key === name) ? "prof" : collVars?.some((v) => v.key === name) ? "coll" : vars.some((v) => v.key === name) ? "global" : "new";
  const current = (name: string) => {
    const { vars: g, collVars: c, profVars: p } = ref.current;
    return (p?.find((v) => v.key === name) ?? c?.find((v) => v.key === name) ?? g.find((v) => v.key === name))?.value ?? "";
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (el.type === "password") return;
      const caret = el.selectionStart;
      if (caret === null || el.selectionEnd !== caret) return;
      const name = variableAt(el.value, caret);
      if (!name) return;
      e.preventDefault();
      e.stopPropagation();
      setValue(current(name));
      setOpen({ name, x: Math.max(8, Math.min(e.clientX, window.innerWidth - 340)), y: Math.min(e.clientY + 14, window.innerHeight - 190) });
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (open) input.current?.select();
  }, [open]);

  if (!open) return null;
  const place = where(open.name);
  const toProf = place === "prof" || (place === "new" && !!profile);
  const toColl = !toProf && (place === "coll" || (place === "new" && !!onCollVars));

  const save = () => {
    if (toProf) onProfileVars(upsert(profile?.vars ?? [], open.name, value));
    else if (toColl && onCollVars) onCollVars(upsert(collVars ?? [], open.name, value));
    else onVars(upsert(vars, open.name, value));
    setOpen(null);
  };
  const scope = place === "prof" ? `${t("Del perfil")}: ${profile?.name ?? ""}` : place === "coll" ? t("De la colección") : place === "global" ? t("Global") : toProf ? `${t("No definida: se creará en el perfil")}: ${profile?.name ?? ""}` : toColl ? t("No definida: se creará en la colección") : t("No definida: se creará como global");

  return (
    <div className="fixed inset-0 z-[85]" onMouseDown={() => setOpen(null)}>
      <div
        style={{ left: open.x, top: open.y, width: 330 }}
        className="absolute space-y-2 rounded-xl bg-kelp p-3 text-xs shadow-2xl ring-1 ring-fg/20"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-sm" style={{ color: "var(--t-hl)" }}>{`{{${open.name}}}`}</span>
          <button onClick={() => setOpen(null)} className="text-slate hover:text-mist" title={t("Cerrar (Esc)")}>
            <X size={14} />
          </button>
        </div>
        <p className="text-slate">{scope}</p>
        <div className="flex gap-1.5">
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(null);
              }
            }}
            placeholder={t("Valor")}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg bg-deep px-3 py-1.5 font-mono text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
          />
          <button onClick={save} className="rounded-lg px-3 text-white" style={{ background: "var(--t-iris)" }} title={t("Guardar")}>
            <Check size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
