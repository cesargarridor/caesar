import { useEffect, useState } from "react";
import { MousePointerClick, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { t } from "../lib/i18n";
import {
  COMMANDS, allCommands, assignCombo, comboFromEvent, deleteAction, getActions, getCombos, getToolbar, isCustomized, prettyCombo,
  removeCombo, resetAll, resetCommand, saveAction, setRecording, toggleToolbar,
} from "../lib/keymap";
import { useKeymapVersion } from "../lib/useKeymap";

const kbd = "rounded-md bg-kelp px-2 py-0.5 font-mono text-xs text-mist ring-1 ring-fg/20";
const ghost = "rounded-lg px-3 py-1.5 text-xs text-silver ring-1 ring-fg/20 hover:text-mist hover:ring-fg/40 disabled:opacity-40";

/** Graba la próxima combinación que pulse el usuario (Esc cancela). */
function Recorder({ onCombo, onCancel }: { onCombo: (c: string) => void; onCancel: () => void }) {
  useEffect(() => {
    setRecording(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return onCancel();
      const c = comboFromEvent({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, altGr: e.getModifierState?.("AltGraph") });
      if (c) onCombo(c);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setRecording(false);
    };
  }, [onCombo, onCancel]);
  return <span className="animate-pulse rounded-md bg-deep px-2 py-0.5 text-xs text-aqua ring-1 ring-aqua/60">{t("Pulsa la combinación… (Esc cancela)")}</span>;
}

/** Atajos de teclado totalmente editables, acciones propias (varios comandos seguidos) y botones junto a la URL. */
export default function ShortcutsEditor() {
  useKeymapVersion();
  const [rec, setRec] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const cmds = allCommands();
  const label = (id: string) => {
    const c = cmds.find((x) => x.id === id);
    return c ? (c.user ? c.label : t(c.label)) : id;
  };
  const toolbar = getToolbar();

  const onCombo = (id: string) => (combo: string) => {
    const r = assignCombo(id, combo);
    setRec(null);
    if (!r.ok) setMsg({ ok: false, text: t("Un atajo necesita Ctrl o Alt junto a la tecla (o ser una tecla F1–F12).") });
    else if (r.displaced) setMsg({ ok: true, text: `${prettyCombo(combo)} ${t("estaba en")} «${label(r.displaced)}»${t(": se le ha quitado.")}` });
    else setMsg(null);
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="mb-1 text-lg text-mist">{t("Atajos de teclado")}</h3>
        <p className="text-xs text-slate">
          {t("Cambia cualquier atajo a lo que quieras: pulsa «Añadir» y la combinación nueva. Un comando puede tener varios atajos. Si eliges uno que ya usa otro comando, se le quita a ese. Marca «Botón» para tener el comando como botón junto a la URL.")}
        </p>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-aqua" : "text-rose"}`}>{msg.text}</p>}
      <div className="divide-y divide-fg/10 rounded-xl bg-deep ring-1 ring-fg/10">
        {cmds.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-48 text-silver">{label(c.id)}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {getCombos(c.id).map((k) => (
                <span key={k} className="inline-flex items-center gap-1">
                  <kbd className={kbd}>{prettyCombo(k)}</kbd>
                  <button onClick={() => removeCombo(c.id, k)} className="text-slate hover:text-rose" title={t("Quitar este atajo")}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              {rec === c.id ? (
                <Recorder onCombo={onCombo(c.id)} onCancel={() => setRec(null)} />
              ) : (
                <button onClick={() => { setMsg(null); setRec(c.id); }} className="inline-flex items-center gap-1 text-xs text-slate hover:text-aqua" title={t("Añadir un atajo")}>
                  <Plus size={12} /> {t("Añadir")}
                </button>
              )}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-slate" title={t("Mostrar como botón junto a la URL")}>
              <input type="checkbox" checked={toolbar.includes(c.id)} onChange={() => toggleToolbar(c.id)} className="accent-[var(--t-accent)]" />
              <MousePointerClick size={12} /> {t("Botón")}
            </label>
            {isCustomized(c.id) && !c.user && (
              <button onClick={() => resetCommand(c.id)} className="text-slate hover:text-mist" title={t("Volver al atajo por defecto")}>
                <RotateCcw size={12} />
              </button>
            )}
            {c.user && (
              <button onClick={() => deleteAction(c.id)} className="text-slate hover:text-rose" title={t("Eliminar esta acción")}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => { resetAll(); setMsg(null); }} className={ghost}>{t("Restablecer todos los atajos")}</button>
        <p className="text-xs text-slate">{t("En macOS, Ctrl se sustituye por Cmd.")}</p>
      </div>

      <div className="space-y-2 rounded-xl bg-deep p-4 ring-1 ring-fg/10">
        <h4 className="text-sm text-mist">{t("Crear una acción propia")}</h4>
        <p className="text-xs text-slate">{t("Une varios comandos en uno (por ejemplo guardar y enviar). La acción aparece en la lista de arriba, donde le pones atajo y botón.")}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Nombre de la acción")}
          className="w-full max-w-sm rounded-xl bg-kelp px-3 py-1.5 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
        />
        <ol className="list-decimal space-y-1 pl-5 text-xs text-silver">
          {steps.map((s, i) => (
            <li key={i}>
              {label(s)}{" "}
              <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-slate hover:text-rose" title={t("Quitar")}>
                <X size={11} className="inline" />
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-xl bg-kelp px-2 py-1.5 text-sm text-mist outline-none ring-1 ring-fg/10">
            <option value="">{t("Añadir un comando…")}</option>
            {COMMANDS.map((c) => (
              <option key={c.id} value={c.id}>{t(c.label)}</option>
            ))}
          </select>
          <button
            disabled={!pick}
            onClick={() => { setSteps([...steps, pick]); setPick(""); }}
            className={ghost}
          >
            {t("Añadir paso")}
          </button>
          <button
            disabled={!name.trim() || !steps.length}
            onClick={() => { saveAction({ name, steps }); setName(""); setSteps([]); }}
            className="rounded-lg px-4 py-1.5 text-sm text-white disabled:opacity-40"
            style={{ background: "var(--t-iris)" }}
          >
            {t("Crear acción")}
          </button>
        </div>
        {getActions().length > 0 && <p className="text-xs text-slate">{t("Tus acciones")}: {getActions().map((a) => a.name).join(", ")}</p>}
      </div>
    </section>
  );
}
