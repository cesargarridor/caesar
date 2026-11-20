import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardPaste, Code2, Download, FileUp, Link2, Loader2, RefreshCw, Save, Send, Settings2, Trash2, WandSparkles, X } from "lucide-react";
import KVEditor from "./KVEditor";
import AuthEditor from "./AuthEditor";
import VarInput from "./VarInput";
import GraphqlEditor from "./GraphqlEditor";
import JsonEditor from "./JsonEditor";
import KindSelect from "./KindSelect";
import type { AuthData, KV, RequestKind, RequestState, Settings } from "../types";
import { applyUrlEdit, buildUrl } from "../lib/url";
import { executeRequest, pickTextFile } from "../api";
import { buildExecuteArgs, substitute } from "../lib/request";
import { signRequest, SIGNED_TYPES } from "../lib/authSign";
import { INTROSPECTION_QUERY, countTypes, parseAnySchema, parseIntrospection, userTypes, type GqlSchema } from "../lib/graphqlSchema";
import { clearCachedSchema, loadCachedSchema, saveCachedSchema } from "../lib/graphqlCache";
import { t } from "../lib/i18n";

interface Props {
  tabId: string;
  req: RequestState;
  patch: (p: Partial<RequestState>) => void;
  onKind?: (k: RequestKind) => void;
  inherited?: AuthData | null;
  vars: KV[];
  sending: boolean;
  onSend: () => void;
  onSave: () => void;
  onCodegen?: () => void;
  codegenOpen?: boolean;
  onShareLink?: () => void;
  flash?: "save" | "curl" | "link" | null;
  onAi?: () => void;
}

type Sub = "query" | "schema" | "auth" | "headers" | "scripts" | "settings";

const COMMON_HEADERS = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control", "Content-Type",
  "Cookie", "Origin", "Referer", "User-Agent", "X-Requested-With", "X-API-Key", "Apollo-Require-Preflight",
];

const TESTS_EXAMPLE = `var jsonData = JSON.parse(responseBody);
pm.globals.set("user_id", jsonData.data.user.id);`;

const ghost =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-slate hover:bg-fg/10 hover:text-mist";
const done =
  "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.025em] text-leaf ring-1 ring-leaf/70 bg-leaf/10";
const icon = "flex items-center rounded-[10px] px-3 py-2 text-slate hover:bg-fg/10 hover:text-mist";
const box = "w-24 rounded-md border border-fg/10 bg-kelp px-2 py-1.5 text-sm focus:outline-none focus:border-aqua";
const btn = "flex items-center gap-1.5 rounded-lg border border-fg/15 bg-kelp px-3 py-1.5 text-xs text-silver hover:border-aqua hover:text-aqua disabled:opacity-50";

function Toggle({ on, onChange, label, hint, warn }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; warn?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-fg/5"
    >
      <span className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? "bg-aqua" : "bg-fg/20"}`}>
        <span className={`h-3 w-3 rounded-full bg-white transition-transform ${on ? "translate-x-3" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-mist">{label}</span>
        {hint && <span className={`block text-xs ${warn ? "text-lav" : "text-slate"}`}>{hint}</span>}
      </span>
    </button>
  );
}

/** Barra superior + pestañas de una petición GraphQL (Query, Schema, Authorization, Headers, Scripts, Settings), calcado de Postman. */
export default function GraphqlPanel({
  req, patch, onKind, inherited, vars, sending, onSend, onSave, onCodegen, codegenOpen, onShareLink, flash, onAi,
}: Props) {
  const [sub, setSub] = useState<Sub>("query");
  const [netOpen, setNetOpen] = useState(false);
  const netRef = useRef<HTMLDivElement>(null);
  const fullUrl = buildUrl(req.url, req.params);

  useEffect(() => {
    if (!netOpen) return;
    const close = (e: MouseEvent) => { if (!netRef.current?.contains(e.target as Node)) setNetOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setNetOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [netOpen]);

  // ── Estado compartido del esquema (entre pestañas Query y Schema) ──
  const [schema, setSchema] = useState<GqlSchema | null>(null);
  const [at, setAt] = useState(0);
  const [source, setSource] = useState<"introspection" | "file" | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const token = useRef(0);
  const cacheUrl = useMemo(() => substitute(fullUrl, vars).trim(), [fullUrl, vars]);

  useEffect(() => {
    token.current++;
    setLoading(false);
    setError(null);
    const c = loadCachedSchema(cacheUrl);
    if (c) {
      setSchema(c.schema);
      setAt(c.at);
      setSource(c.source);
      setFileName(c.fileName);
    }
  }, [cacheUrl]);

  const introspect = async () => {
    if (!cacheUrl) {
      setError(t("Escribe primero la URL del endpoint GraphQL arriba para poder cargar el esquema."));
      return;
    }
    const my = ++token.current;
    setLoading(true);
    setError(null);
    try {
      const auth = inherited ?? req.auth;
      const base = buildExecuteArgs(
        { ...req, method: "POST", auth, body: { mode: "graphql", raw: "", formdata: [], urlencoded: [], gqlQuery: INTROSPECTION_QUERY, gqlVars: "", gqlOp: "" } },
        vars,
      );
      const args = SIGNED_TYPES.includes(auth.type) ? await signRequest(auth, base, vars, executeRequest) : base;
      const res = await executeRequest(args);
      if (my !== token.current) return;
      if (res.truncated) throw new Error(t("La respuesta del esquema es demasiado grande."));
      let parsed: GqlSchema;
      try {
        parsed = parseIntrospection(res.body);
      } catch (e) {
        const m = (e as Error).message;
        throw new Error(res.status >= 400 ? t("El servidor respondió {0} {1}. {2}", res.status, res.statusText, m) : m);
      }
      const c = saveCachedSchema(cacheUrl, parsed, "introspection");
      setSchema(c.schema);
      setAt(c.at);
      setSource("introspection");
      setFileName(undefined);
    } catch (e) {
      if (my !== token.current) return;
      const m = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
      setError(t("No se pudo cargar el esquema: {0}", m));
    } finally {
      if (my === token.current) setLoading(false);
    }
  };

  const importFile = async () => {
    setError(null);
    try {
      const f = await pickTextFile();
      if (!f) return;
      const parsed = parseAnySchema(f.content);
      const c = saveCachedSchema(cacheUrl || "__local__", parsed, "file", f.name);
      setSchema(c.schema);
      setAt(c.at);
      setSource("file");
      setFileName(f.name);
    } catch (e) {
      const m = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
      setError(t("No se pudo importar el esquema: {0}", m));
    }
  };

  const importText = (text: string) => {
    setError(null);
    try {
      const parsed = parseAnySchema(text);
      const c = saveCachedSchema(cacheUrl || "__local__", parsed, "file", "SDL");
      setSchema(c.schema);
      setAt(c.at);
      setSource("file");
      setFileName("SDL");
      setShowPaste(false);
      setPasteText("");
    } catch (e) {
      const m = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
      setError(t("No se pudo importar el esquema: {0}", m));
    }
  };

  const forget = () => {
    clearCachedSchema(cacheUrl);
    setSchema(null);
    setAt(0);
    setSource(undefined);
    setFileName(undefined);
  };

  const count = (l: { enabled: boolean; key: string }[]) => l.filter((x) => x.enabled && x.key).length;
  const settings: Settings = req.settings;
  const setSettings = (s: Settings) => patch({ settings: s });

  const tabs: { id: Sub; label: string; badge?: string }[] = [
    { id: "query", label: "Query", badge: req.body.gqlQuery?.trim() ? "•" : undefined },
    { id: "schema", label: "Schema", badge: schema ? String(countTypes(schema)) : undefined },
    { id: "auth", label: "Authorization", badge: req.auth.type !== "none" ? "•" : undefined },
    { id: "headers", label: "Headers", badge: count(req.headers) ? String(count(req.headers)) : undefined },
    { id: "scripts", label: "Scripts", badge: req.tests?.trim() ? "•" : undefined },
    { id: "settings", label: "Settings" },
  ];

  const externalSchema = {
    schema,
    at,
    source,
    fileName,
    loading,
    error,
    onIntrospect: introspect,
    onImportFile: importFile,
    onImportText: importText,
    onForget: forget,
  };

  return (
    <>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex gap-2">
          {onKind ? (
            <KindSelect kind="gql" onChange={onKind} />
          ) : (
            <span
              title={t("Petición GraphQL")}
              className="flex items-center rounded-[10px] bg-kelp px-4 py-2 text-sm font-semibold text-[var(--t-m-gql)] ring-1 ring-fg/10"
            >
              GraphQL
            </span>
          )}
          <VarInput
            id="caesar-url"
            value={fullUrl}
            onChange={(e) => patch(applyUrlEdit(e.target.value, req.params))}
            onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && onSend()}
            placeholder="https://api.ejemplo.com/graphql"
            aria-label={t("URL del endpoint GraphQL")}
            spellCheck={false}
            className="min-w-[12rem] flex-1 rounded-[10px] bg-kelp px-5 py-2 text-sm outline-none ring-1 ring-fg/10 focus:ring-aqua"
          />
          {onAi && (
            <button
              onClick={onAi}
              className={icon}
              title={t("Asistente de IA (con tu propia clave)")}
              aria-label={t("Asistente de IA")}
            >
              <WandSparkles size={14} />
            </button>
          )}
          {onCodegen && (
            <button onClick={onCodegen} className={codegenOpen ? done : icon} title={t("Generar código (</>)")} aria-label={t("Generar código")} aria-pressed={!!codegenOpen}>
              <Code2 size={14} />
            </button>
          )}
          {onShareLink && (
            <button onClick={onShareLink} className={flash === "link" ? `${icon} !text-leaf !ring-leaf/70 bg-leaf/10` : icon} title={t("Copiar enlace para compartir")} aria-label={t("Copiar enlace")}>
              {flash === "link" ? <Check size={14} /> : <Link2 size={14} />}
            </button>
          )}
          <button onClick={onSave} className={flash === "save" ? done : ghost} title={t("Guardar en la colección (Ctrl+S)")}>
            {flash === "save" ? <Check size={14} /> : <Save size={14} />} {flash === "save" ? t("Guardado") : t("Guardar")}
          </button>
          <div ref={netRef} className="relative flex">
            <button
              onClick={() => setNetOpen((o) => !o)}
              className={`${icon} ${!settings.verifySsl || !settings.followRedirects ? "!text-aqua" : ""}`}
              title={t("Opciones de red")}
              aria-label={t("Opciones de red")}
              aria-expanded={netOpen}
            >
              <Settings2 size={14} />
            </button>
            {netOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl bg-kelp p-2 shadow-xl ring-1 ring-fg/10">
                <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate">{t("Opciones de red")}</p>
                <Toggle
                  on={!settings.verifySsl}
                  onChange={(v) => setSettings({ ...settings, verifySsl: !v })}
                  label={t("Ignorar SSL")}
                  hint={settings.verifySsl ? t("Acepta certificados autofirmados (localhost)") : t("⚠ desactivado: solo para pruebas")}
                  warn={!settings.verifySsl}
                />
                <Toggle
                  on={settings.followRedirects}
                  onChange={(v) => setSettings({ ...settings, followRedirects: v })}
                  label={t("Seguir redirecciones")}
                  hint={settings.followRedirects ? undefined : t("Verás el 301/302 original")}
                />
              </div>
            )}
          </div>
          <button onClick={onSend} disabled={sending} className="btn-aurora flex items-center gap-2 px-6 py-2 font-semibold disabled:opacity-50">
            <Send size={14} /> {sending ? t("Enviando…") : t("Query")}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div role="tablist" className="flex overflow-x-auto border-b border-fg/10 px-3">
          {tabs.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={sub === x.id}
              onClick={() => setSub(x.id)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                sub === x.id ? "border-aqua font-semibold text-aqua" : "border-transparent text-slate hover:text-silver"
              }`}
            >
              {x.label}
              {x.badge && <span className="text-xs font-bold text-aqua">{x.badge}</span>}
            </button>
          ))}
        </div>

        <div className="flex min-h-[12rem] flex-1 flex-col overflow-y-auto p-3">
          {sub === "query" && (
            <GraphqlEditor
              body={{ ...req.body, mode: "graphql" }}
              onChange={(body) => patch({ body: { ...body, mode: "graphql" } })}
              req={req}
              vars={vars}
              inherited={inherited}
              externalSchema={externalSchema}
            />
          )}

          {sub === "schema" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-kelp p-4 ring-1 ring-fg/10">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-mist">{t("Esquema GraphQL")}</h3>
                  <p className="text-xs text-slate">
                    {schema
                      ? source === "file"
                        ? t("Esquema importado desde archivo ({0}) · {1} tipos · {2}", fileName || "SDL", countTypes(schema), new Date(at).toLocaleString())
                        : t("Esquema obtenido por introspección · {0} tipos · {1}", countTypes(schema), new Date(at).toLocaleString())
                      : t("Obtén el esquema automáticamente desde el servidor (introspección) o importa un archivo .graphql, .gql o .json.")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={introspect} disabled={loading} className={`${btn} border-aqua/50 text-aqua`}>
                    {loading ? <Loader2 size={14} className="animate-spin" /> : schema ? <RefreshCw size={14} /> : <Download size={14} />}
                    {loading ? t("Cargando…") : t("Usar introspección")}
                  </button>
                  <button onClick={importFile} className={btn}>
                    <FileUp size={14} /> {t("Importar archivo (.graphql / .gql / .json)")}
                  </button>
                  <button onClick={() => setShowPaste((o) => !o)} className={`${btn} ${showPaste ? "border-aqua text-aqua" : ""}`}>
                    <ClipboardPaste size={14} /> {t("Pegar SDL / JSON")}
                  </button>
                  {schema && (
                    <button onClick={forget} className={`${btn} hover:border-rose hover:text-rose`}>
                      <Trash2 size={14} /> {t("Eliminar esquema")}
                    </button>
                  )}
                </div>
              </div>

              {error && <p className="text-xs text-rose">{error}</p>}

              {showPaste && (
                <div className="flex flex-col gap-2 rounded-xl bg-kelp p-4 ring-1 ring-fg/15">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-silver">{t("Pegar esquema GraphQL (SDL o JSON de introspección)")}</span>
                    <button onClick={() => setShowPaste(false)} className="text-slate hover:text-mist"><X size={14} /></button>
                  </div>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={"type Query {\n  user(id: ID!): User\n  users: [User!]!\n}\n\ntype User {\n  id: ID!\n  name: String!\n  email: String\n}"}
                    spellCheck={false}
                    className="h-44 w-full resize-y rounded-lg bg-deep p-3 font-mono text-xs text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowPaste(false)} className={btn}>{t("Cancelar")}</button>
                    <button onClick={() => importText(pasteText)} disabled={!pasteText.trim()} className={`${btn} border-aqua/50 text-aqua`}>
                      {t("Importar esquema")}
                    </button>
                  </div>
                </div>
              )}

              {schema && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-kelp p-3 ring-1 ring-fg/10">
                    <p className="text-xs font-semibold text-aqua">Query ({schema.queryType ?? "—"})</p>
                    <p className="mt-1 text-xs text-slate">
                      {t("{0} campos raíz", (schema.queryType && schema.types[schema.queryType]?.fields.length) || 0)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-kelp p-3 ring-1 ring-fg/10">
                    <p className="text-xs font-semibold text-aqua">Mutation ({schema.mutationType ?? "—"})</p>
                    <p className="mt-1 text-xs text-slate">
                      {t("{0} mutaciones", (schema.mutationType && schema.types[schema.mutationType]?.fields.length) || 0)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-kelp p-3 ring-1 ring-fg/10">
                    <p className="text-xs font-semibold text-aqua">Subscription ({schema.subscriptionType ?? "—"})</p>
                    <p className="mt-1 text-xs text-slate">
                      {t("{0} suscripciones", (schema.subscriptionType && schema.types[schema.subscriptionType]?.fields.length) || 0)}
                    </p>
                  </div>
                </div>
              )}

              {schema && (
                <div className="rounded-xl bg-kelp p-3 ring-1 ring-fg/10">
                  <p className="mb-2 text-xs font-semibold text-silver">{t("Tipos del esquema ({0})", countTypes(schema))}</p>
                  <div className="grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                    {userTypes(schema).map((ty) => (
                      <div key={ty.name} className="flex items-center justify-between rounded-lg bg-deep px-2.5 py-1.5 text-xs">
                        <span className="truncate font-mono text-mist" title={ty.description || ty.name}>{ty.name}</span>
                        <span className="ml-2 shrink-0 rounded bg-fg/10 px-1.5 py-0.5 text-[10px] text-slate">{ty.kind.toLowerCase().replace("_", " ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {sub === "auth" && <AuthEditor auth={req.auth} onChange={(auth) => patch({ auth })} inherited={inherited} />}

          {sub === "headers" && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate">{t("Headers")}</p>
                <KVEditor rows={req.headers} onChange={(headers) => patch({ headers })} suggestions={COMMON_HEADERS} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate">{t("Query Params (URL)")}</p>
                <KVEditor rows={req.params} onChange={(params) => patch({ params })} keyPlaceholder="Query param" />
              </div>
            </div>
          )}

          {sub === "scripts" && (
            <div className="flex h-full min-h-64 flex-col gap-2">
              <p className="text-xs text-slate">
                {t("Se ejecuta tras recibir la respuesta:")} <code className="text-silver">pm.environment.set</code>,{" "}
                <code className="text-silver">pm.collectionVariables.set</code>, <code className="text-silver">pm.globals.set</code>,{" "}
                <code className="text-silver">pm.response.json()</code>,{" "}
                <code className="text-silver">pm.test / pm.expect</code>. {t("Las variables se guardan en el panel Variables y se usan como")}{" "}
                <code className="text-silver">{t("{{nombre}}")}</code>.
              </p>
              <JsonEditor
                value={req.tests ?? ""}
                onChange={(tests) => patch({ tests })}
                highlight={false}
                autoClose={`{}[]()""''\`\``}
                placeholder={TESTS_EXAMPLE}
                className="min-h-48 flex-1"
              />
              {!req.tests?.trim() && (
                <button onClick={() => patch({ tests: TESTS_EXAMPLE })} className="self-start text-xs text-silver hover:text-mist">
                  {t("Insertar ejemplo: guardar un campo de data en una variable")}
                </button>
              )}
            </div>
          )}

          {sub === "settings" && (
            <div className="space-y-3 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                {t("Timeout de la petición (segundos)")}
                <input
                  type="number"
                  min={0}
                  max={3600}
                  className={box}
                  value={settings.timeoutSecs}
                  onChange={(e) => setSettings({ ...settings, timeoutSecs: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-[var(--t-accent)]"
                  checked={settings.verifySsl}
                  onChange={(e) => setSettings({ ...settings, verifySsl: e.target.checked })}
                />
                {t("Verificar certificado SSL")}
                {!settings.verifySsl && <span className="text-xs text-lav">{t("⚠ desactivado: solo para pruebas")}</span>}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-[var(--t-accent)]"
                  checked={settings.followRedirects}
                  onChange={(e) => setSettings({ ...settings, followRedirects: e.target.checked })}
                />
                {t("Seguir redirecciones HTTP")}
              </label>
              <label className="flex flex-wrap items-center gap-2">
                {t("Versión HTTP")}
                <select
                  value={settings.httpVersion ?? "auto"}
                  onChange={(e) => setSettings({ ...settings, httpVersion: e.target.value as "auto" | "1.1" | "2" })}
                  className={box.replace("w-24", "w-36")}
                >
                  <option value="auto">{t("Automática")}</option>
                  <option value="1.1">HTTP/1.1</option>
                  <option value="2">HTTP/2</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
