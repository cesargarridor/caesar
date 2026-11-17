import { useState } from "react";
import KVEditor from "./KVEditor";
import AuthEditor from "./AuthEditor";
import BodyEditor from "./BodyEditor";
import JsonEditor from "./JsonEditor";
import type { AuthData, KV, RequestState } from "../types";
import { t } from "../lib/i18n";

type Tab = "params" | "auth" | "body" | "tests" | "headers";

interface Props {
  req: RequestState;
  patch: (p: Partial<RequestState>) => void;
  /** Autorización que hereda la petición (si usa "Inherit"). */
  inherited?: AuthData | null;
  /** Variables efectivas ({{x}}), para cargar el esquema GraphQL. */
  vars?: KV[];
  /** Abre el asistente de IA (se ofrece dentro de Body). */
  onAi?: () => void;
  /** Id de la pestaña de petición: cada una recuerda su propia subpestaña (Params, Headers, Body…). */
  tabId: string;
}

const COMMON_HEADERS = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control", "Content-Type",
  "Cookie", "Origin", "Referer", "User-Agent", "X-Requested-With", "X-API-Key", "If-None-Match",
];

const TAB_KEY = "caesar.reqTab";
const VALID: Tab[] = ["params", "auth", "body", "tests", "headers"];

const TESTS_EXAMPLE = `var jsonData = JSON.parse(responseBody);
pm.globals.set("token_id", jsonData.access_token);`;
// Cada pestaña recuerda su subpestaña; `lastTab` solo es el valor inicial de una pestaña nueva (el componente se remonta por pestaña).
let lastTab: Tab = (() => {
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab | null;
    return v && VALID.includes(v) ? v : "params";
  } catch {
    return "params";
  }
})();

const PER_KEY = "caesar.reqTabs";
/** Subpestaña elegida en cada pestaña de petición (por id). Solo interfaz: no toca el estado de las pestañas ni el guardado. */
const perTab: Record<string, Tab> = (() => {
  try {
    const o = JSON.parse(localStorage.getItem(PER_KEY) ?? "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
})();

export default function RequestTabs({ req, patch, inherited, vars, onAi, tabId }: Props) {
  const [tab, setTabState] = useState<Tab>(() => (VALID.includes(perTab[tabId]) ? perTab[tabId] : lastTab));
  const setTab = (t: Tab) => {
    lastTab = t; // las pestañas nuevas empiezan donde estabas
    perTab[tabId] = t;
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
      const keys = Object.keys(perTab);
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete perTab[k];
      localStorage.setItem(PER_KEY, JSON.stringify(perTab));
    } catch {
      /* sin persistencia */
    }
  };
  const count = (l: { enabled: boolean; key: string }[]) => l.filter((x) => x.enabled && x.key).length;

  // Headers va a la derecha del todo, como pidió el usuario.
  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: "params", label: "Params", badge: count(req.params) ? String(count(req.params)) : undefined },
    { id: "auth", label: "Authorization", badge: req.auth.type !== "none" ? "•" : undefined },
    { id: "body", label: "Body", badge: req.body.mode !== "none" ? "•" : undefined },
    { id: "tests", label: "Scripts", badge: req.tests?.trim() ? "•" : undefined },
    { id: "headers", label: "Headers", badge: count(req.headers) ? String(count(req.headers)) : undefined },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-fg/10 px-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? "border-aqua font-semibold text-aqua" : "border-transparent text-slate hover:text-silver"
            }`}
          >
            {t.label}
            {t.badge && <span className="text-xs font-bold text-aqua">{t.badge}</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "params" && (
          <KVEditor
            rows={req.params}
            onChange={(params) => patch({ params })}
            keyPlaceholder="Query param"
          />
        )}
        {tab === "auth" && <AuthEditor auth={req.auth} onChange={(auth) => patch({ auth })} inherited={inherited} />}
        {tab === "body" && <BodyEditor body={req.body} onChange={(body) => patch({ body })} req={req} vars={vars} inherited={inherited} onMethod={(method) => patch({ method })} onAi={onAi} />}
        {tab === "tests" && (
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
                {t("Insertar ejemplo: guardar el access_token en una variable")}
              </button>
            )}
          </div>
        )}
        {tab === "headers" && (
          <KVEditor rows={req.headers} onChange={(headers) => patch({ headers })} suggestions={COMMON_HEADERS} />
        )}
      </div>
    </div>
  );
}
