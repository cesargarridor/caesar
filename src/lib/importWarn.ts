import type { KV, TreeNode } from "../types";

/** ¿El host es de la red local? Loopback, privada (RFC1918), link-local, CGNAT 100.64/10, ULA fc00::/7, localhost, *.local y nombres sin punto. */
export function isInternalHostname(hostname: string): boolean {
  let h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (!h) return false;
  if (h.includes(":")) {
    const m = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isInternalHostname(m[1]);
    if (h === "::1" || h === "::") return true;
    const first = parseInt(h.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 0 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return h === "localhost" || !h.includes(".") || [".localhost", ".local", ".internal", ".lan", ".localdomain", ".home.arpa"].some((s) => h.endsWith(s));
}

/** Sustituye `{{var}}` con las variables dadas; devuelve null si queda alguna sin resolver. */
function resolve(url: string, vars: KV[]): string | null {
  const map = new Map(vars.filter((v) => v.enabled !== false && v.key).map((v) => [v.key, v.value]));
  let unresolved = false;
  const out = url.trim().replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k: string) => {
    const v = map.get(k);
    if (v === undefined) unresolved = true;
    return v ?? "";
  });
  return unresolved ? null : out;
}

/** ¿Esta URL (con variables ya sustituidas) apunta a la red local? */
export function urlIsLocal(url: string, vars: KV[] = []): boolean {
  const r = resolve(url, vars);
  if (!r) return false;
  try {
    return isInternalHostname(new URL(r).hostname);
  } catch {
    return false;
  }
}

/** Cuántas peticiones de una colección importada apuntan a la red local (usa las variables de la colección para resolver `{{baseUrl}}`). */
export function countLocalRequests(root: TreeNode, extraVars: KV[] = []): number {
  const vars = [...extraVars, ...(root.type === "folder" ? (root.variables ?? []) : [])];
  let n = 0;
  const walk = (node: TreeNode) => {
    if (node.type === "request") {
      if (urlIsLocal(node.url, vars)) n++;
    } else node.children.forEach(walk);
  };
  walk(root);
  return n;
}

/** Texto del aviso tras importar una colección (null si nada apunta a la red local). `t` traduce. */
export function localCollectionWarning(n: number, t: (s: string) => string): string | null {
  return n > 0 ? `${t("Esta colección apunta a red local")}: ${n} ${n === 1 ? t("petición") : t("peticiones")}` : null;
}

/** Aviso tras importar un cURL: red local y/o TLS sin verificar (-k). */
export function localCurlWarning(url: string, verifySsl: boolean, t: (s: string) => string): string | null {
  const parts: string[] = [];
  if (urlIsLocal(url)) parts.push(t("Esta petición apunta a red local"));
  if (!verifySsl) parts.push(t("El cURL desactiva la verificación del certificado (-k)"));
  return parts.length ? parts.join(" · ") : null;
}
