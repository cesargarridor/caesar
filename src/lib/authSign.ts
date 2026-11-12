// Autenticaciones que firman o negocian la petición: Digest, NTLM, OAuth 1.0, OAuth 2.0, WSSE, AWS Signature v4 y
// Akamai EdgeGrid. Bearer, Basic y API Key son sencillas y se aplican en request.ts.
// Todo se calcula en la interfaz con WebCrypto; cuando hace falta hablar con el servidor (Digest, NTLM, token de
// OAuth 2.0) se usa la misma función `exec` que envía las peticiones normales (la red sigue siendo solo de Rust).
import type { AuthData, BodyData, KV, ResponseData, Settings } from "../types";
import { concat, fromBase64, hmacMd5, hmacSha, md4, md5, randomBytes, sha, toBase64, toHex, utf8 } from "./hash";
import { substitute } from "./request";

export interface ExecArgs {
  method: string;
  url: string;
  headers: KV[];
  body: BodyData;
  settings: Settings;
  /** Misma sesión = misma conexión HTTP (NTLM). */
  session?: string;
}
export type Exec = (a: ExecArgs) => Promise<ResponseData>;

/** Tipos que necesitan este módulo (los demás los resuelve request.ts). */
export const SIGNED_TYPES = ["digest", "ntlm", "oauth1", "oauth2", "wsse", "awsv4", "akamai"];

// ───────────── utilidades ─────────────

const setHeader = (headers: KV[], key: string, value: string): KV[] => [
  ...headers.filter((h) => h.key.toLowerCase() !== key.toLowerCase()),
  { key, value, enabled: true },
];
const getHeader = (headers: KV[], key: string) =>
  headers.find((h) => h.enabled && h.key.toLowerCase() === key.toLowerCase())?.value;

/** RFC 3986 (lo que exigen OAuth 1.0 y AWS). */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** application/x-www-form-urlencoded como lo serializa Rust (espacio = +). */
const formEncode = (s: string) => encodeURIComponent(s).replace(/%20/g, "+").replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const hasBody = (a: ExecArgs) => !/^(GET|HEAD)$/i.test(a.method);

/** Cuerpo en texto tal como lo enviará Rust; null = multipart (no se puede firmar). */
function bodyText(a: ExecArgs): string | null {
  if (!hasBody(a)) return "";
  switch (a.body.mode) {
    case "json":
    case "text":
      return a.body.raw.trim() ? a.body.raw : "";
    case "urlencoded":
      return a.body.urlencoded
        .filter((k) => k.enabled && k.key)
        .map((k) => `${formEncode(k.key)}=${formEncode(k.value)}`)
        .join("&");
    case "formdata":
      return a.body.formdata.some((k) => k.enabled && k.key) ? null : "";
    default:
      return "";
  }
}

const authErr = (m: string) => new Error(m);

// ───────────── entrada principal ─────────────

export async function signRequest(auth: AuthData, args: ExecArgs, vars: KV[], exec: Exec): Promise<ExecArgs> {
  const x = auth.extra ?? {};
  const sub = (s: string | undefined) => substitute(s ?? "", vars);
  switch (auth.type) {
    case "wsse":
      return wsse(args, sub(auth.username), sub(auth.password));
    case "awsv4":
      return awsV4(args, { ak: sub(x.accessKey), sk: sub(x.secretKey), token: sub(x.sessionToken), region: sub(x.region), service: sub(x.service) });
    case "oauth1":
      return oauth1(args, {
        ck: sub(x.consumerKey), cs: sub(x.consumerSecret), tk: sub(x.token), ts: sub(x.tokenSecret),
        method: x.signatureMethod || "HMAC-SHA1", realm: sub(x.realm), verifier: sub(x.verifier), addTo: x.addTo === "query" ? "query" : "header",
      });
    case "akamai":
      return akamai(args, {
        clientToken: sub(x.clientToken), accessToken: sub(x.accessToken), clientSecret: sub(x.clientSecret),
        headersToSign: sub(x.headersToSign), nonce: sub(x.nonce), timestamp: sub(x.timestamp), maxBody: Number(x.maxBody) || 131072,
      });
    case "oauth2":
      return oauth2(args, auth, sub, exec);
    case "digest":
      return digest(args, sub(auth.username), sub(auth.password), exec);
    case "ntlm":
      return ntlm(args, { user: sub(auth.username), pass: sub(auth.password), domain: sub(x.domain), workstation: sub(x.workstation) }, exec);
    default:
      return args;
  }
}

// ───────────── WSSE ─────────────

async function wsse(a: ExecArgs, user: string, pass: string): Promise<ExecArgs> {
  const nonce = toHex(randomBytes(16));
  const created = new Date().toISOString();
  const digest = toBase64(await sha("SHA-1", nonce + created + pass));
  let h = setHeader(a.headers, "Authorization", 'WSSE profile="UsernameToken"');
  h = setHeader(h, "X-WSSE", `UsernameToken Username="${user}", PasswordDigest="${digest}", Nonce="${nonce}", Created="${created}"`);
  return { ...a, headers: h };
}

// ───────────── AWS Signature v4 ─────────────

async function awsV4(a: ExecArgs, c: { ak: string; sk: string; token: string; region: string; service: string }): Promise<ExecArgs> {
  if (!c.ak || !c.sk) throw authErr("AWS Sig v4: faltan Access Key ID y Secret Access Key.");
  const u = new URL(a.url);
  // Servicio y región: los que se hayan escrito o, si no, los del host (servicio.región.amazonaws.com).
  const labels = u.hostname.split(".");
  const ri = labels.findIndex((l) => /^[a-z]{2}(?:-[a-z]+)+-[0-9]$/.test(l));
  const service = c.service || (ri > 0 ? labels[ri - 1] : u.hostname.endsWith("amazonaws.com") ? labels[0] : "") || "execute-api";
  const region = c.region || (ri > 0 ? labels[ri] : "") || "us-east-1";
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);

  const text = bodyText(a);
  const payloadHash = text === null ? "UNSIGNED-PAYLOAD" : toHex(await sha("SHA-256", text));
  let h = setHeader(a.headers, "X-Amz-Date", now);
  h = setHeader(h, "X-Amz-Content-Sha256", payloadHash);
  if (c.token) h = setHeader(h, "X-Amz-Security-Token", c.token);

  const signed: [string, string][] = [["host", u.host]];
  for (const k of h) {
    const n = k.key.toLowerCase();
    if (k.enabled && (n.startsWith("x-amz-") || n === "content-type")) signed.push([n, k.value.trim().replace(/\s+/g, " ")]);
  }
  signed.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
  const signedNames = signed.map((s) => s[0]).join(";");
  const canonHeaders = signed.map(([k, v]) => `${k}:${v}\n`).join("");

  const path = u.pathname
    .split("/")
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join("/") || "/";
  const query = [...u.searchParams]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort((p, q) => (p[0] === q[0] ? (p[1] < q[1] ? -1 : 1) : p[0] < q[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [a.method.toUpperCase(), path, query, canonHeaders, signedNames, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, toHex(await sha("SHA-256", canonical))].join("\n");

  let key = await hmacSha("SHA-256", "AWS4" + c.sk, day);
  for (const part of [region, service, "aws4_request"]) key = await hmacSha("SHA-256", key, part);
  const signature = toHex(await hmacSha("SHA-256", key, toSign));
  h = setHeader(h, "Authorization", `AWS4-HMAC-SHA256 Credential=${c.ak}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`);
  return { ...a, headers: h };
}

// ───────────── OAuth 1.0 ─────────────

async function oauth1(
  a: ExecArgs,
  c: { ck: string; cs: string; tk: string; ts: string; method: string; realm: string; verifier: string; addTo: "header" | "query" },
): Promise<ExecArgs> {
  if (!c.ck) throw authErr("OAuth 1.0: falta la Consumer Key.");
  const u = new URL(a.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.ck,
    oauth_signature_method: c.method,
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: toHex(randomBytes(16)),
    oauth_version: "1.0",
  };
  if (c.tk) oauth.oauth_token = c.tk;
  if (c.verifier) oauth.oauth_verifier = c.verifier;

  const params: [string, string][] = [...u.searchParams];
  if (hasBody(a) && a.body.mode === "urlencoded") {
    for (const k of a.body.urlencoded) if (k.enabled && k.key) params.push([k.key, k.value]);
  }
  for (const [k, v] of Object.entries(oauth)) params.push([k, v]);
  const norm = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort((p, q) => (p[0] === q[0] ? (p[1] < q[1] ? -1 : 1) : p[0] < q[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  const baseString = [a.method.toUpperCase(), rfc3986(base), rfc3986(norm)].join("&");
  const key = `${rfc3986(c.cs)}&${rfc3986(c.ts)}`;

  let signature: string;
  if (c.method === "PLAINTEXT") signature = key;
  else if (c.method === "HMAC-SHA256") signature = toBase64(await hmacSha("SHA-256", key, baseString));
  else signature = toBase64(await hmacSha("SHA-1", key, baseString));
  oauth.oauth_signature = signature;

  if (c.addTo === "query") {
    for (const [k, v] of Object.entries(oauth)) u.searchParams.append(k, v);
    return { ...a, url: u.toString() };
  }
  const parts = Object.entries(oauth).map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`);
  if (c.realm) parts.unshift(`realm="${c.realm}"`);
  return { ...a, headers: setHeader(a.headers, "Authorization", `OAuth ${parts.join(", ")}`) };
}

// ───────────── Akamai EdgeGrid ─────────────

async function akamai(
  a: ExecArgs,
  c: { clientToken: string; accessToken: string; clientSecret: string; headersToSign: string; nonce: string; timestamp: string; maxBody: number },
): Promise<ExecArgs> {
  if (!c.clientToken || !c.accessToken || !c.clientSecret) throw authErr("Akamai EdgeGrid: faltan Client Token, Access Token o Client Secret.");
  const u = new URL(a.url);
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const timestamp = c.timestamp || `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+0000`;
  const nonce = c.nonce || crypto.randomUUID();
  const authHeader = `EG1-HMAC-SHA256 client_token=${c.clientToken};access_token=${c.accessToken};timestamp=${timestamp};nonce=${nonce};`;

  let contentHash = "";
  if (/^POST$/i.test(a.method)) {
    const text = bodyText(a);
    if (text) contentHash = toBase64(await sha("SHA-256", utf8(text).slice(0, c.maxBody)));
  }
  const canonHeaders = c.headersToSign
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
    .map((n) => `${n}:${(getHeader(a.headers, n) ?? "").trim().replace(/\s+/g, " ")}`)
    .join("\t");
  const data = [a.method.toUpperCase(), u.protocol.replace(":", ""), u.host, u.pathname + u.search, canonHeaders, contentHash, authHeader].join("\t");
  const signingKey = toBase64(await hmacSha("SHA-256", c.clientSecret, timestamp));
  const signature = toBase64(await hmacSha("SHA-256", signingKey, data));
  return { ...a, headers: setHeader(a.headers, "Authorization", `${authHeader}signature=${signature}`) };
}

// ───────────── OAuth 2.0 ─────────────

const tokenCache = new Map<string, { token: string; exp: number }>();

async function oauth2(a: ExecArgs, auth: AuthData, sub: (s?: string) => string, exec: Exec): Promise<ExecArgs> {
  const x = auth.extra ?? {};
  const grant = x.grantType || "manual";
  let token = sub(x.accessToken);

  if (grant !== "manual") {
    const url = sub(x.accessTokenUrl);
    if (!url) throw authErr("OAuth 2.0: falta la URL para pedir el token (Access Token URL).");
    const cfg = { url, grant, id: sub(x.clientId), secret: sub(x.clientSecret), scope: sub(x.scope), user: sub(auth.username), pass: sub(auth.password), cin: x.credentialsIn };
    const ck = JSON.stringify(cfg);
    const hit = tokenCache.get(ck);
    if (hit && hit.exp > Date.now() + 5000) {
      token = hit.token;
    } else {
      const form: KV[] = [{ key: "grant_type", value: grant === "password" ? "password" : "client_credentials", enabled: true }];
      if (cfg.scope) form.push({ key: "scope", value: cfg.scope, enabled: true });
      if (grant === "password") {
        form.push({ key: "username", value: cfg.user, enabled: true }, { key: "password", value: cfg.pass, enabled: true });
      }
      let headers: KV[] = [{ key: "Accept", value: "application/json", enabled: true }];
      if (cfg.cin === "basic") {
        headers = setHeader(headers, "Authorization", `Basic ${toBase64(utf8(`${cfg.id}:${cfg.secret}`))}`);
      } else {
        form.push({ key: "client_id", value: cfg.id, enabled: true }, { key: "client_secret", value: cfg.secret, enabled: true });
      }
      const r = await exec({
        method: "POST",
        url,
        headers,
        body: { mode: "urlencoded", raw: "", formdata: [], urlencoded: form },
        settings: a.settings,
      });
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(r.body);
      } catch {
        /* se informa abajo */
      }
      if (r.status < 200 || r.status >= 300 || typeof json.access_token !== "string") {
        const why = typeof json.error_description === "string" ? json.error_description : typeof json.error === "string" ? json.error : r.body.slice(0, 200);
        throw authErr(`OAuth 2.0: el servidor de tokens respondió ${r.status}${why ? `: ${why}` : ""}`);
      }
      token = json.access_token;
      const secs = Number(json.expires_in);
      tokenCache.set(ck, { token, exp: Date.now() + (Number.isFinite(secs) && secs > 0 ? secs * 1000 : 60_000) });
    }
  }
  if (!token) throw authErr("OAuth 2.0: no hay Access Token.");

  if (x.addTokenTo === "query") {
    const u = new URL(a.url);
    u.searchParams.set("access_token", token);
    return { ...a, url: u.toString() };
  }
  const prefix = sub(x.headerPrefix ?? "Bearer").trim();
  return { ...a, headers: setHeader(a.headers, "Authorization", prefix ? `${prefix} ${token}` : token) };
}

// ───────────── Digest ─────────────

function wwwAuth(r: ResponseData, scheme: string): string | null {
  const re = new RegExp(`^${scheme}\\b`, "i");
  for (const [k, v] of r.headers) if (k.toLowerCase() === "www-authenticate" && re.test(v.trim())) return v.trim();
  return null;
}

function parseChallenge(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/g;
  for (const m of h.replace(/^\w+\s+/, "").matchAll(re)) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3];
  return out;
}

async function digest(a: ExecArgs, user: string, pass: string, exec: Exec): Promise<ExecArgs> {
  const probe = await exec(a);
  const ch = probe.status === 401 ? wwwAuth(probe, "Digest") : null;
  if (!ch) return a; // el servidor no pide Digest: se envía tal cual
  const p = parseChallenge(ch);
  const algo = (p.algorithm || "MD5").toUpperCase();
  const sha256 = algo.startsWith("SHA-256");
  const H = async (s: string) => toHex(sha256 ? await sha("SHA-256", s) : md5(utf8(s)));
  const u = new URL(a.url);
  const uri = u.pathname + u.search;
  const qops = (p.qop ?? "").split(",").map((q) => q.trim());
  const qop = qops.includes("auth") ? "auth" : qops.includes("auth-int") ? "auth-int" : "";
  const nc = "00000001";
  const cnonce = toHex(randomBytes(8));
  let ha1 = await H(`${user}:${p.realm ?? ""}:${pass}`);
  if (algo.endsWith("-SESS")) ha1 = await H(`${ha1}:${p.nonce}:${cnonce}`);
  let ha2 = await H(`${a.method.toUpperCase()}:${uri}`);
  if (qop === "auth-int") ha2 = await H(`${a.method.toUpperCase()}:${uri}:${await H(bodyText(a) ?? "")}`);
  const response = qop ? await H(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : await H(`${ha1}:${p.nonce}:${ha2}`);
  const parts = [`username="${user}"`, `realm="${p.realm ?? ""}"`, `nonce="${p.nonce}"`, `uri="${uri}"`, `algorithm=${p.algorithm || "MD5"}`, `response="${response}"`];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (p.opaque) parts.push(`opaque="${p.opaque}"`);
  return { ...a, headers: setHeader(a.headers, "Authorization", `Digest ${parts.join(", ")}`) };
}

// ───────────── NTLM (NTLMv2) ─────────────

const u16 = (s: string) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    b[i * 2] = c & 255;
    b[i * 2 + 1] = c >> 8;
  }
  return b;
};
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const le16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255]);
const secBuf = (len: number, off: number) => concat(le16(len), le16(len), le32(off));
const SIG = utf8("NTLMSSP\0");

async function ntlm(a: ExecArgs, c: { user: string; pass: string; domain: string; workstation: string }, exec: Exec): Promise<ExecArgs> {
  if (!c.user) throw authErr("NTLM: falta el usuario.");
  const session = crypto.randomUUID();
  // Usuario como DOMINIO\usuario o usuario@dominio.
  let { user, domain } = c;
  if (!domain && user.includes("\\")) [domain, user] = user.split("\\", 2);

  // 1.ª vuelta: mensaje Tipo 1 (sin cuerpo)
  const type1 = concat(SIG, le32(1), le32(0xa0088207), secBuf(0, 32), secBuf(0, 32));
  const r1 = await exec({
    ...a,
    method: a.method,
    headers: setHeader(a.headers, "Authorization", `NTLM ${toBase64(type1)}`),
    body: { mode: "none", raw: "", formdata: [], urlencoded: [] },
    session,
  });
  const ch = r1.status === 401 ? wwwAuth(r1, "NTLM") : null;
  const tok = ch?.replace(/^NTLM\s*/i, "").trim();
  if (!tok) {
    if (r1.status === 401) throw authErr("NTLM: el servidor no ofreció NTLM (respondió 401 sin desafío NTLM).");
    return { ...a, session };
  }

  // Tipo 2: desafío del servidor
  const t2 = fromBase64(tok);
  const dv = new DataView(t2.buffer, t2.byteOffset, t2.byteLength);
  const serverChallenge = t2.slice(24, 32);
  const flags = dv.getUint32(20, true);
  const tiLen = dv.getUint16(40, true);
  const tiOff = dv.getUint32(44, true);
  const targetInfo = t2.slice(tiOff, tiOff + tiLen);

  // Tipo 3 con NTLMv2
  const ntHash = md4(u16(c.pass));
  const v2Hash = hmacMd5(ntHash, u16(user.toUpperCase() + domain));
  const clientChallenge = randomBytes(8);
  // FILETIME: 100 ns desde 1601
  const ft = BigInt(Date.now() + 11644473600000) * 10000n;
  const ts = new Uint8Array(8);
  new DataView(ts.buffer).setBigUint64(0, ft, true);
  const blob = concat(new Uint8Array([1, 1, 0, 0]), new Uint8Array(4), ts, clientChallenge, new Uint8Array(4), targetInfo, new Uint8Array(4));
  const proof = hmacMd5(v2Hash, concat(serverChallenge, blob));
  const ntResp = concat(proof, blob);
  const lmResp = new Uint8Array(24);
  const ws = u16(c.workstation || "CAESAR");
  const dom = u16(domain);
  const usr = u16(user);
  let off = 64;
  const fields: Uint8Array[] = [];
  const buf = (b: Uint8Array) => {
    const s = secBuf(b.length, off);
    off += b.length;
    fields.push(b);
    return s;
  };
  const lmB = buf(lmResp);
  const ntB = buf(ntResp);
  const domB = buf(dom);
  const usrB = buf(usr);
  const wsB = buf(ws);
  const keyB = secBuf(0, off);
  const type3 = concat(SIG, le32(3), lmB, ntB, domB, usrB, wsB, keyB, le32(flags & 0xa0088207 || 0xa0088205), ...fields);
  return { ...a, headers: setHeader(a.headers, "Authorization", `NTLM ${toBase64(type3)}`), session };
}
