import { useEffect, useState } from "react";
import { Check, Copy, Download, Users, X } from "lucide-react";
import { t } from "../lib/i18n";
import type { ExportFormat } from "../lib/interchange";

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div data-modal className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-8" onMouseDown={onClose}>
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-kelp p-7 glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl text-mist">{title}</h2>
          <button onClick={onClose} className="text-slate hover:text-mist" title={t("Cerrar (Esc)")}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ghost = "rounded-[10px] px-4 py-2 text-sm text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40 disabled:opacity-40";
const field = "w-full rounded-lg bg-deep px-3 py-2 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua";

function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-deep p-4 ring-1 ring-fg/10">
      <code className="flex-1 select-all text-center font-mono text-xl tracking-widest text-aqua">{code}</code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* sin portapapeles */
          }
        }}
        className="text-silver hover:text-mist"
        title={t("Copiar código")}
      >
        {copied ? <Check size={18} /> : <Copy size={18} />}
      </button>
    </div>
  );
}

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));

/** «Nueva colección»: crear una propia o unirse a una de equipo con su código. */
export function NewCollectionDialog({ onClose, onOwn, onJoin }: { onClose: () => void; onOwn: () => void; onJoin: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onJoin(code);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <Shell title={t("Nueva colección")} onClose={onClose}>
      <button onClick={onOwn} className="btn-aurora mb-5 w-full px-5 py-3 font-semibold">{t("Crear colección propia")}</button>
      <p className="eyebrow mb-2">{t("O unirte a una de equipo")}</p>
      <div className="flex gap-2">
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && code.trim() && !busy && void join()}
          placeholder="TEAM-XXXX-XXXX-XXXX"
          spellCheck={false}
          className={`${field} font-mono`}
        />
        <button onClick={() => void join()} disabled={busy || !code.trim()} className={ghost}>{busy ? t("Uniéndote…") : t("Unirme")}</button>
      </div>
      {err && <p className="mt-3 text-xs text-rose">{err}</p>}
      <p className="mt-3 text-xs text-slate">{t("Necesitas haber iniciado sesión (Ajustes → Cuenta y suscripción). La colección se descarga a tu equipo y se mantiene al día sola.")}</p>
    </Shell>
  );
}

/** Aviso previo a compartir: la colección pasa a ser de todos; ofrece una copia de seguridad antes. */
export function ShareDialog({
  name, onClose, onExport, onConfirm,
}: { name: string; onClose: () => void; onExport: (f: ExportFormat) => Promise<void>; onConfirm: () => Promise<string> }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (code) {
    return (
      <Shell title={t("Colección compartida")} onClose={onClose}>
        <p className="mb-4 text-sm text-silver">{t("Pasa este código a tu equipo. Cada persona lo pega en «Nueva colección → Unirme».")}</p>
        <CodeBox code={code} />
        <div className="mt-6 flex justify-end"><button onClick={onClose} className="btn-aurora px-6 py-2.5 font-semibold">{t("Listo")}</button></div>
      </Shell>
    );
  }
  return (
    <Shell title={t("Compartir «{0}» con el equipo", name)} onClose={onClose}>
      <div className="space-y-3 text-sm text-silver">
        <p>{t("La colección pasará a ser de todos los que tengan el código: cualquiera podrá editarla y los cambios se sincronizan solos.")}</p>
        <p className="text-lav">{t("Si quien la comparte elimina su cuenta, la colección se elimina para todos y no se puede recuperar.")}</p>
        <p>{t("Antes de continuar, guarda una copia de seguridad en el formato que prefieras:")}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["json", "yaml", "har"] as const).map((f) => (
          <button
            key={f}
            onClick={async () => {
              try {
                await onExport(f);
                setSaved(f);
              } catch (e) {
                setErr(errText(e));
              }
            }}
            className={`${ghost} flex items-center gap-1.5`}
          >
            <Download size={14} /> {f === "json" ? "JSON" : f === "yaml" ? "YAML" : "HAR"}
            {saved === f && <Check size={14} className="text-leaf" />}
          </button>
        ))}
      </div>
      <label className="mt-5 flex cursor-pointer items-start gap-2 text-sm text-silver">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-[var(--t-accent)]" />
        {t("Entiendo que la colección pasa a ser de todo el equipo.")}
      </label>
      {err && <p className="mt-3 text-xs text-rose">{err}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className={ghost}>{t("Cancelar")}</button>
        <button
          disabled={!ack || busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              setCode(await onConfirm());
            } catch (e) {
              setErr(errText(e));
              setBusy(false);
            }
          }}
          className="btn-aurora flex items-center gap-2 px-6 py-2.5 font-semibold disabled:opacity-40"
        >
          <Users size={16} /> {busy ? t("Compartiendo…") : t("Compartir")}
        </button>
      </div>
    </Shell>
  );
}

/** Aviso previo a compartir un espacio entero: pasa a ser de todo el equipo. Las variables solo se comparten si se elige. */
export function ShareWorkspaceDialog({
  name, onClose, onConfirm,
}: { name: string; onClose: () => void; onConfirm: (includeVars: boolean) => Promise<string> }) {
  const [ack, setAck] = useState(false);
  const [vars, setVars] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (code) {
    return (
      <Shell title={t("Espacio compartido")} onClose={onClose}>
        <p className="mb-4 text-sm text-silver">{t("Pasa este código a tu equipo. Cada persona lo pega en el selector de espacios → «Unirme a un espacio con un código».")}</p>
        <CodeBox code={code} />
        <div className="mt-6 flex justify-end"><button onClick={onClose} className="btn-aurora px-6 py-2.5 font-semibold">{t("Listo")}</button></div>
      </Shell>
    );
  }
  return (
    <Shell title={t("Compartir «{0}» con el equipo", name)} onClose={onClose}>
      <div className="space-y-3 text-sm text-silver">
        <p>{t("Todo el espacio (sus colecciones) pasará a ser de quienes tengan el código: cualquiera podrá editarlo y los cambios se sincronizan al guardar y al pulsar Actualizar.")}</p>
        <p className="text-lav">{t("Si quien lo comparte elimina su cuenta, el espacio se elimina de la nube para todos y no se puede recuperar.")}</p>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-silver">
        <input type="checkbox" checked={vars} onChange={(e) => setVars(e.target.checked)} className="mt-1 accent-[var(--t-accent)]" />
        <span>
          {t("Compartir también las variables del espacio")}
          <span className="block text-xs text-slate">{t("Pueden contener claves o tokens. Si no lo marcas, cada persona conserva las suyas.")}</span>
        </span>
      </label>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-silver">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-[var(--t-accent)]" />
        {t("Entiendo que el espacio pasa a ser de todo el equipo.")}
      </label>
      {err && <p className="mt-3 text-xs text-rose">{err}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className={ghost}>{t("Cancelar")}</button>
        <button
          disabled={!ack || busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              setCode(await onConfirm(vars));
            } catch (e) {
              setErr(errText(e));
              setBusy(false);
            }
          }}
          className="btn-aurora flex items-center gap-2 px-6 py-2.5 font-semibold disabled:opacity-40"
        >
          <Users size={16} /> {busy ? t("Compartiendo…") : t("Compartir")}
        </button>
      </div>
    </Shell>
  );
}

/** Código de una colección de equipo y, según el rol, dejar de compartir o salir. */
export function TeamInfoDialog({
  name, code, owner, onClose, onLeave,
}: { name: string; code: string; owner: boolean; onClose: () => void; onLeave: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pretty = code.length === 16 ? `TEAM-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}` : code;
  return (
    <Shell title={t("Equipo: {0}", name)} onClose={onClose}>
      <p className="mb-3 text-sm text-silver">{t("Código para invitar a más personas:")}</p>
      <CodeBox code={pretty} />
      <p className="mt-4 text-xs text-slate">
        {owner
          ? t("Eres quien la compartió: si dejas de compartir o eliminas tu cuenta, se elimina de la nube para todos (cada persona conserva su copia local).")
          : t("Si sales del equipo, conservas tu copia local pero ya no se sincroniza.")}
      </p>
      {err && <p className="mt-3 text-xs text-rose">{err}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button onClick={onClose} className={ghost}>{t("Cerrar")}</button>
        <button
          disabled={busy}
          onClick={async () => {
            if (!confirm) return setConfirm(true);
            setBusy(true);
            try {
              await onLeave();
            } catch (e) {
              setErr(errText(e));
              setBusy(false);
            }
          }}
          className="rounded-[10px] px-4 py-2 text-sm text-rose ring-1 ring-rose/40 hover:ring-rose disabled:opacity-40"
        >
          {confirm ? t("Pulsa otra vez para confirmar") : owner ? t("Dejar de compartir") : t("Salir del equipo")}
        </button>
      </div>
    </Shell>
  );
}
