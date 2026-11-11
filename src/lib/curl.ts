import type { AuthData, BodyData, KV, RequestState } from "../types";
import { parseQuery, splitUrl } from "./url";

export const emptyAuth = (): AuthData => ({
  type: "none",
  token: "",
  username: "",
  password: "",
  key: "",
  value: "",
  in: "header",
});

export const emptyBody = (): BodyData => ({ mode: "none", raw: "", formdata: [], urlencoded: [] });

export const defaultSettings = () => ({ followRedirects: true, timeoutSecs: 30, verifySsl: true });

export const emptyRequest = (): RequestState => ({
  method: "GET",
  url: "",
  params: [],
  headers: [],
  auth: emptyAuth(),
  body: emptyBody(),
  settings: defaultSettings(),
  tests: "",
});

export const looksLikeCurl = (s: string) => /^\s*curl(\.exe)?\s/i.test(s);

/** Tokeniza al estilo shell (bash y cmd de "Copy as cURL"). */
function tokenize(input: string): string[] {
  let s = input;
  if (/\^"/.test(s)) {
    // "Copy as cURL (cmd)" de Chrome escapa con ^
    s = s.replace(/\^\\\^"/g, '\\"').replace(/\^([\s\S])/g, "$1");
  }
  s = s.replace(/\\\r?\n/g, " ").replace(/`\r?\n/g, " ");
  // Un pegado de varias líneas dentro de un <input> pierde los saltos: "\ -H" -> " -H"
  s = s.replace(/\\\s+(?=-)/g, " ");

  const tokens: string[] = [];
  let cur = "";
  let has = false;
  const push = () => {
    if (has) tokens.push(cur);
    cur = "";
    has = false;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      push();
    } else if (c === "'") {
      has = true;
      const end = s.indexOf("'", i + 1);
      const stop = end < 0 ? s.length : end;
      cur += s.slice(i + 1, stop);
      i = stop;
    } else if (c === '"') {
      has = true;
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else {
          cur += s[i++];
        }
      }
    } else if (c === "$" && s[i + 1] === "'") {
      has = true;
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === "\\" && i + 1 < s.length) {
          const n = s[i + 1];
          if (n === "n") cur += "\n";
          else if (n === "t") cur += "\t";
          else if (n === "r") cur += "\r";
          else if (n === "x" && /^[0-9a-fA-F]{2}/.test(s.slice(i + 2, i + 4))) {
            cur += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16));
            i += 2;
          } else if (n === "u" && /^[0-9a-fA-F]{4}/.test(s.slice(i + 2, i + 6))) {
            cur += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
            i += 4;
          } else cur += n;
          i += 2;
        } else {
          cur += s[i++];
        }
      }
    } else if (c === "\\" && i + 1 < s.length) {
      has = true;
      cur += s[++i];
    } else {
      has = true;
      cur += c;
    }
  }
  push();
  return tokens;
}

const VALUE_FLAGS = new Set([
  "-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-ascii",
  "--data-urlencode", "-F", "--form", "--form-string", "-u", "--user", "-b", "--cookie", "-A", "--user-agent",
  "-e", "--referer", "--url", "-o", "--output", "-m", "--max-time", "--connect-timeout", "-x", "--proxy",
  "-w", "--write-out", "-T", "--upload-file", "--cacert", "-E", "--cert", "--key", "--retry", "-K", "--config",
  "--resolve", "--json", "-c", "--cookie-jar", "--proxy-user", "-U", "--limit-rate", "--max-redirs",
]);

/** Valor de -F: key="texto" (con \" escapados) o key=@"ruta" para archivos. */
function parseFormField(key: string, raw: string): KV {
  const typeOf = (s: string) => s.match(/;\s*type=([\w.+*/-]+)\s*$/)?.[1] ?? "";
  if (raw.startsWith("@") || raw.startsWith("<")) {
    const contentType = typeOf(raw);
    let p = raw.slice(1).replace(/;\s*type=.*$/, "");
    if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
    const name = p.split(/[\\/]/).pop() ?? p;
    // La ruta se conserva para mostrarla, pero hay que reseleccionar el archivo (permiso de Rust).
    return { key, value: name, enabled: true, kind: "file", path: "", contentType };
  }
  let v = raw;
  let contentType = "";
  if (v.startsWith('"') && /"\s*;\s*type=[\w.+*/-]+\s*$/.test(v)) {
    contentType = typeOf(v);
    v = v.replace(/\s*;\s*type=[\w.+*/-]+\s*$/, "");
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(["\\])/g, "$1");
  return { key, value: v, enabled: true, kind: "text", contentType };
}

const decodeQ = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

export function parseCurl(input: string): RequestState {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0 || !/^curl(\.exe)?$/i.test(tokens[0])) {
    throw new Error("No parece un comando cURL");
  }

  let method: string | null = null;
  let url = "";
  const headers: KV[] = [];
  const datas: string[] = [];
  const forms: KV[] = [];
  let basic: { u: string; p: string } | null = null;
  let head = false;
  let getMode = false;
  let insecure = false;
  let follow = true;
  let timeout = 30;

  for (let i = 1; i < tokens.length; i++) {
    let t = tokens[i];
    let inline: string | null = null;

    if (t.startsWith("--") && t.includes("=")) {
      const eq = t.indexOf("=");
      inline = t.slice(eq + 1);
      t = t.slice(0, eq);
    } else if (/^-[A-Za-z]./.test(t) && !t.startsWith("--")) {
      const flag = t.slice(0, 2);
      if (VALUE_FLAGS.has(flag)) {
        inline = t.slice(2);
        t = flag;
      }
    }

    const next = () => (inline !== null ? inline : tokens[++i] ?? "");

    switch (t) {
      case "-X":
      case "--request":
        method = next().toUpperCase();
        break;
      case "-H":
      case "--header": {
        const h = next();
        const c = h.indexOf(":");
        if (c > 0) headers.push({ key: h.slice(0, c).trim(), value: h.slice(c + 1).trim(), enabled: true });
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        datas.push(next());
        break;
      case "--json":
        datas.push(next());
        if (!headers.some((h) => h.key.toLowerCase() === "content-type"))
          headers.push({ key: "Content-Type", value: "application/json", enabled: true });
        break;
      case "--data-urlencode": {
        const v = next();
        const eq = v.indexOf("=");
        datas.push(eq < 0 ? encodeURIComponent(v) : `${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`);
        break;
      }
      case "-F":
      case "--form":
      case "--form-string": {
        const v = next();
        const eq = v.indexOf("=");
        if (eq > 0) forms.push(parseFormField(v.slice(0, eq), v.slice(eq + 1)));
        break;
      }
      case "-u":
      case "--user": {
        const v = next();
        const c = v.indexOf(":");
        basic = c < 0 ? { u: v, p: "" } : { u: v.slice(0, c), p: v.slice(c + 1) };
        break;
      }
      case "-b":
      case "--cookie":
        headers.push({ key: "Cookie", value: next(), enabled: true });
        break;
      case "-A":
      case "--user-agent":
        headers.push({ key: "User-Agent", value: next(), enabled: true });
        break;
      case "-e":
      case "--referer":
        headers.push({ key: "Referer", value: next(), enabled: true });
        break;
      case "--url":
        url = next();
        break;
      case "-m":
      case "--max-time": {
        const n = parseFloat(next());
        if (!isNaN(n) && n > 0) timeout = Math.ceil(n);
        break;
      }
      case "-I":
      case "--head":
        head = true;
        break;
      case "-G":
      case "--get":
        getMode = true;
        break;
      case "-k":
      case "--insecure":
        insecure = true;
        break;
      case "-L":
      case "--location":
        follow = true;
        break;
      default:
        if (VALUE_FLAGS.has(t)) next(); // flag con valor que no usamos
        else if (!t.startsWith("-") && !url) url = t;
    }
  }

  if (!url) throw new Error("El cURL no contiene ninguna URL");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;

  const { base, query } = splitUrl(url);
  const params = query === null ? [] : parseQuery(query);

  // -G: los datos pasan a la query
  if (getMode && datas.length) {
    params.push(...datas.join("&").split("&").map((p) => {
      const eq = p.indexOf("=");
      return { key: decodeQ(eq < 0 ? p : p.slice(0, eq)), value: decodeQ(eq < 0 ? "" : p.slice(eq + 1)), enabled: true };
    }));
    datas.length = 0;
  }

  const auth = emptyAuth();
  const authIdx = headers.findIndex((h) => h.key.toLowerCase() === "authorization" && /^bearer\s/i.test(h.value));
  if (authIdx >= 0) {
    auth.type = "bearer";
    auth.token = headers[authIdx].value.replace(/^bearer\s+/i, "");
    headers.splice(authIdx, 1);
  } else if (basic) {
    auth.type = "basic";
    auth.username = basic.u;
    auth.password = basic.p;
  }

  if (forms.length) {
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i].key.toLowerCase() === "content-type" && /multipart\/form-data/i.test(headers[i].value)) headers.splice(i, 1);
    }
  }

  const ct = headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
  const body = emptyBody();
  if (forms.length) {
    body.mode = "formdata";
    body.formdata = forms;
  } else if (datas.length) {
    const raw = datas.join("&");
    const t = raw.trim();
    if (ct.includes("json") || (!ct && /^[[{]/.test(t))) {
      body.mode = "json";
      try {
        body.raw = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        body.raw = raw;
      }
    } else if (ct.includes("x-www-form-urlencoded") || (!ct && /^[^=\s{[]+=/.test(t))) {
      body.mode = "urlencoded";
      body.urlencoded = raw.split("&").map((p) => {
        const eq = p.indexOf("=");
        return { key: decodeQ(eq < 0 ? p : p.slice(0, eq)), value: decodeQ(eq < 0 ? "" : p.slice(eq + 1)), enabled: true };
      });
    } else {
      body.mode = "text";
      body.raw = raw;
    }
  }

  const finalMethod = method ?? (head ? "HEAD" : datas.length || forms.length ? "POST" : "GET");

  return {
    method: finalMethod,
    url: base,
    params,
    headers,
    auth,
    body,
    settings: { followRedirects: follow, timeoutSecs: timeout, verifySsl: !insecure },
  };
}
