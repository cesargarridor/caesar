import type { AuthData, BodyData, KV, RequestNode, TreeNode } from "../types";

/** Exporta un árbol de Caesar a Postman Collection v2.1 (JSON). */

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

export function exportCollection(root: TreeNode, vars: KV[]): string {
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
  (name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "coleccion") + ".postman_collection.json";
