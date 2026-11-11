import { useEffect } from "react";
import { Check, X } from "lucide-react";
import { THEMES, type Theme } from "../lib/themes";

interface Props {
  themeId: string;
  onTheme: (id: string) => void;
  onClose: () => void;
}

function Preview({ t }: { t: Theme }) {
  const u = t.ui;
  return (
    <div className="overflow-hidden rounded-xl text-[11px] leading-5" style={{ background: u.abyss, border: `1px solid ${u.kelp}` }}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ background: u.deep }}>
        <span className="h-2 w-2 rounded-full" style={{ background: u.iris }} />
        <span className="h-1.5 w-10 rounded-full" style={{ background: u.kelp }} />
        <span className="ml-auto rounded px-1.5 text-[9px] font-semibold" style={{ background: u.iris, color: u.onprimary }}>SEND</span>
      </div>
      <div className="px-2.5 py-2 font-mono">
        <div>
          <span style={{ color: t.resp.punc }}>{"{ "}</span>
          <span style={{ color: t.resp.key }}>"name"</span>
          <span style={{ color: t.resp.punc }}>: </span>
          <span style={{ color: t.resp.str }}>"Caesar"</span>
          <span style={{ color: t.resp.punc }}>,</span>
        </div>
        <div>
          <span style={{ color: t.resp.punc }}>{"  "}</span>
          <span style={{ color: t.resp.key }}>"ok"</span>
          <span style={{ color: t.resp.punc }}>: </span>
          <span style={{ color: t.resp.bool }}>true</span>
          <span style={{ color: t.resp.punc }}>, </span>
          <span style={{ color: t.resp.key }}>"n"</span>
          <span style={{ color: t.resp.punc }}>: </span>
          <span style={{ color: t.resp.num }}>42</span>
          <span style={{ color: t.resp.punc }}>{" }"}</span>
        </div>
        <div className="mt-1.5 flex gap-1.5 font-sans">
          <span className="rounded-full px-2 text-[9px] font-semibold" style={{ background: `${u.ok}26`, color: u.ok }}>200 OK</span>
          <span className="rounded-full px-2 text-[9px] font-semibold" style={{ background: `${u.bad}26`, color: u.bad }}>500 Error</span>
        </div>
      </div>
    </div>
  );
}

export default function SettingsModal({ themeId, onTheme, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-8" onMouseDown={onClose}>
      <div
        className="glass flex max-h-full w-full max-w-4xl flex-col rounded-2xl bg-kelp p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="cosmic-text text-3xl font-normal tracking-[-0.02em]">Ajustes</h2>
          <button onClick={onClose} className="text-slate hover:text-mist" title="Cerrar (Esc)">
            <X size={22} />
          </button>
        </div>
        <p className="mb-6 text-sm text-slate">
          Elige el estilo de la aplicación. Los colores de GET, POST, PUT, PATCH y DELETE son siempre los mismos.
        </p>

        <p className="eyebrow mb-3">Tema</p>
        <div className="grid flex-1 grid-cols-2 gap-4 overflow-y-auto pr-1 md:grid-cols-3">
          {THEMES.map((t) => {
            const active = t.id === themeId;
            return (
              <button
                key={t.id}
                onClick={() => onTheme(t.id)}
                className={`rounded-2xl p-3 text-left transition ${active ? "ring-2 ring-aqua" : "ring-1 ring-fg/10 hover:ring-fg/30"}`}
              >
                <Preview t={t} />
                <div className="mt-2.5 flex items-center justify-between px-1 text-sm text-mist">
                  <span>{t.name}</span>
                  {active && <Check size={15} className="text-aqua" />}
                </div>
                <div className="mt-1.5 flex gap-1 px-1">
                  {[t.ui.abyss, t.ui.iris, t.ui.accent, t.ui.hl, t.resp.key, t.resp.str].map((c, i) => (
                    <span key={i} className="h-3 w-3 rounded-full ring-1 ring-fg/20" style={{ background: c }} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
