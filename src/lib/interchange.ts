// Importar y exportar colecciones en otros formatos: JSON/YAML (v4 y v5) y HAR (HTTP Archive 1.2).
// El formato JSON v2.1 lo procesa Rust al importar (parse_collection_content) y collectionExport.ts al exportar.
import YAML from "yaml";
import type { AuthData, BodyData, ImportedCollection, KV, RequestNode, TreeNode } from "../types";

export type ExportFormat = "json" | "yaml" | "har";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

const kv = (key: string, value: string, enabled = true): KV => ({ key, value, enabled });

// ───────────────────────── variables: {{ _.x }} (YAML) <-> {{x}} (Caesar) ─────────────────────────

const fromEnvVars = (s: string) => s.replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, "{{$1}}");
const toEnvVars = (s: string) => s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => (k.startsWith("_.") || k.startsWith("$") ? m : `{{ _.${k} }}`));

// ───────────────────────── detección ─────────────────────────

export type Detected =
  | { kind: "native" }
  | { kind: "ready"; data: ImportedCollection };

/** Lee JSON o YAML y reconoce el formato. El JSON v2.1 se devuelve como "native" para que lo procese Rust. */
export function detectAndParse(text: string): Detected {
  let doc: unknown;
  const trimmed = text.trim();
  if (!trimmed) throw new Error("El archivo está vacío.");
  try {
    doc = JSON.parse(trimmed);
  } catch {
    try {
      doc = YAML.parse(trimmed);
    } catch {
      throw new Error("El archivo no es JSON ni YAML válido.");
    }
  }
  if (!isObj(doc)) throw new Error("No se reconoce el formato del archivo.");

  if (isObj(doc.log) && Array.isArray(doc.log.entries)) return { kind: "ready", data: parseHar(doc) };
  if (doc._type === "export" && Array.isArray(doc.resources)) return { kind: "ready", data: parseListDoc(doc) };
  if (typeof doc.type === "string" && doc.type.startsWith("collection.insomnia.rest")) {
    return { kind: "ready", data: parseTreeDoc(doc) };
  }
  if (isObj(doc.info) && Array.isArray(doc.item)) return { kind: "native" };
  // Entorno (o globales) exportado: solo trae variables.
  if (Array.isArray(doc.values) && typeof doc.name === "string") {
    return { kind: "ready", data: parseEnvDoc(doc) };
  }
  throw new Error("Formato no reconocido. Se admiten colecciones y entornos en JSON (v2.1), colecciones JSON o YAML (v4 y v5) y HAR.");
}

// ───────────────────────── piezas comunes de los formatos ─────────────────────────

function insBody(b: unknown): BodyData {
  const out: BodyData = { mode: "none", raw: "", formdata: [], urlencoded: [] };
  if (!isObj(b)) return out;
  const mime = str(b.mimeType).toLowerCase();
  const params = arr(b.params);
  if (mime.includes("x-www-form-urlencoded")) {
    out.mode = "urlencoded";
    out.urlencoded = params.map((p) => kv(str(p.name), fromEnvVars(str(p.value)), !p.disabled));
  } else if (mime.includes("multipart/form-data")) {
    out.mode = "formdata";
    out.formdata = params.map((p) =>
      p.type === "file"
        ? { key: str(p.name), value: "", enabled: !p.disabled, kind: "file" as const, path: str(p.fileName) }
        : { key: str(p.name), value: fromEnvVars(str(p.value)), enabled: !p.disabled, kind: "text" as const },
    );
  } else if (typeof b.text === "string" && b.text !== "") {
    out.mode = mime.includes("json") ? "json" : "text";
    out.raw = fromEnvVars(b.text);
  }
  return out;
}

function insAuth(a: unknown): Partial<AuthData> & { type: string } {
  if (!isObj(a) || a.disabled === true) return { type: "none" };
  switch (a.type) {
    case "bearer":
      return { type: "bearer", token: fromEnvVars(str(a.token)) };
    case "basic":
      return { type: "basic", username: fromEnvVars(str(a.username)), password: fromEnvVars(str(a.password)) };
    case "apikey":
      return {
        type: "apikey",
        key: fromEnvVars(str(a.key)),
        value: fromEnvVars(str(a.value)),
        in: a.addTo === "queryParams" ? "query" : "header",
      };
    case "digest":
      return { type: "digest", username: fromEnvVars(str(a.username)), password: fromEnvVars(str(a.password)) };
    case "ntlm":
      return {
        type: "ntlm",
        username: fromEnvVars(str(a.username)),
        password: fromEnvVars(str(a.password)),
        extra: cleanExtra({ domain: str(a.domain), workstation: str(a.workstation) }),
      };
    case "iam":
      return {
        type: "awsv4",
        extra: cleanExtra({
          accessKey: fromEnvVars(str(a.accessKeyId)),
          secretKey: fromEnvVars(str(a.secretAccessKey)),
          sessionToken: fromEnvVars(str(a.sessionToken)),
          region: str(a.region),
          service: str(a.service),
        }),
      };
    case "oauth1":
      return {
        type: "oauth1",
        extra: cleanExtra({
          consumerKey: fromEnvVars(str(a.consumerKey)),
          consumerSecret: fromEnvVars(str(a.consumerSecret)),
          token: fromEnvVars(str(a.tokenKey)),
          tokenSecret: fromEnvVars(str(a.tokenSecret)),
          signatureMethod: str(a.signatureMethod) || "HMAC-SHA1",
          realm: str(a.realm),
          verifier: str(a.verifier),
        }),
      };
    case "oauth2": {
      const g = str(a.grantType);
      const grant = g === "client_credentials" ? "client_credentials" : g === "password" ? "password" : "manual";
      return {
        type: "oauth2",
        username: fromEnvVars(str(a.username)),
        password: fromEnvVars(str(a.password)),
        extra: cleanExtra({
          grantType: grant,
          accessTokenUrl: fromEnvVars(str(a.accessTokenUrl)),
          clientId: fromEnvVars(str(a.clientId)),
          clientSecret: fromEnvVars(str(a.clientSecret)),
          scope: str(a.scope),
          accessToken: fromEnvVars(str(a.accessToken)),
          headerPrefix: str(a.tokenPrefix) || "Bearer",
          credentialsIn: a.credentialsInBody === true ? "body" : "basic",
        }),
      };
    }
    default:
      return { type: "none" };
  }
}

/** Quita los campos vacíos de un objeto de extras. */
function cleanExtra(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ""));
}

function insUrl(url: string, params: Obj[]): string {
  let u = fromEnvVars(url);
  const q = params
    .filter((p) => !p.disabled && str(p.name))
    .map((p) => `${str(p.name)}=${fromEnvVars(str(p.value))}`)
    .join("&");
  if (q) u += (u.includes("?") ? "&" : "?") + q;
  return u;
}

function insRequest(r: Obj): RequestNode {
  return {
    type: "request",
    name: str(r.name) || "Petición",
    method: (str(r.method) || "GET").toUpperCase(),
    url: insUrl(str(r.url), arr(r.parameters)),
    headers: arr(r.headers).map((h) => kv(str(h.name), fromEnvVars(str(h.value)), !h.disabled)),
    body: insBody(r.body),
    auth: insAuth(r.authentication),
    tests: "",
  };
}

/** Aplana objetos anidados a claves con puntos (a.b), que es como se usan en el formato YAML ({{ _.a.b }}). */
function flatten(o: Obj, prefix = ""): [string, string][] {
  return Object.entries(o).flatMap(([k, v]): [string, string][] =>
    isObj(v) ? flatten(v, prefix + k + ".") : [[prefix + k, fromEnvVars(str(v))]],
  );
}

/** Variables de uno o varios entornos: el primero que tenga valor para una clave gana. */
function envVars(...datas: unknown[]): KV[] {
  const out = new Map<string, string>();
  for (const d of datas) {
    if (!isObj(d)) continue;
    for (const [k, v] of flatten(d)) if (!out.has(k) || (out.get(k) === "" && v !== "")) out.set(k, v);
  }
  return [...out].map(([k, v]) => kv(k, v));
}

// ───────────────────────── entorno (variables) ─────────────────────────

function parseEnvDoc(doc: Obj): ImportedCollection {
  const variables = arr(doc.values)
    .filter((v) => str(v.key))
    .map((v) => {
      const value = [v.value, v.currentValue, v.initialValue].map(str).find((s) => s !== "") ?? "";
      return kv(str(v.key), value, v.enabled !== false && v.disabled !== true);
    });
  return { root: { type: "folder", name: str(doc.name) || "Entorno", children: [] }, variables };
}

// ───────────────────────── v4 (lista plana "resources") ─────────────────────────

function parseListDoc(doc: Obj): ImportedCollection {
  const res = arr(doc.resources);
  const ws = res.find((r) => r._type === "workspace");
  const wsId = str(ws?._id);
  const sortKey = (r: Obj) => (typeof r.metaSortKey === "number" ? r.metaSortKey : 0);
  const childrenOf = (parent: string): TreeNode[] =>
    res
      .filter((r) => str(r.parentId) === parent && (r._type === "request" || r._type === "request_group"))
      .sort((a, b) => sortKey(a) - sortKey(b))
      .map((r): TreeNode =>
        r._type === "request_group"
          ? { type: "folder", name: str(r.name) || "Carpeta", children: childrenOf(str(r._id)) }
          : insRequest(r),
      );
  const base =
    res.find((r) => r._type === "environment" && str(r.parentId) === wsId && !r.isPrivate) ??
    res.find((r) => r._type === "environment" && str(r.parentId) === wsId);
  // Si el entorno base no trae valores, se completan con los de sus subentornos.
  const subs = res.filter((r) => r._type === "environment" && r !== base && (str(r.parentId) === str(base?._id) || str(r.parentId) === wsId));
  const variables = envVars(base?.data, ...subs.map((r) => r.data));
  const name = str(ws?.name) || "Colección importada";
  return { root: { type: "folder", name, children: childrenOf(wsId) }, variables };
}

// ───────────────────────── v5 (YAML con árbol "collection") ─────────────────────────

function v5Node(n: Obj): TreeNode {
  if (Array.isArray(n.children)) {
    return { type: "folder", name: str(n.name) || "Carpeta", children: arr(n.children).map(v5Node) };
  }
  return insRequest(n);
}

function parseTreeDoc(doc: Obj): ImportedCollection {
  const envs = Array.isArray(doc.environments) ? arr(doc.environments) : isObj(doc.environments) ? [doc.environments] : [];
  const subs = envs.flatMap((e) => arr(e.subEnvironments));
  return {
    root: { type: "folder", name: str(doc.name) || "Colección importada", children: arr(doc.collection).map(v5Node) },
    variables: envVars(...envs.map((e) => e.data), ...subs.map((e) => e.data)),
  };
}

// ───────────────────────── HAR ─────────────────────────

function parseHar(doc: Obj): ImportedCollection {
  const log = doc.log as Obj;
  const children: TreeNode[] = arr(log.entries).flatMap((e): TreeNode[] => {
    const rq = e.request;
    if (!isObj(rq) || !str(rq.url)) return [];
    const url = str(rq.url);
    const headers = arr(rq.headers)
      .filter((h) => !str(h.name).startsWith(":")) // pseudo-cabeceras de HTTP/2
      .map((h) => kv(str(h.name), str(h.value)));
    const body: BodyData = { mode: "none", raw: "", formdata: [], urlencoded: [] };
    const pd = rq.postData;
    if (isObj(pd)) {
      const mime = str(pd.mimeType).toLowerCase();
      const params = arr(pd.params);
      if (mime.includes("x-www-form-urlencoded") && params.length) {
        body.mode = "urlencoded";
        body.urlencoded = params.map((p) => kv(str(p.name), str(p.value)));
      } else if (mime.includes("multipart/form-data") && params.length) {
        body.mode = "formdata";
        body.formdata = params.map((p) =>
          p.fileName
            ? { key: str(p.name), value: "", enabled: true, kind: "file" as const, path: str(p.fileName) }
            : { key: str(p.name), value: str(p.value), enabled: true, kind: "text" as const },
        );
      } else if (typeof pd.text === "string" && pd.text !== "") {
        body.mode = mime.includes("json") ? "json" : "text";
        body.raw = pd.text;
      }
    }
    let label = url;
    try {
      const u = new URL(url);
      label = u.pathname === "/" ? u.host : u.pathname;
    } catch {
      /* se deja la URL completa como nombre */
    }
    const method = (str(rq.method) || "GET").toUpperCase();
    return [{ type: "request", name: `${method} ${label}`.slice(0, 120), method, url, headers, body, auth: { type: "none" }, tests: "" }];
  });
  if (children.length === 0) throw new Error("El archivo HAR no contiene peticiones.");
  const creator = isObj(log.creator) ? str(log.creator.name) : "";
  return { root: { type: "folder", name: creator ? `HAR (${creator})` : "HAR", children }, variables: [] };
}

// ───────────────────────── exportar ─────────────────────────

const rid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "")}`;

function reqBody(n: RequestNode): BodyData {
  return {
    mode: (n.body.mode as BodyData["mode"]) ?? "none",
    raw: n.body.raw ?? "",
    formdata: n.body.formdata ?? [],
    urlencoded: n.body.urlencoded ?? [],
  };
}

/** Sustituye {{variable}} por su valor (para HAR, que no tiene variables). Las desconocidas se dejan tal cual. */
function resolver(vars: KV[]) {
  const map = new Map(vars.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value]));
  return (s: string) => s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => map.get(k) ?? m);
}

function collectRequests(nodes: TreeNode[], prefix: string[] = []): { path: string[]; req: RequestNode }[] {
  return nodes.flatMap((n) =>
    n.type === "folder" ? collectRequests(n.children, [...prefix, n.name]) : [{ path: prefix, req: n }],
  );
}

export function exportHar(root: TreeNode, globals: KV[]): string {
  const own = root.type === "folder" ? root.variables ?? [] : [];
  const have = new Set(own.map((v) => v.key));
  const sub = resolver([...own, ...globals.filter((v) => !have.has(v.key))]);
  const items = collectRequests(root.type === "folder" ? root.children : [root]);
  const now = new Date().toISOString();

  const entries = items.map(({ path, req }) => {
    const b = reqBody(req);
    let url = sub(req.url);
    const headers = req.headers.filter((h) => h.enabled && h.key).map((h) => ({ name: h.key, value: sub(h.value) }));
    const a = req.auth;
    if (a.type === "bearer") headers.push({ name: "Authorization", value: `Bearer ${sub(a.token ?? "")}` });
    else if (a.type === "basic") {
      const raw = `${sub(a.username ?? "")}:${sub(a.password ?? "")}`;
      headers.push({ name: "Authorization", value: `Basic ${btoa(unescape(encodeURIComponent(raw)))}` });
    } else if (a.type === "apikey" && a.key) {
      if (a.in === "query") url += (url.includes("?") ? "&" : "?") + `${encodeURIComponent(sub(a.key))}=${encodeURIComponent(sub(a.value ?? ""))}`;
      else headers.push({ name: sub(a.key), value: sub(a.value ?? "") });
    }

    let postData: Obj | undefined;
    let mime = "";
    if (b.mode === "json" || b.mode === "text") {
      mime = b.mode === "json" ? "application/json" : "text/plain";
      postData = { mimeType: mime, text: sub(b.raw) };
    } else if (b.mode === "urlencoded") {
      mime = "application/x-www-form-urlencoded";
      const params = b.urlencoded.filter((p) => p.enabled && p.key).map((p) => ({ name: p.key, value: sub(p.value) }));
      postData = { mimeType: mime, params, text: params.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join("&") };
    } else if (b.mode === "formdata") {
      mime = "multipart/form-data";
      postData = {
        mimeType: mime,
        params: b.formdata
          .filter((p) => p.enabled && p.key)
          .map((p) => (p.kind === "file" ? { name: p.key, fileName: p.path || p.value } : { name: p.key, value: sub(p.value) })),
      };
    }
    if (mime && !headers.some((h) => h.name.toLowerCase() === "content-type")) headers.push({ name: "Content-Type", value: mime });

    let queryString: { name: string; value: string }[] = [];
    try {
      queryString = [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
    } catch {
      /* URL con variables sin resolver: sin queryString */
    }
    return {
      startedDateTime: now,
      time: 0,
      comment: [...path, req.name].join(" / "),
      request: {
        method: req.method,
        url,
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers,
        queryString,
        ...(postData ? { postData } : {}),
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: 0,
        statusText: "",
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: [],
        content: { size: 0, mimeType: "x-unknown" },
        redirectURL: "",
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
    };
  });
  return JSON.stringify({ log: { version: "1.2", creator: { name: "Caesar", version: "1" }, comment: root.name, entries } }, null, 2);
}

function insNodeOut(n: TreeNode, i: number): Obj {
  const stamp = Date.now();
  const meta = (prefix: string) => ({ id: rid(prefix), created: stamp, modified: stamp, isPrivate: false, sortKey: -(stamp + i) });
  if (n.type === "folder") return { name: n.name, meta: meta("fld"), children: n.children.map(insNodeOut) };
  const b = reqBody(n);
  let body: Obj | undefined;
  if (b.mode === "json") body = { mimeType: "application/json", text: toEnvVars(b.raw) };
  else if (b.mode === "text") body = { mimeType: "text/plain", text: toEnvVars(b.raw) };
  else if (b.mode === "urlencoded") {
    body = {
      mimeType: "application/x-www-form-urlencoded",
      params: b.urlencoded.map((p) => ({ name: p.key, value: toEnvVars(p.value), ...(p.enabled ? {} : { disabled: true }) })),
    };
  } else if (b.mode === "formdata") {
    body = {
      mimeType: "multipart/form-data",
      params: b.formdata.map((p) =>
        p.kind === "file"
          ? { name: p.key, type: "file", fileName: p.path || p.value, ...(p.enabled ? {} : { disabled: true }) }
          : { name: p.key, value: toEnvVars(p.value), ...(p.enabled ? {} : { disabled: true }) },
      ),
    };
  }
  const a = n.auth;
  let authentication: Obj | undefined;
  if (a.type === "bearer") authentication = { type: "bearer", token: toEnvVars(a.token ?? "") };
  else if (a.type === "basic") authentication = { type: "basic", username: toEnvVars(a.username ?? ""), password: toEnvVars(a.password ?? "") };
  else if (a.type === "apikey") {
    authentication = { type: "apikey", key: toEnvVars(a.key ?? ""), value: toEnvVars(a.value ?? ""), addTo: a.in === "query" ? "queryParams" : "header" };
  } else if (a.type === "digest") authentication = { type: "digest", username: toEnvVars(a.username ?? ""), password: toEnvVars(a.password ?? "") };
  else if (a.type === "ntlm") {
    authentication = { type: "ntlm", username: toEnvVars(a.username ?? ""), password: toEnvVars(a.password ?? ""), domain: a.extra?.domain ?? "", workstation: a.extra?.workstation ?? "" };
  } else if (a.type === "awsv4") {
    const x = a.extra ?? {};
    authentication = { type: "iam", accessKeyId: toEnvVars(x.accessKey ?? ""), secretAccessKey: toEnvVars(x.secretKey ?? ""), sessionToken: toEnvVars(x.sessionToken ?? ""), region: x.region ?? "", service: x.service ?? "" };
  } else if (a.type === "oauth1") {
    const x = a.extra ?? {};
    authentication = { type: "oauth1", consumerKey: toEnvVars(x.consumerKey ?? ""), consumerSecret: toEnvVars(x.consumerSecret ?? ""), tokenKey: toEnvVars(x.token ?? ""), tokenSecret: toEnvVars(x.tokenSecret ?? ""), signatureMethod: x.signatureMethod || "HMAC-SHA1", realm: x.realm ?? "", verifier: x.verifier ?? "" };
  } else if (a.type === "oauth2") {
    const x = a.extra ?? {};
    authentication = {
      type: "oauth2",
      grantType: x.grantType === "password" ? "password" : "client_credentials",
      accessTokenUrl: toEnvVars(x.accessTokenUrl ?? ""),
      clientId: toEnvVars(x.clientId ?? ""),
      clientSecret: toEnvVars(x.clientSecret ?? ""),
      scope: x.scope ?? "",
      username: toEnvVars(a.username ?? ""),
      password: toEnvVars(a.password ?? ""),
      credentialsInBody: x.credentialsIn !== "basic",
    };
  }
  return {
    url: toEnvVars(n.url),
    name: n.name,
    meta: meta("req"),
    method: n.method,
    ...(body ? { body } : {}),
    headers: n.headers.map((h) => ({ name: h.key, value: toEnvVars(h.value), ...(h.enabled ? {} : { disabled: true }) })),
    ...(authentication ? { authentication } : {}),
  };
}

/** YAML v5 de colección. */
export function exportYaml(root: TreeNode, globals: KV[]): string {
  const own = root.type === "folder" ? root.variables ?? [] : [];
  const have = new Set(own.map((v) => v.key));
  const vars = [...own, ...globals.filter((v) => !have.has(v.key))].filter((v) => v.enabled && v.key);
  const stamp = Date.now();
  const doc = {
    type: "collection.insomnia.rest/5.0",
    name: root.name,
    meta: { id: rid("wrk"), created: stamp, modified: stamp },
    collection: (root.type === "folder" ? root.children : [root]).map(insNodeOut),
    cookieJar: { name: "Default Jar", meta: { id: rid("jar"), created: stamp, modified: stamp } },
    environments: {
      name: "Base Environment",
      meta: { id: rid("env"), created: stamp, modified: stamp, isPrivate: false },
      data: Object.fromEntries(vars.map((v) => [v.key, v.value])),
    },
  };
  return YAML.stringify(doc);
}

export const exportExt = (f: ExportFormat) => (f === "yaml" ? "yaml" : f === "har" ? "har" : "json");

export function exportFileName(name: string, f: ExportFormat): string {
  const base = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "coleccion";
  return f === "json" ? `${base}.json` : f === "yaml" ? `${base}.yaml` : `${base}.har`;
}
