import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, Copy, Download, X } from "lucide-react";
import { t } from "../lib/i18n";
import { saveTextFile } from "../api";
import { LANGS, fromArgs, langById, type SnippetInput } from "../lib/codegen";
import type { ArgsLike } from "../lib/codegen/input";
import { highlight, type TokenKind } from "../lib/codegen/highlight";
import { loadPrefs, savePrefs, type CodegenPrefs } from "../lib/codegen/store";

interface Props {
  /** Argumentos de ejecución de la petición actual; `resolve=false` deja las {{variables}} sin sustituir. */
  getArgs: (resolve: boolean) => ArgsLike;
  onClose: () => void;
  onNotice: (kind: "ok" | "err", text: string) => void;
}

const COLORS: Record<TokenKind, string> = {
  str: "text-leaf",
  num: "text-saffron",
  com: "italic text-slate",
  kw: "text-iris",
  flag: "text-aqua",
  plain: "",
};

const MIN_W = 300;
const field = "rounded-md bg-kelp px-2 py-1 text-xs outline-none ring-1 ring-fg/10 focus:ring-aqua";

export default function CodeSnippetPanel({ getArgs, onClose, onNotice }: Props) {
  const [prefs, setPrefs] = useState<CodegenPrefs>(loadPrefs);
  const [copied, setCopied] = useState(false);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const set = (p: Partial<CodegenPrefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      savePrefs(next);
      return next;
    });
  const lang = langById(prefs.lang);

  const args = getArgs(prefs.resolveVars);
  const input: SnippetInput | null = args.url.trim() ? fromArgs(args) : null;
  const code = useMemo(() => (input ? lang.gen(input, prefs.opts) : ""), [JSON.stringify(input), lang.id, prefs.opts]);
  const tokens = useMemo(() => highlight(code, lang.hl), [code, lang.hl]);
  const lines = code ? code.split("\n").length : 0;

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      onNotice("err", t("No se pudo copiar al portapapeles."));
    }
  };

  const save = async () => {
    try {
      const saved = await saveTextFile(`request.${lang.ext}`, code, lang.ext);
      if (saved) onNotice("ok", t("Código guardado: {0}", saved));
    } catch (e) {
      onNotice("err", String(e));
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, w: prefs.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const max = Math.max(MIN_W, window.innerWidth * 0.6);
    set({ width: Math.round(Math.min(max, Math.max(MIN_W, drag.current.w + (drag.current.x - e.clientX)))) });
  };

  return (
    <aside
      style={{ width: `min(${prefs.width}px, 100vw)` }}
      className="relative flex shrink-0 flex-col border-l border-fg/10 bg-deep max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:shadow-2xl"
      aria-label={t("Generar código")}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={() => (drag.current = null)}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-aqua/30 max-md:hidden"
        role="separator"
        aria-orientation="vertical"
      />
      <div className="flex items-center gap-2 border-b border-fg/10 px-3 py-2">
        <Code2 size={16} className="text-aqua" />
        <h2 className="flex-1 text-sm font-semibold text-mist">{t("Generar código")}</h2>
        <button onClick={onClose} className="text-silver hover:text-aqua" title={t("Cerrar")} aria-label={t("Cerrar")}>
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-2 border-b border-fg/10 px-3 py-2 text-xs text-silver">
        <select value={lang.id} onChange={(e) => set({ lang: e.target.value })} className={field} aria-label={t("Lenguaje")}>
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {lang.opts.includes("indent") && (
            <label className="flex items-center gap-1">
              {t("Sangría")}
              <select value={prefs.opts.indent} onChange={(e) => set({ opts: { ...prefs.opts, indent: Number(e.target.value) } })} className={field}>
                <option value={2}>{t("2 espacios")}</option>
                <option value={4}>{t("4 espacios")}</option>
                <option value={0}>{t("Tabulador")}</option>
              </select>
            </label>
          )}
          {lang.opts.includes("timeout") && (
            <label className="flex items-center gap-1" title={t("0 = sin límite")}>
              {t("Timeout (s)")}
              <input
                type="number"
                min={0}
                value={prefs.opts.timeout}
                onChange={(e) => set({ opts: { ...prefs.opts, timeout: Math.max(0, Number(e.target.value) || 0) } })}
                className={`${field} w-16`}
              />
            </label>
          )}
          {lang.opts.includes("follow") && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={prefs.opts.follow} onChange={(e) => set({ opts: { ...prefs.opts, follow: e.target.checked } })} className="accent-[var(--t-accent)]" />
              {t("Seguir redirecciones")}
            </label>
          )}
          <label className="flex items-center gap-1" title={t("Desmarcado: el código conserva las {{variables}} sin sustituir.")}>
            <input type="checkbox" checked={prefs.resolveVars} onChange={(e) => set({ resolveVars: e.target.checked })} className="accent-[var(--t-accent)]" />
            {t("Usar valores de variables")}
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={prefs.lineNumbers} onChange={(e) => set({ lineNumbers: e.target.checked })} className="accent-[var(--t-accent)]" />
            {t("Números de línea")}
          </label>
        </div>
      </div>

      {input ? (
        <>
          <div className="flex items-center gap-2 border-b border-fg/10 px-3 py-1.5">
            <button onClick={copy} className={`flex items-center gap-1 text-xs ${copied ? "text-leaf" : "text-silver hover:text-aqua"}`}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t("Copiado") : t("Copiar")}
            </button>
            <button onClick={save} className="flex items-center gap-1 text-xs text-silver hover:text-aqua" title={t("Guardar como archivo")}>
              <Download size={13} /> {t("Guardar como archivo")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-relaxed">
            <div className="flex min-w-max p-3">
              {prefs.lineNumbers && (
                <pre aria-hidden className="mr-3 select-none text-right text-slate/70">{Array.from({ length: lines }, (_, n) => n + 1).join("\n")}</pre>
              )}
              <pre className="text-mist" data-testid="code">
                {tokens.map((tk, n) => (tk.k === "plain" ? tk.s : <span key={n} className={COLORS[tk.k]}>{tk.s}</span>))}
              </pre>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate">
          <Code2 size={28} className="text-slate/60" />
          {t("Escribe una URL para generar código")}
        </div>
      )}
    </aside>
  );
}
