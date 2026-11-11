import { useEffect, useState } from "react";
import { Check, RefreshCw, RotateCcw, X } from "lucide-react";
import type { UpdateState } from "../types";
import { THEMES, type Theme } from "../lib/themes";
import CatLogo from "./CatLogo";
import SyncSettings from "./SyncSettings";
import { LANGS, getLang, setLang, t, t as tr, useLang } from "../lib/i18n";
import { setCatAnim, setNetAnim, useCatAnim, useNetAnim } from "../lib/prefs";
import { FONT_DEFAULTS, FONT_FIELDS, type FontPrefs } from "../lib/prefs";

export interface UpdatesProps {
  version: string;
  auto: boolean;
  onAuto: (on: boolean) => void;
  state: UpdateState;
  onCheck: () => void;
  onInstall: () => void;
}

interface Props {
  themeId: string;
  onTheme: (id: string) => void;
  fonts: FontPrefs;
  onFonts: (f: FontPrefs) => void;
  hideEmpty: boolean;
  onHideEmpty: (on: boolean) => void;
  updates: UpdatesProps;
  onClose: () => void;
}

function Preview({ t }: { t: Theme }) {
  const u = t.ui;
  return (
    <div className="overflow-hidden rounded-xl text-[11px] leading-5" style={{ background: u.abyss, border: `1px solid ${u.kelp}` }}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ background: u.deep }}>
        <span className="h-2 w-2 rounded-full" style={{ background: u.iris }} />
        <span className="h-1.5 w-10 rounded-full" style={{ background: u.kelp }} />
        <span className="ml-auto rounded px-1.5 text-[9px] font-semibold" style={{ background: u.iris, color: u.onprimary }}>{tr("Enviar").toUpperCase()}</span>
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

function FontControls({ fonts, onFonts }: { fonts: FontPrefs; onFonts: (f: FontPrefs) => void }) {
  const changed = FONT_FIELDS.some((f) => fonts[f.key] !== FONT_DEFAULTS[f.key]);
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 py-1">
      {FONT_FIELDS.map((f) => {
        const v = fonts[f.key];
        const set = (n: number) => onFonts({ ...fonts, [f.key]: Math.min(f.max, Math.max(f.min, n)) });
        return (
          <div key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
            <div>
              <p className="text-sm text-mist">{t(f.label)}</p>
              <p className="text-xs text-slate">{t(f.hint)}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={v}
                onChange={(e) => e.target.value !== "" && set(Number(e.target.value))}
                className="w-16 rounded-lg bg-deep px-2 py-1 text-right text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
              />
              <span className="w-5 text-xs text-slate">{f.unit}</span>
              <button
                onClick={() => set(FONT_DEFAULTS[f.key])}
                disabled={v === FONT_DEFAULTS[f.key]}
                className="rounded p-1 text-slate hover:text-mist disabled:opacity-30"
                title={`${t("Restablecer")} (${FONT_DEFAULTS[f.key]}${f.unit})`}
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={v}
              onChange={(e) => set(Number(e.target.value))}
              className="col-span-2 accent-[var(--t-accent)]"
            />
          </div>
        );
      })}
      <div className="shrink-0 rounded-xl bg-deep p-4 ring-1 ring-fg/10">
        <p className="eyebrow mb-2">{t("Vista previa")}</p>
        <pre className="font-mono" style={{ fontSize: "var(--fs-body)", lineHeight: 1.6, color: "var(--t-b-str)" }}>{`{ "body": "${t("lo que envías")}" }`}</pre>
        <pre className="font-mono" style={{ fontSize: "var(--fs-resp)", lineHeight: 1.6, color: "var(--t-r-str)" }}>{`{ "response": "${t("lo que recibes")}" }`}</pre>
      </div>
      <button
        onClick={() => onFonts({ ...FONT_DEFAULTS })}
        disabled={!changed}
        className="flex items-center gap-1.5 text-xs text-silver hover:text-mist disabled:opacity-30"
      >
        <RotateCcw size={13} /> {t("Restablecer todos los tamaños")}
      </button>
    </div>
  );
}

function ResponseControls({ hideEmpty, onHideEmpty }: { hideEmpty: boolean; onHideEmpty: (on: boolean) => void }) {
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 py-1">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={hideEmpty}
          onChange={(e) => onHideEmpty(e.target.checked)}
          className="mt-1 accent-[var(--t-accent)]"
        />
        <span>
          <span className="block text-sm text-mist">{t("Ocultar valores vacíos en el body de la respuesta")}</span>
          <span className="block text-xs text-slate">
            {t("No muestra los campos que valen null, las listas vacías [] ni los objetos vacíos {} (tampoco los bloques que se quedan sin nada).")}{" "}
            {t("Solo cambia lo que ves en la vista Pretty: la vista Raw y el botón Copy siguen usando la respuesta completa.")}
          </span>
        </span>
      </label>
      <div className="shrink-0 rounded-xl bg-deep p-4 ring-1 ring-fg/10">
        <p className="eyebrow mb-2">{t("Ejemplo")}</p>
        <pre className="font-mono text-xs text-silver">{hideEmpty ? '{\n  "id": 7,\n  "name": "Ana"\n}' : '{\n  "id": 7,\n  "name": "Ana",\n  "email": null,\n  "tags": [],\n  "extra": {}\n}'}</pre>
      </div>
    </div>
  );
}

function CatControls() {
  const on = useCatAnim();
  const net = useNetAnim();
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 py-1">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={on} onChange={(e) => setCatAnim(e.target.checked)} className="mt-1 accent-[var(--t-accent)]" />
        <span>
          <span className="block text-sm text-mist">{t("Animar al gatito")}</span>
          <span className="block text-xs text-slate">
            {t("Se menea al pasar el ratón, cierra los ojos de felicidad y suelta corazones al hacerle clic, y salta en la pantalla de actualización.")}
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={net} onChange={(e) => setNetAnim(e.target.checked)} className="mt-1 accent-[var(--t-accent)]" />
        <span>
          <span className="block text-sm text-mist">{t("Animar la red de nodos")}</span>
          <span className="block text-xs text-slate">
            {t("Al enviar una petición aparece una red de nodos con pulsos y polvo de estrellas que sigue al ratón, con el color del método. Desactivada, solo se ve el cuadro de pasos.")}
          </span>
        </span>
      </label>
      <div className="flex shrink-0 items-center justify-center rounded-xl bg-deep p-6 ring-1 ring-fg/10">
        <CatLogo size={96} />
      </div>
    </div>
  );
}

function UpdateControls({ u }: { u: UpdatesProps }) {
  const s = u.state;
  const busy = s.phase === "checking" || s.phase === "installing";
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 py-1">
      <div className="shrink-0 rounded-xl bg-deep p-4 ring-1 ring-fg/10">
        <p className="eyebrow mb-1">{t("Versión instalada")}</p>
        <p className="text-lg text-mist">{u.version ? `v${u.version}` : "—"}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={u.auto}
          onChange={(e) => u.onAuto(e.target.checked)}
          className="mt-1 accent-[var(--t-accent)]"
        />
        <span>
          <span className="block text-sm text-mist">{t("Actualizar automáticamente")}</span>
          <span className="block text-xs text-slate">
            {t("Al abrir Caesar se busca una versión nueva; si la hay, se descarga, se instala y la app se reinicia sola. Si lo desactivas, Caesar no consulta nada por su cuenta y solo se actualiza cuando pulses el botón.")}
          </span>
        </span>
      </label>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={u.onCheck}
            disabled={busy}
            className="flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40 disabled:opacity-50"
          >
            <RefreshCw size={14} className={s.phase === "checking" ? "animate-spin" : ""} /> {t("Buscar actualizaciones")}
          </button>
          {s.phase === "available" && (
            <button onClick={u.onInstall} className="btn-aurora px-5 py-2 font-semibold">
              {t("Instalar v{0}", s.version)}
            </button>
          )}
        </div>
        {s.phase === "checking" && <p className="text-sm text-slate">{t("Buscando…")}</p>}
        {s.phase === "uptodate" && (
          <p className="flex items-center gap-1.5 text-sm text-leaf"><Check size={15} /> {t("Tienes la última versión.")}</p>
        )}
        {s.phase === "available" && (
          <div className="text-sm text-mist">
            <p>{t("Hay una versión nueva:")} <b>v{s.version}</b>.</p>
            {s.notes && <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-deep p-3 text-xs text-silver">{s.notes}</pre>}
          </div>
        )}
        {s.phase === "error" && <p className="whitespace-pre-wrap text-sm text-rose">{s.message}</p>}
      </div>
    </div>
  );
}

export default function SettingsModal({ themeId, onTheme, fonts, onFonts, hideEmpty, onHideEmpty, updates, onClose }: Props) {
  useLang();
  const [section, setSection] = useState<"theme" | "fonts" | "response" | "updates" | "lang" | "cat" | "sync">("theme");
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
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <h2 className="cosmic-text text-3xl font-normal tracking-[-0.02em]">{t("Ajustes")}</h2>
          <button onClick={onClose} className="text-slate hover:text-mist" title={t("Cerrar (Esc)")}>
            <X size={22} />
          </button>
        </div>
        <p className="mb-4 shrink-0 text-sm text-slate">
          {section === "theme"
            ? t("Elige el estilo de la aplicación. Los colores de GET, POST, PUT, PATCH y DELETE son siempre los mismos.")
            : section === "fonts"
              ? t("Ajusta el tamaño de la letra en toda la aplicación o solo en la zona que quieras. Los cambios se aplican al instante.")
              : section === "response"
                ? t("Cómo se muestra el body de la respuesta que recibes.")
                : section === "lang"
                  ? t("Elige el idioma de la interfaz. Se aplica al instante.")
                  : section === "sync" ? t("Usa tus colecciones en varios equipos. Todo se cifra en tu equipo antes de subirse; la nube nunca puede leerlo.") : section === "cat"
                    ? t("Animaciones: el gatito del logo y la red de nodos de la pantalla de carga. Desactivarlas ahorra memoria y CPU.")
                  : t("Las versiones nuevas llegan firmadas desde GitHub; Caesar comprueba la firma antes de instalarlas.")}
        </p>
        <div className="mb-5 flex shrink-0 gap-1 overflow-x-auto border-b border-fg/10">
          {([["theme", "Tema"], ["fonts", "Tamaño de letra"], ["response", "Respuesta"], ["lang", "Idioma"], ["cat", "Animación"], ["sync", "Sincronización"], ["updates", "Actualizaciones"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
                section === id ? "border-aqua text-mist" : "border-transparent text-slate hover:text-silver"
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>

        {section === "fonts" ? (
          <FontControls fonts={fonts} onFonts={onFonts} />
        ) : section === "response" ? (
          <ResponseControls hideEmpty={hideEmpty} onHideEmpty={onHideEmpty} />
        ) : section === "sync" ? (<SyncSettings />) : section === "cat" ? (
          <CatControls />
        ) : section === "lang" ? (
          <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 content-start gap-3 overflow-y-auto px-1 py-1 md:grid-cols-3">
            {LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left text-sm text-mist ${
                  getLang() === l.id ? "ring-2 ring-aqua" : "ring-1 ring-fg/10 hover:ring-fg/30"
                }`}
              >
                {l.name}
                {getLang() === l.id && <Check size={15} className="text-aqua" />}
              </button>
            ))}
          </div>
        ) : section === "updates" ? (
          <UpdateControls u={updates} />
        ) : (
        <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-4 overflow-y-auto px-1 py-1 md:grid-cols-3">
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
        )}
      </div>
    </div>
  );
}
