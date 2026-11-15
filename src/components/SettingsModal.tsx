import { useEffect, useState } from "react";
import { Check, RefreshCw, RotateCcw, X } from "lucide-react";
import type { UpdateState } from "../types";
import { THEMES, useTheme, type ColorMode, type Theme } from "../lib/themes";
import CatLogo from "./CatLogo";
import { setJsonCopyMode, useJsonCopyMode, type JsonCopyMode } from "../lib/jsonCopy";
import ShortcutsEditor from "./ShortcutsEditor";
import SyncSettings from "./SyncSettings";
import SettingsPrivacy from "./SettingsPrivacy";
import { LANGS, getLang, setLang, t, t as tr, useLang } from "../lib/i18n";
import { BASE_METHODS, EXTRA_METHODS, setCatAnim, setNetAnim, useCatAnim, useNetAnim } from "../lib/prefs";
import { FONT_DEFAULTS, FONT_FIELDS, type FontPrefs } from "../lib/prefs";
import { FONT_OPTIONS, applyFontFamily, loadFontId, saveFontId } from "../lib/fonts";

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
  autosave: boolean;
  onAutosave: (on: boolean) => void;
  extraMethods: string[];
  onExtraMethods: (m: string[]) => void;
  initialSection?: "ui" | "edit" | "sync";
  /** Colecciones compartidas en este equipo (se van al cerrar sesión). */
  sharedCount: number;
  /** Se llama antes de cerrar sesión para subir lo pendiente de las colecciones compartidas. */
  onBeforeSignOut: () => Promise<void> | void;
  /** Se llama tras cerrar sesión: la app quita las colecciones compartidas. */
  onSignedOut: () => void;
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
    <div className="space-y-5 px-1 py-1">
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

function FamilyControls() {
  const [id, setId] = useState(loadFontId);
  const [ready, setReady] = useState(0);
  // Al abrir la sección se cargan todas las fuentes para poder previsualizarlas.
  useEffect(() => {
    FONT_OPTIONS.forEach((f) => f.load().then(() => setReady((n) => n + 1)).catch(() => {}));
  }, []);
  const pick = (fid: string) => {
    setId(fid);
    saveFontId(fid);
    applyFontFamily(fid);
  };
  return (
    <div data-ready={ready} className="grid grid-cols-2 gap-3 px-1 py-1 md:grid-cols-3">
      {FONT_OPTIONS.map((f) => (
        <button
          key={f.id}
          onClick={() => pick(f.id)}
          className={`rounded-2xl px-4 py-3 text-left ${id === f.id ? "ring-2 ring-aqua" : "ring-1 ring-fg/10 hover:ring-fg/30"}`}
        >
          <div className="flex items-center justify-between text-xs text-slate">
            <span>{f.id === "default" ? t(f.name) : f.name}</span>
            {id === f.id && <Check size={14} className="text-aqua" />}
          </div>
          <p className="mt-1 truncate text-lg text-mist" style={f.family ? { fontFamily: f.family, fontWeight: 400 } : undefined}>
            Caesar API 0123 {"{ }"}
          </p>
        </button>
      ))}
    </div>
  );
}

function ResponseControls({ hideEmpty, onHideEmpty }: { hideEmpty: boolean; onHideEmpty: (on: boolean) => void }) {
  return (
    <div className="space-y-6 px-1 py-1">
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

function MethodControls({ extra, onExtra }: { extra: string[]; onExtra: (m: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const all = [...EXTRA_METHODS, ...extra.filter((m) => !EXTRA_METHODS.includes(m))];
  const toggle = (m: string) => onExtra(extra.includes(m) ? extra.filter((x) => x !== m) : [...extra, m]);
  const add = () => {
    const m = custom.trim().toUpperCase();
    if (/^[A-Z-]{1,20}$/.test(m) && !BASE_METHODS.includes(m) && !extra.includes(m)) onExtra([...extra, m]);
    setCustom("");
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate">{t("Siempre disponibles")}: {BASE_METHODS.join(", ")}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {all.map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-2 rounded-lg bg-deep px-3 py-2 text-sm text-silver ring-1 ring-fg/10">
            <input type="checkbox" checked={extra.includes(m)} onChange={() => toggle(m)} className="accent-[var(--t-accent)]" />
            {m}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={t("Otro método (p. ej. REPORT)")}
          className="w-56 rounded-lg bg-deep px-3 py-2 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
        />
        <button onClick={add} className="rounded-lg px-4 py-2 text-sm text-mist ring-1 ring-fg/30 hover:ring-fg/60">{t("Añadir")}</button>
      </div>
    </div>
  );
}

function EditControls({ autosave, onAutosave, extraMethods, onExtraMethods }: { autosave: boolean; onAutosave: (on: boolean) => void; extraMethods: string[]; onExtraMethods: (m: string[]) => void }) {
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 py-1">
      <section>
        <h3 className="mb-1 text-lg text-mist">{t("Métodos HTTP")}</h3>
        <p className="mb-3 text-xs text-slate">{t("Elige qué métodos aparecen en el desplegable de la petición. También puedes abrir esta pantalla con «+ Más métodos…» al final de ese desplegable.")}</p>
        <MethodControls extra={extraMethods} onExtra={onExtraMethods} />
      </section>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={autosave} onChange={(e) => onAutosave(e.target.checked)} className="mt-1 accent-[var(--t-accent)]" />
        <span>
          <span className="block text-sm text-mist">{t("Autoguardado")}</span>
          <span className="block text-xs text-slate">
            {t("Guarda solo en la colección las peticiones que ya están en ella, un instante después de dejar de editar. Los borradores nuevos se siguen guardando con Ctrl+S.")}
          </span>
        </span>
      </label>
      <section>
        <h3 className="mb-1 text-lg text-mist">{t("Copiar desde la respuesta JSON")}</h3>
        <p className="mb-3 text-xs text-slate">
          {t("Elige qué copia el icono de copiar de cada línea y Ctrl/Cmd+C sobre la línea marcada (haz clic en ella antes). Con clic derecho en cualquier línea siempre puedes elegir entre «Copiar valor» y «Copiar ruta (JSONPath)». Si seleccionas texto con el ratón, Ctrl/Cmd+C copia ese texto como siempre.")}
        </p>
        <JsonCopyControls />
      </section>
      <ShortcutsEditor />
    </div>
  );
}

function JsonCopyControls() {
  const mode = useJsonCopyMode();
  const opts: { id: JsonCopyMode; title: string; hint: string }[] = [
    { id: "value", title: t("Copiar el valor"), hint: t("Ejemplo: en «id»: 7 copia 7. En un objeto copia su JSON.") },
    { id: "path", title: t("Copiar la ruta (JSONPath)"), hint: t("Ejemplo: en «id»: 7 copia data.users[2].id. Útil para scripts y tests.") },
  ];
  return (
    <div className="space-y-2">
      {opts.map((o) => (
        <label key={o.id} className="flex cursor-pointer items-start gap-3">
          <input type="radio" name="json-copy" checked={mode === o.id} onChange={() => setJsonCopyMode(o.id)} className="mt-1 accent-[var(--t-accent)]" />
          <span>
            <span className="block text-sm text-mist">{o.title}</span>
            <span className="block text-xs text-slate">{o.hint}</span>
          </span>
        </label>
      ))}
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

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="text-lg text-mist">{t(title)}</h3>
      <p className="mb-3 text-xs text-slate">{t(hint)}</p>
      {children}
    </section>
  );
}

export default function SettingsModal({ themeId, onTheme, fonts, onFonts, hideEmpty, onHideEmpty, autosave, onAutosave, extraMethods, onExtraMethods, initialSection, sharedCount, onBeforeSignOut, onSignedOut, updates, onClose }: Props) {
  useLang();
  const { mode, setMode } = useTheme();
  const MODES: [ColorMode, string][] = [["light", "Claro"], ["dark", "Oscuro"], ["system", "Sistema"]];
  const UiSection = () => (
    <>
      <Block title="Modo de color" hint="«Sistema» sigue el modo claro u oscuro de tu ordenador y cambia solo, sin reiniciar. Al elegir un tema se recuerda uno para cada modo.">
        <div className="inline-flex rounded-[10px] bg-kelp p-1" role="radiogroup" aria-label={t("Modo de color")}>
          {MODES.map(([m, label]) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`rounded-lg px-4 py-1.5 text-sm ${mode === m ? "bg-iris text-onprimary" : "text-slate hover:text-mist"}`}>
              {t(label)}
            </button>
          ))}
        </div>
      </Block>
      <Block title="Tema" hint="Elige el estilo de la aplicación. Los colores de GET, POST, PUT, PATCH y DELETE son siempre los mismos.">
    <div className="grid grid-cols-2 gap-4 px-1 py-1 md:grid-cols-3">
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
      </Block>
      <Block title="Tipo de letra" hint="Elige la fuente de la interfaz. Todas se incluyen en la app y funcionan sin conexión. Los editores de código siguen en monoespaciada.">
        <FamilyControls />
      </Block>
      <Block title="Tamaño de letra" hint="Ajusta el tamaño de la letra en toda la aplicación o solo en la zona que quieras. Los cambios se aplican al instante.">
        <FontControls fonts={fonts} onFonts={onFonts} />
      </Block>
      <Block title="Respuesta" hint="Cómo se muestra el body de la respuesta que recibes.">
        <ResponseControls hideEmpty={hideEmpty} onHideEmpty={onHideEmpty} />
      </Block>
    </>
  );
  const [section, setSection] = useState<"ui" | "edit" | "updates" | "lang" | "cat" | "sync" | "privacy">(initialSection ?? "ui");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-8" onMouseDown={onClose}>
      <div
        className="glass flex h-full max-h-[44rem] w-full max-w-5xl flex-col rounded-2xl bg-kelp p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <h2 className="cosmic-text text-3xl font-normal tracking-[-0.02em]">{t("Ajustes")}</h2>
          <button onClick={onClose} className="text-slate hover:text-mist" title={t("Cerrar (Esc)")}>
            <X size={22} />
          </button>
        </div>
        <p className="mb-4 shrink-0 text-sm text-slate">
          {section === "ui"
            ? t("Todo lo visual de la aplicación en un solo sitio: tema, fuente, tamaños de letra y cómo se ve la respuesta. Los cambios se aplican al instante.")
            : section === "lang"
                  ? t("Elige el idioma de la interfaz. Se aplica al instante.")
                  : section === "privacy" ? t("Qué datos recoge Caesar, cómo se protege la sincronización y bajo qué licencia se distribuye.") : section === "sync" ? t("Tu cuenta, tu plan y la sincronización entre equipos. Todo se cifra en tu equipo antes de subirse; la nube nunca puede leerlo.") : section === "cat"
                    ? t("Animaciones: el gatito del logo y la red de nodos de la pantalla de carga. Desactivarlas ahorra memoria y CPU.")
                  : t("Las versiones nuevas llegan firmadas desde GitHub; Caesar comprueba la firma antes de instalarlas.")}
        </p>
        <div className="flex min-h-0 flex-1 gap-6">
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-fg/10 pr-4" aria-label={t("Ajustes")}>
          {([["ui", "Personalización de interfaz"], ["edit", "Edición y atajos"], ["lang", "Idioma"], ["cat", "Animación"], ["sync", "Cuenta y suscripción"], ["privacy", "Privacidad y licencia"], ["updates", "Actualizaciones"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`rounded-lg px-3 py-2 text-left text-sm ${
                section === id ? "bg-fg/10 text-mist ring-1 ring-aqua/60" : "text-slate hover:bg-fg/5 hover:text-silver"
              }`}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === "edit" ? (
          <EditControls autosave={autosave} onAutosave={onAutosave} extraMethods={extraMethods} onExtraMethods={onExtraMethods} />
        ) : section === "privacy" ? (<SettingsPrivacy version={updates.version} />) : section === "sync" ? (<SyncSettings sharedCount={sharedCount} onBeforeSignOut={onBeforeSignOut} onSignedOut={onSignedOut} />) : section === "cat" ? (
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
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {UiSection()}
        </div>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}
