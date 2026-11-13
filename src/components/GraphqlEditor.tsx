import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Download, Loader2, Minimize2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import JsonEditor from "./JsonEditor";
import GraphqlSchemaPanel from "./GraphqlSchemaPanel";
import type { AuthData, BodyData, KV, RequestState } from "../types";
import { t } from "../lib/i18n";
import { executeRequest } from "../api";
import { buildExecuteArgs, substitute } from "../lib/request";
import { buildUrl } from "../lib/url";
import { signRequest, SIGNED_TYPES } from "../lib/authSign";
import { effectiveOp, extractVarDefs, gqlVarsError, listOperations } from "../lib/graphql";
import { formatGql } from "../lib/graphqlFormat";
import { gqlSyntaxIssue, lex } from "../lib/graphqlLex";
import { completionAt, type GqlCompletion, type GqlCompletionResult } from "../lib/graphqlComplete";
import {
  INTROSPECTION_QUERY, countTypes, fieldSnippet, operationSnippet, parseIntrospection, varsTemplate,
  type GqlField, type GqlSchema, type RootKind,
} from "../lib/graphqlSchema";
import { clearCachedSchema, loadCachedSchema, saveCachedSchema } from "../lib/graphqlCache";

interface Props {
  body: BodyData;
  onChange: (b: BodyData) => void;
  req: RequestState;
  vars: KV[];
  inherited?: AuthData | null;
  /** Cambia el método HTTP (GraphQL va por POST). */
  onMethod?: (m: string) => void;
}

const EXAMPLE = "query GetUsers {\n  users {\n    id\n    name\n  }\n}";
const MAX_PAINT = 300_000;
const btn = "flex items-center gap-1 rounded-md border border-fg/10 px-2 py-1 text-xs hover:border-aqua hover:text-aqua disabled:opacity-50";
const KEYWORDS = new Set(["query", "mutation", "subscription", "fragment", "on", "schema", "type", "input", "enum", "interface", "union", "scalar", "directive", "extend", "implements"]);

/** Resaltado GraphQL con los colores del body: palabras clave, argumentos, $variables, strings, comentarios. */
function paintGql(text: string): ReactNode[] {
  const toks = lex(text);
  const out: ReactNode[] = [];
  toks.forEach((tk, i) => {
    let color: string | undefined;
    let style: React.CSSProperties | undefined;
    switch (tk.kind) {
      case "string": color = "var(--t-b-str)"; break;
      case "number": color = "var(--t-b-num)"; break;
      case "var": case "tpl": color = "var(--t-hl)"; break;
      case "directive": color = "var(--t-b-nul)"; break;
      case "comment": color = "var(--t-b-punc)"; style = { fontStyle: "italic", opacity: 0.75 }; break;
      case "punct": case "spread": color = "var(--t-b-punc)"; break;
      case "name": {
        if (tk.text === "true" || tk.text === "false" || tk.text === "null") color = "var(--t-b-bool)";
        else if (KEYWORDS.has(tk.text)) color = "var(--t-b-bool)";
        else {
          let j = i + 1;
          while (toks[j] && toks[j].kind === "ws") j++;
          if (toks[j]?.text === ":") color = "var(--t-b-key)"; // alias o argumento
        }
        break;
      }
    }
    out.push(color || style ? <span key={i} style={{ color, ...style }}>{tk.text}</span> : tk.text);
  });
  return out;
}

export default function GraphqlEditor({ body, onChange, req, vars, inherited, onMethod }: Props) {
  const query = body.gqlQuery ?? "";
  const gqlVars = body.gqlVars ?? "";
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // ── esquema ──
  const [schema, setSchema] = useState<GqlSchema | null>(null);
  const [at, setAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const token = useRef(0);
  const cacheUrl = useMemo(() => substitute(buildUrl(req.url, req.params), vars).trim(), [req.url, req.params, vars]);

  // Al cambiar de URL se recupera el esquema cacheado (si lo hay) sin tocar la red.
  useEffect(() => {
    token.current++;
    setLoading(false);
    setError(null);
    const c = loadCachedSchema(cacheUrl);
    setSchema(c?.schema ?? null);
    setAt(c?.at ?? 0);
    if (!c) setPanel(false);
  }, [cacheUrl]);

  const loadSchema = async () => {
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
      const c = saveCachedSchema(cacheUrl, parsed);
      setSchema(c.schema);
      setAt(c.at);
    } catch (e) {
      if (my !== token.current) return;
      const m = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
      setError(t("No se pudo cargar el esquema: {0}", m));
    } finally {
      if (my === token.current) setLoading(false);
    }
  };

  const forget = () => {
    clearCachedSchema(cacheUrl);
    setSchema(null);
    setAt(0);
    setPanel(false);
  };

  // ── operaciones y variables ──
  const ops = useMemo(() => listOperations(query), [query]);
  const chosenOp = effectiveOp(ops, body.gqlOp) ?? "";
  const defs = useMemo(() => extractVarDefs(query, chosenOp || null), [query, chosenOp]);
  const issue = useMemo(() => (query.length <= MAX_PAINT ? gqlSyntaxIssue(query) : null), [query]);
  const varsErr = gqlVarsError(gqlVars);

  /** Aplica una query nueva; si las variables están vacías y la query declara $vars, genera la plantilla. */
  const setQuery = (q: string, autoVars = false) => {
    const next: BodyData = { ...body, gqlQuery: q };
    if (autoVars && !gqlVars.trim()) {
      const d = extractVarDefs(q, null);
      if (d.length) next.gqlVars = varsTemplate(d, schema);
    }
    onChange(next);
  };

  const beautifyQuery = () => setQuery(formatGql(query), true);
  const genVars = () => onChange({ ...body, gqlVars: varsTemplate(defs, schema, gqlVars) });
  const reformatVars = (indent: number | undefined) => {
    try {
      onChange({ ...body, gqlVars: JSON.stringify(JSON.parse(gqlVars), null, indent) });
    } catch {
      /* el error ya se muestra bajo el editor */
    }
  };

  const insertOp = (kind: RootKind, f: GqlField) => {
    if (!schema) return;
    const empty = !query.trim();
    const snippet = operationSnippet(schema, kind, f, !empty);
    setQuery(empty ? snippet : `${query.replace(/\s+$/, "")}\n\n${snippet}`, true);
  };

  const insertField = (f: GqlField) => {
    if (!schema) return;
    const ta = taRef.current;
    const pos = ta ? ta.selectionStart : query.length;
    const ls = query.lastIndexOf("\n", pos - 1) + 1;
    const indent = /^[ \t]*/.exec(query.slice(ls))![0];
    const snip = fieldSnippet(schema, f, indent);
    const needsSpace = pos > 0 && !/\s|[{(]/.test(query[pos - 1]);
    const ins = (needsSpace ? " " : "") + snip;
    onChange({ ...body, gqlQuery: query.slice(0, pos) + ins + query.slice(pos) });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(pos + ins.length, pos + ins.length);
    });
  };

  // ── autocompletado ──
  const [pop, setPop] = useState<{ res: GqlCompletionResult; sel: number; left: number; top: number; maxH: number } | null>(null);
  const selRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => selRef.current?.scrollIntoView({ block: "nearest" }), [pop?.sel, pop?.res]);

  const refresh = (force = false) => {
    const ta = taRef.current;
    if (!ta || !schema || ta.selectionStart !== ta.selectionEnd) return setPop(null);
    const res = completionAt(schema, ta.value, ta.selectionStart, force);
    if (!res) return setPop(null);
    const cs = getComputedStyle(ta);
    const fs = parseFloat(cs.fontSize) || 13;
    const lineH = parseFloat(cs.lineHeight) || fs * 1.846;
    const before = ta.value.slice(0, res.from);
    const line = before.split("\n").length - 1;
    const col = res.from - (before.lastIndexOf("\n") + 1);
    const maxH = Math.min(192, Math.max(72, ta.clientHeight - 8));
    let top = 12 + (line + 1) * lineH - ta.scrollTop;
    if (top + maxH > ta.clientHeight) top = Math.max(0, 12 + line * lineH - ta.scrollTop - maxH);
    const left = Math.max(4, Math.min(12 + col * fs * 0.6 - ta.scrollLeft, ta.clientWidth - 260));
    setPop((p) => ({ res, sel: p && p.res.from === res.from ? Math.min(p.sel, res.items.length - 1) : 0, left, top, maxH }));
  };

  const accept = (item: GqlCompletion) => {
    const ta = taRef.current;
    if (!ta || !pop) return;
    const v = ta.value;
    const from = pop.res.from;
    const to = ta.selectionStart;
    const ls = v.lastIndexOf("\n", from - 1) + 1;
    const indent = /^[ \t]*/.exec(v.slice(ls))![0];
    let ins = item.insert.replace(/\n/g, "\n" + indent);
    const c = ins.indexOf("$|");
    ins = ins.replace("$|", "");
    const pos = from + (c >= 0 ? c : ins.length);
    onChange({ ...body, gqlQuery: v.slice(0, from) + ins + v.slice(to) });
    setPop(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === " ") {
      e.preventDefault();
      refresh(true);
      return true;
    }
    if (!pop) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = pop.res.items.length;
      setPop({ ...pop, sel: (pop.sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
      return true;
    }
    if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      accept(pop.res.items[pop.sel]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setPop(null);
      return true;
    }
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) setPop(null);
    return false;
  };

  const issueText = issue
    ? issue.kind === "unclosed" ? t("Falta cerrar «{0}» abierto en la línea {1}.", issue.ch, issue.line)
      : issue.kind === "unexpected" ? t("Sobra «{0}» en la línea {1}.", issue.ch, issue.line)
      : t("String sin cerrar en la línea {0}.", issue.line)
    : null;

  return (
    <div className="@container flex min-h-48 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {schema ? (
          <>
            <span className="text-xs text-slate" title={new Date(at).toLocaleString()}>
              {t("Esquema cargado · {0} tipos · {1}", countTypes(schema), new Date(at).toLocaleString())}
            </span>
            <button onClick={loadSchema} disabled={loading} className={btn} title={t("Volver a pedir el esquema al servidor")}>
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {t("Refrescar")}
            </button>
            <button onClick={() => setPanel((p) => !p)} className={`${btn} ${panel ? "border-aqua text-aqua" : ""}`} title={t("Mostrar u ocultar la documentación del esquema")}>
              <BookOpen size={13} /> {t("Esquema")}
            </button>
            <button onClick={forget} className={btn} title={t("Olvidar el esquema guardado de esta URL")}>
              {t("Olvidar")}
            </button>
          </>
        ) : (
          <button onClick={loadSchema} disabled={loading} className={`${btn} border-aqua/50 text-aqua`} title={t("Pide el esquema al servidor (introspección) para activar el autocompletado y la documentación")}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {loading ? t("Cargando esquema…") : t("Cargar esquema")}
          </button>
        )}
        {ops.length > 1 && (
          <label className="flex items-center gap-1 text-xs text-slate" title={t("La query tiene varias operaciones: elige cuál ejecutar")}>
            {t("Operación")}
            <select
              value={chosenOp}
              onChange={(e) => onChange({ ...body, gqlOp: e.target.value })}
              className="rounded-md border border-fg/10 bg-kelp px-1.5 py-1 text-xs text-silver focus:border-aqua focus:outline-none"
            >
              {ops.filter((o) => o.name).map((o) => (
                <option key={o.name} value={o.name!}>{o.kind} {o.name}</option>
              ))}
            </select>
          </label>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <button onClick={beautifyQuery} disabled={!query.trim()} className={btn} title={t("Ordena la query con sangrías")}>
            <Sparkles size={13} /> Beautify
          </button>
        </span>
      </div>

      {error && <p className="text-xs text-rose">{error}</p>}
      {!schema && !error && !loading && (
        <p className="text-xs text-slate">{t("Consejo: carga el esquema para tener autocompletado (Ctrl+Espacio) y ver qué campos ofrece el servidor.")}</p>
      )}
      {req.method === "GET" && (
        <p className="text-xs text-amber-400">
          {t("GraphQL se envía por POST; con GET muchos servidores lo rechazan.")}{" "}
          {onMethod && <button className="underline hover:text-aqua" onClick={() => onMethod("POST")}>{t("Cambiar a POST")}</button>}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 @3xl:flex-row">
        {schema && panel && (
          <div className="h-56 shrink-0 @3xl:h-auto @3xl:w-72">
            <GraphqlSchemaPanel schema={schema} onInsertOp={insertOp} onInsertField={insertField} />
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 @2xl:flex-row">
          <div className="flex min-h-40 min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-slate">{t("Query")}</span>
            <JsonEditor
              value={query}
              onChange={(q) => {
                setQuery(q);
                requestAnimationFrame(() => refresh(false));
              }}
              highlight={false}
              paintText={paintGql}
              taRef={taRef}
              onKeyDownExtra={onKey}
              onCaretMove={() => setPop(null)}
              placeholder={t("Escribe tu query aquí. Ejemplo:") + "\n\n" + EXAMPLE}
              className="min-h-40 flex-1"
            >
              {pop && (
                <div
                  style={{ left: pop.left, top: pop.top, maxHeight: pop.maxH }}
                  className="absolute z-30 flex w-64 flex-col overflow-auto rounded-md border border-fg/15 bg-deep py-1 text-xs shadow-lg"
                  role="listbox"
                >
                  {pop.res.items.map((it, i) => (
                    <button
                      key={it.label + i}
                      ref={i === pop.sel ? selRef : undefined}
                      role="option"
                      aria-selected={i === pop.sel}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        accept(it);
                      }}
                      title={it.doc || it.detail}
                      className={`flex items-center gap-2 px-2 py-0.5 text-left ${i === pop.sel ? "bg-aqua/20 text-aqua" : "text-silver hover:bg-fg/5"}`}
                    >
                      <span className="truncate font-mono">{it.label}</span>
                      <span className="ml-auto truncate font-mono text-[10px] text-slate">{it.detail}</span>
                    </button>
                  ))}
                </div>
              )}
            </JsonEditor>
            {issueText && <p className="text-xs text-rose">{issueText}</p>}
          </div>
          <div className="flex min-h-40 min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate">{t("Variables (JSON)")}</span>
              <span className="ml-auto flex gap-1.5">
                <button
                  onClick={genVars}
                  disabled={!defs.length}
                  className={`${btn} ${defs.length && !gqlVars.trim() ? "border-aqua/50 text-aqua" : ""}`}
                  title={defs.length ? t("Crea el JSON de variables a partir de las $variables declaradas en la query") : t("Declara variables en la query, p. ej. query ($id: ID!) { … }")}
                >
                  <Wand2 size={13} /> {t("Generar variables")}
                </button>
                <button onClick={() => reformatVars(2)} disabled={!gqlVars.trim() || !!varsErr} className={btn} title={t("Formatear con indentación")}>
                  <Sparkles size={13} /> Beautify
                </button>
                <button onClick={() => reformatVars(undefined)} disabled={!gqlVars.trim() || !!varsErr} className={btn} title={t("Compactar en una línea")}>
                  <Minimize2 size={13} /> Minify
                </button>
              </span>
            </div>
            <JsonEditor
              value={gqlVars}
              onChange={(v) => onChange({ ...body, gqlVars: v })}
              highlight
              placeholder={'{ "id": 1 }'}
              className="min-h-40 flex-1"
            />
            {varsErr && <p className="text-xs text-rose">{t(varsErr)}</p>}
            {!gqlVars.trim() && defs.length > 0 && (
              <p className="text-xs text-slate">{t("La query usa variables ({0}): pulsa «Generar variables» para rellenarlas.", defs.map((d) => "$" + d.name).join(", "))}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
