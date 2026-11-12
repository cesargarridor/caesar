import { useState } from "react";
import KVEditor from "./KVEditor";
import AuthEditor from "./AuthEditor";
import BodyEditor from "./BodyEditor";
import JsonEditor from "./JsonEditor";
import type { AuthData, RequestState } from "../types";
import { t } from "../lib/i18n";

type Tab = "params" | "auth" | "body" | "tests" | "headers" | "settings";

interface Props {
  req: RequestState;
  patch: (p: Partial<RequestState>) => void;
  /** Autorización que hereda la petición (si usa "Inherit"). */
  inherited?: AuthData | null;
}

const COMMON_HEADERS = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control", "Content-Type",
  "Cookie", "Origin", "Referer", "User-Agent", "X-Requested-With", "X-API-Key", "If-None-Match",
];

const box = "w-24 rounded-md border border-fg/10 bg-kelp px-2 py-1.5 text-sm focus:outline-none focus:border-aqua";

const TAB_KEY = "caesar.reqTab";
const VALID: Tab[] = ["params", "auth", "body", "tests", "headers", "settings"];

const TESTS_EXAMPLE = `var jsonData = JSON.parse(responseBody);
pm.globals.set("token_id", jsonData.access_token);`;
// La subpestaña elegida se mantiene al cambiar de solicitud (el componente se remonta por pestaña).
let lastTab: Tab = (() => {
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab | null;
    return v && VALID.includes(v) ? v : "params";
  } catch {
    return "params";
  }
})();

export default function RequestTabs({ req, patch, inherited }: Props) {
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
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
    { id: "settings", label: "Settings" },
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
              tab === t.id ? "border-aqua text-mist" : "border-transparent text-slate hover:text-silver"
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
        {tab === "body" && <BodyEditor body={req.body} onChange={(body) => patch({ body })} />}
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
        {tab === "settings" && (
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-[var(--t-accent)]"
                checked={req.settings.followRedirects}
                onChange={(e) => patch({ settings: { ...req.settings, followRedirects: e.target.checked } })}
              />
              {t("Seguir redirecciones (máx. 10)")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-[var(--t-accent)]"
                checked={req.settings.verifySsl}
                onChange={(e) => patch({ settings: { ...req.settings, verifySsl: e.target.checked } })}
              />
              {t("Verificar certificado SSL")}
              {!req.settings.verifySsl && <span className="text-xs text-lav">{t("⚠ desactivado: solo para pruebas")}</span>}
            </label>
            <label className="flex items-center gap-2">
              {t("Versión de HTTP")}
              <select
                className={box.replace("w-24", "w-36")}
                value={req.settings.httpVersion ?? "auto"}
                onChange={(e) => patch({ settings: { ...req.settings, httpVersion: e.target.value as "auto" | "1.1" | "2" } })}
              >
                <option value="auto">{t("Automática")}</option>
                <option value="1.1">HTTP/1.x</option>
                <option value="2">HTTP/2</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              {t("Timeout (segundos, 0 = 1 hora, máx. 3600)")}
              <input
                type="number"
                min={0}
                className={box}
                value={req.settings.timeoutSecs}
                onChange={(e) =>
                  patch({ settings: { ...req.settings, timeoutSecs: Math.min(3600, Math.max(0, Math.floor(Number(e.target.value)) || 0)) } })
                }
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
