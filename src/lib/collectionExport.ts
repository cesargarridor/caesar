import type { AuthData, BodyData, KV, RequestNode, TreeNode } from "../types";

/** Exporta un árbol de Caesar a una colección JSON v2.1. */

interface PmKv { key: string; value: string; type?: string; src?: string; disabled?: boolean; contentType?: string }

const kv = (l: KV[]): PmKv[] =>
  l.map((k) => {
    const o: PmKv = { key: k.key, value: k.value };
    if (k.kind === "file") {
      o.type = "file";
      o.src = k.path || k.value;
      o.value = "";
    } else {
      o.type = "text";
    }
    if (k.contentType?.trim()) o.contentType = k.contentType.trim();
    if (!k.enabled) o.disabled = true;
    return o;
  });

function pmUrl(raw: string) {
  const out: Record<string, unknown> = { raw };
  const m = raw.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  const rest = m ? m[2] : raw;
  if (m) out.protocol = m[1];
  const q = rest.indexOf("?");
  const beforeQ = q < 0 ? rest : rest.slice(0, q);
  const slash = beforeQ.indexOf("/");
  const hostPort = slash < 0 ? beforeQ : beforeQ.slice(0, slash);
  const path = slash < 0 ? "" : beforeQ.slice(slash + 1);
  const hp = hostPort.match(/^(.*?)(?::(\d+))?$/);
  out.host = (hp ? hp[1] : hostPort).split(".");
  if (hp && hp[2]) out.port = hp[2];
  if (path) out.path = path.split("/");
  if (q >= 0) {
    out.query = rest
      .slice(q + 1)
      .split("&")
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return { key: i < 0 ? p : p.slice(0, i), value: i < 0 ? "" : p.slice(i + 1) };
      });
  }
  return out;
}

function pmBody(b: BodyData): Record<string, unknown> | undefined {
  switch (b.mode) {
    case "json":
      return { mode: "raw", raw: b.raw, options: { raw: { language: "json" } } };
    case "text":
      return { mode: "raw", raw: b.raw, options: { raw: { language: "text" } } };
    case "formdata":
      return { mode: "formdata", formdata: kv(b.formdata) };
    case "urlencoded":
      return { mode: "urlencoded", urlencoded: kv(b.urlencoded).map(({ key, value, disabled }) => ({ key, value, type: "text", ...(disabled ? { disabled } : {}) })) };
    default:
      return undefined;
  }
}

function pmAuth(a: Partial<AuthData> & { type?: string }): Record<string, unknown> | undefined {
  const s = (key: string, value: string | undefined) => ({ key, value: value ?? "", type: "string" });
  switch (a.type) {
    case "bearer":
      return { type: "bearer", bearer: [s("token", a.token)] };
    case "basic":
      return { type: "basic", basic: [s("username", a.username), s("password", a.password)] };
    case "apikey":
      return { type: "apikey", apikey: [s("key", a.key), s("value", a.value), s("in", a.in ?? "header")] };
    case "digest":
      return { type: "digest", digest: [s("username", a.username), s("password", a.password)] };
    case "ntlm":
      return { type: "ntlm", ntlm: [s("username", a.username), s("password", a.password), s("domain", a.extra?.domain), s("workstation", a.extra?.workstation)] };
    case "oauth1": {
      const x = a.extra ?? {};
      return {
        type: "oauth1",
        oauth1: [s("consumerKey", x.consumerKey), s("consumerSecret", x.consumerSecret), s("token", x.token), s("tokenSecret", x.tokenSecret), s("signatureMethod", x.signatureMethod || "HMAC-SHA1"), s("realm", x.realm), s("addParamsToHeader", x.addTo === "query" ? "false" : "true")],
      };
    }
    case "oauth2": {
      const x = a.extra ?? {};
      return {
        type: "oauth2",
        oauth2: [
          s("grant_type", x.grantType === "password" ? "password_credentials" : x.grantType === "client_credentials" ? "client_credentials" : "authorization_code"),
          s("accessToken", x.accessToken), s("accessTokenUrl", x.accessTokenUrl), s("clientId", x.clientId), s("clientSecret", x.clientSecret), s("scope", x.scope),
          s("username", a.username), s("password", a.password), s("headerPrefix", x.headerPrefix || "Bearer"), s("addTokenTo", x.addTokenTo === "query" ? "queryParams" : "header"),
        ],
      };
    }
    case "awsv4": {
      const x = a.extra ?? {};
      return { type: "awsv4", awsv4: [s("accessKey", x.accessKey), s("secretKey", x.secretKey), s("region", x.region), s("service", x.service), s("sessionToken", x.sessionToken)] };
    }
    case "akamai": {
      const x = a.extra ?? {};
      return {
        type: "edgegrid",
        edgegrid: [s("accessToken", x.accessToken), s("clientToken", x.clientToken), s("clientSecret", x.clientSecret), s("baseURL", x.baseUri), s("nonce", x.nonce), s("timestamp", x.timestamp), s("headersToSign", x.headersToSign)],
      };
    }
    default:
      return undefined;
  }
}

function pmRequest(n: RequestNode) {
  const body = pmBody({
    mode: (n.body.mode as BodyData["mode"]) ?? "none",
    raw: n.body.raw ?? "",
    formdata: n.body.formdata ?? [],
    urlencoded: n.body.urlencoded ?? [],
  });
  const auth = pmAuth(n.auth);
  return {
    method: n.method,
    header: n.headers.map((h) => ({ key: h.key, value: h.value, type: "text", ...(h.enabled ? {} : { disabled: true }) })),
    ...(body ? { body } : {}),
    ...(auth ? { auth } : {}),
    url: pmUrl(n.url),
  };
}

function pmItem(n: TreeNode): unknown {
  if (n.type === "folder") return { name: n.name, item: n.children.map(pmItem) };
  const event = n.tests?.trim()
    ? [{ listen: "test", script: { type: "text/javascript", exec: n.tests.split("\n") } }]
    : undefined;
  return { name: n.name, ...(event ? { event } : {}), request: pmRequest(n), response: [] };
}

export function exportCollection(root: TreeNode, globals: KV[]): string {
  // Variables de la colección primero; las globales que no estén pisadas se añaden (como antes).
  const own = root.type === "folder" ? root.variables ?? [] : [];
  const have = new Set(own.map((v) => v.key));
  const vars = [...own, ...globals.filter((v) => !have.has(v.key))];
  const children = root.type === "folder" ? root.children : [root];
  const doc = {
    info: {
      name: root.name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: children.map(pmItem),
    variable: vars.filter((v) => v.key).map((v) => ({ key: v.key, value: v.value, ...(v.enabled ? {} : { disabled: true }) })),
  };
  return JSON.stringify(doc, null, 2);
}

export const safeFileName = (name: string) =>
  (name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "coleccion") + ".json";
