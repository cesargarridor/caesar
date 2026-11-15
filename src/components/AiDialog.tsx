import { useEffect, useState } from "react";
import { KeyRound, Sparkles, X } from "lucide-react";
import { aiChat, aiClearKey, aiSetKey, aiStatus, type AiProvider } from "../api";
import type { RequestState, ResponseData } from "../types";
import { t } from "../lib/i18n";

const DEFAULT_MODEL: Record<AiProvider, string> = { openai: "gpt-4o-mini", anthropic: "claude-haiku-5-5" };
const LS = { provider: "caesar.ai.provider", model: (p: AiProvider) => `caesar.ai.model.${p}` };
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const btn = "rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50 bg-[var(--t-iris)]";
const ghost = "rounded-xl px-3 py-2 text-xs font-medium text-mist ring-1 ring-fg/30 hover:ring-fg/60 disabled:opacity-50";
const input = "w-full rounded-xl bg-deep px-3 py-2 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua";

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(recortado)` : s);

/** Resumen de la petición para la IA. Las cabeceras de autorización y las claves se ocultan antes de salir del equipo. */
function describeRequest(req: RequestState): string {
  const hdr = req.headers
    .filter((h) => h.enabled && h.key)
    .map((h) => `${h.key}: ${/auth|token|key|secret|cookie/i.test(h.key) ? "***" : h.value}`)
    .join("\n");
  const body = req.body.mode === "none" ? "" : cut(req.body.mode === "graphql" ? req.body.gqlQuery ?? "" : req.body.raw, 8000);
  return `${req.method} ${req.url}\n${hdr ? `Cabeceras:\n${hdr}\n` : ""}${body ? `Cuerpo:\n${body}\n` : ""}`;
}

interface Props {
  req: RequestState;
  response: ResponseData | null;
  onApplyTests: (code: string) => void;
  onClose: () => void;
}

/** Asistente de IA: la interfaz es gratis y usas tu propia clave (BYOK). Los datos van de tu equipo al proveedor, sin pasar por Caesar. */
export default function AiDialog({ req, response, onApplyTests, onClose }: Props) {
  const [provider, setProvider] = useState<AiProvider>(() => (read(LS.provider, "openai") === "anthropic" ? "anthropic" : "openai"));
  const [model, setModel] = useState(() => read(LS.model(provider), DEFAULT_MODEL[provider]));
  const [has, setHas] = useState<{ openai: boolean; anthropic: boolean }>({ openai: false, anthropic: false });
  const [key, setKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [out, setOut] = useState<{ text: string; tests: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { aiStatus().then(setHas).catch(() => {}); }, []);
  useEffect(() => { setModel(read(LS.model(provider), DEFAULT_MODEL[provider])); write(LS.provider, provider); }, [provider]);
  const msg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));

  const saveKey = async () => {
    setErr(null);
    try { await aiSetKey(provider, key); setKey(""); setHas(await aiStatus()); } catch (e) { setErr(msg(e)); }
  };
  const ask = async (task: string, tests = false) => {
    setBusy(true); setErr(null); setOut(null);
    write(LS.model(provider), model);
    const ctx = `Petición:\n${describeRequest(req)}${response ? `\nRespuesta (${response.status} ${response.statusText}):\n${cut(response.body, 12000)}` : ""}`;
    try {
      const text = await aiChat(provider, model, "Eres un asistente para desarrolladores que prueban APIs HTTP. Responde en español, breve y concreto. Si devuelves código, solo el código.", `${task}\n\n${ctx}`);
      setOut({ text, tests });
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const ready = has[provider];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={t("Asistente de IA")}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl bg-kelp p-5 ring-1 ring-fg/15">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-medium text-mist"><Sparkles size={16} /> {t("Asistente de IA")}</h2>
          <button onClick={onClose} className="text-slate hover:text-mist" aria-label={t("Cerrar")}><X size={18} /></button>
        </div>
        <p className="text-xs text-slate">{t("Gratis con tu propia clave: se guarda en el llavero de tu sistema y las peticiones van directo de tu equipo al proveedor, sin pasar por Caesar. Solo se envía lo que pides con cada botón (las cabeceras de autorización se ocultan).")}</p>

        <div className="flex flex-wrap gap-2">
          {(["openai", "anthropic"] as const).map((p) => (
            <button key={p} onClick={() => setProvider(p)} className={`${ghost} ${provider === p ? "ring-aqua text-aqua" : ""}`}>{p === "openai" ? "OpenAI" : "Anthropic"}{has[p] ? " ✓" : ""}</button>
          ))}
          <input className={`${input} max-w-[14rem]`} value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("Modelo")} spellCheck={false} />
        </div>

        {!ready ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
            <input className={`${input} font-mono`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("Pega tu clave de API")} />
            <button type="submit" className={btn} disabled={!key.trim()}><KeyRound size={14} className="mr-1 inline" />{t("Guardar")}</button>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button className={ghost} disabled={busy || !response} title={response ? undefined : t("Envía la petición primero")} onClick={() => ask("Explica esta respuesta: qué significa, si hay algo raro o un error y cómo arreglarlo.")}>{t("Explicar la respuesta")}</button>
              <button className={ghost} disabled={busy} onClick={() => ask("Escribe tests para esta petición con la sintaxis de Postman: pm.test(\"nombre\", () => { pm.expect(...)... }). Comprueba código de estado, cabeceras y campos clave del cuerpo. Devuelve solo el código.", true)}>{t("Generar tests")}</button>
              <button className={ghost} disabled={busy} onClick={() => ask("Sugiere un cuerpo JSON de ejemplo realista para esta petición. Devuelve solo el JSON.")}>{t("Sugerir un cuerpo")}</button>
              <button className="ml-auto text-xs text-slate underline hover:text-red-400" onClick={() => { aiClearKey(provider).then(() => aiStatus().then(setHas)).catch((e) => setErr(msg(e))); }}>{t("Quitar mi clave")}</button>
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) void ask(prompt.trim()); }}>
              <input className={input} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("Pregunta lo que quieras sobre esta petición…")} />
              <button type="submit" className={btn} disabled={busy || !prompt.trim()}>{t("Preguntar")}</button>
            </form>
          </>
        )}

        {busy && <p className="text-xs text-slate" role="status">{t("Pensando…")}</p>}
        {err && <p className="text-xs text-red-400">{err}</p>}
        {out && (
          <div className="space-y-2">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-deep p-3 text-xs text-mist ring-1 ring-fg/10">{out.text}</pre>
            <div className="flex gap-2">
              <button className={ghost} onClick={() => { navigator.clipboard.writeText(out.text).catch(() => {}); }}>{t("Copiar")}</button>
              {out.tests && <button className={ghost} onClick={() => { onApplyTests(out.text.replace(/^```\w*\n?|```\s*$/g, "").trim()); onClose(); }}>{t("Usar como tests de esta petición")}</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
