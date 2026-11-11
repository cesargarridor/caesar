import type { AuthData, KV, RequestNode, RequestState } from "../types";
import { buildUrl, encodeParam } from "./url";
import { defaultSettings, emptyAuth } from "./curl";

/** Reemplaza {{variable}} usando las variables definidas; las desconocidas se dejan tal cual. */
export function substitute(s: string, vars: KV[]): string {
  if (!s.includes("{{")) return s;
  const map = new Map(vars.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value]));
  return s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k: string) => map.get(k) ?? m);
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

/** Convierte el estado de la UI en los argumentos que espera el comando Rust. */
export function buildExecuteArgs(req: RequestState, vars: KV[]) {
  const sub = (s: string) => substitute(s, vars);
  const subKv = (list: KV[]): KV[] => list.map((k) => ({ ...k, key: sub(k.key), value: sub(k.value) }));

  let url = sub(buildUrl(req.url, req.params.map((p) => ({ ...p, key: p.key, value: p.value }))));
  const headers = subKv(req.headers);
  const a = req.auth;
  const hasAuthHeader = headers.some((h) => h.enabled && h.key.toLowerCase() === "authorization");

  if (a.type === "bearer" && a.token && !hasAuthHeader) {
    headers.push({ key: "Authorization", value: `Bearer ${sub(a.token)}`, enabled: true });
  } else if (a.type === "basic" && !hasAuthHeader) {
    headers.push({ key: "Authorization", value: `Basic ${b64(`${sub(a.username)}:${sub(a.password)}`)}`, enabled: true });
  } else if (a.type === "apikey" && a.key) {
    if (a.in === "query") {
      url += `${url.includes("?") ? "&" : "?"}${encodeParam(sub(a.key))}=${encodeParam(sub(a.value))}`;
    } else {
      headers.push({ key: sub(a.key), value: sub(a.value), enabled: true });
    }
  }

  return {
    method: req.method,
    url,
    headers,
    body: {
      mode: req.body.mode,
      raw: sub(req.body.raw),
      formdata: subKv(req.body.formdata),
      urlencoded: subKv(req.body.urlencoded),
    },
    settings: req.settings,
  };
}

const AUTH_TYPES = ["none", "bearer", "basic", "apikey"];

/** Request del árbol de Postman -> estado editable. */
export function requestFromNode(n: RequestNode): RequestState {
  const raw = n.url;
  const q = raw.indexOf("?");
  const base = q < 0 ? raw : raw.slice(0, q);
  const params: KV[] =
    q < 0
      ? []
      : raw
          .slice(q + 1)
          .split("&")
          .map((p) => {
            const eq = p.indexOf("=");
            const dec = (s: string) => {
              try {
                return decodeURIComponent(s);
              } catch {
                return s;
              }
            };
            return { key: dec(eq < 0 ? p : p.slice(0, eq)), value: dec(eq < 0 ? "" : p.slice(eq + 1)), enabled: true };
          });

  const auth: AuthData = { ...emptyAuth(), ...n.auth } as AuthData;
  if (!AUTH_TYPES.includes(auth.type)) auth.type = "none";
  if (auth.in !== "query") auth.in = "header";

  const mode = ["none", "json", "text", "formdata", "urlencoded"].includes(n.body.mode) ? n.body.mode : "none";
  return {
    method: n.method,
    url: base,
    params,
    headers: n.headers,
    auth,
    body: {
      mode: mode as RequestState["body"]["mode"],
      raw: n.body.raw ?? "",
      formdata: n.body.formdata ?? [],
      urlencoded: n.body.urlencoded ?? [],
    },
    settings: defaultSettings(),
    tests: n.tests ?? "",
  };
}
