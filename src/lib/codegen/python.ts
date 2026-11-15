import type { Lang, SnippetInput as In, SnippetOptions as O } from "./types.ts";
import { baseName, esc, formBody, fwd, ind, joinLines, splitUrl, withoutHeader } from "./util.ts";

const py = (s: string) => esc(s);

function dict(name: string, pairs: [string, string][], I: string): string[] {
  if (!pairs.length) return [`${name} = {}`];
  return [`${name} = {`, ...pairs.map(([k, v]) => `${I}${py(k)}: ${py(v)},`), "}"];
}

function requestsGen(i: In, o: O): string {
  const I = ind(o);
  const out: string[] = ["import requests", "", `url = ${py(i.url)}`, ""];
  const b = i.body;
  const args: string[] = ["url", "headers=headers"];
  let headers = i.headers;
  if (b.kind === "raw") {
    out.push(`payload = ${py(b.text)}`);
    args.push("data=payload");
  } else if (b.kind === "urlencoded") {
    out.push(...dict("payload", b.fields.map((f) => [f.key, f.value]), I));
    args.push("data=payload");
  } else if (b.kind === "formdata") {
    const texts = b.fields.filter((f) => !f.file);
    const files = b.fields.filter((f) => f.file);
    out.push(...dict("payload", texts.map((f) => [f.key, f.value]), I));
    if (files.length) {
      out.push("files = [");
      for (const f of files) out.push(`${I}(${py(f.key)}, (${py(baseName(f.path))}, open(${py(fwd(f.path))}, 'rb'), ${py(f.contentType || "application/octet-stream")})),`);
      out.push("]");
      args.push("files=files");
    }
    args.push("data=payload");
    headers = withoutHeader(i, "content-type");
  }
  out.push(...dict("headers", headers.map((h) => [h.key, h.value]), I), "");
  if (o.timeout > 0) args.push(`timeout=${o.timeout}`);
  if (!o.follow) args.push("allow_redirects=False");
  out.push(`response = requests.request(${py(i.method)}, ${args.join(", ")})`, "", "print(response.text)");
  return joinLines(out);
}

function httpClientGen(i: In, o: O): string {
  const I = ind(o);
  const u = splitUrl(i.url);
  const cls = u.scheme === "http" ? "HTTPConnection" : "HTTPSConnection";
  const b = i.body;
  const out: string[] = ["import http.client"];
  let headers = i.headers;
  let payload = "''";
  if (b.kind === "formdata") out.push("");
  out.push("");
  const conn = [py(u.host)];
  if (u.port) conn.push(u.port);
  if (o.timeout > 0) conn.push(`timeout=${o.timeout}`);
  out.push(`conn = http.client.${cls}(${conn.join(", ")})`);
  if (b.kind === "raw") {
    out.push(`payload = ${py(b.text)}`);
    payload = "payload";
  } else if (b.kind === "urlencoded") {
    out.push(`payload = ${py(formBody(b.fields))}`);
    payload = "payload";
  } else if (b.kind === "formdata") {
    out.push('boundary = "----CaesarFormBoundary"', "payload = b''");
    for (const f of b.fields) {
      const ct = f.contentType || "application/octet-stream";
      if (f.file) {
        out.push(`payload += ('--' + boundary + '\\r\\nContent-Disposition: form-data; name=' + ${py(py(f.key))} + '; filename=' + ${py(py(baseName(f.path)))} + '\\r\\nContent-Type: ${ct}\\r\\n\\r\\n').encode('utf-8')`);
        out.push(`payload += open(${py(fwd(f.path))}, 'rb').read() + b'\\r\\n'`);
      } else {
        out.push(`payload += ('--' + boundary + '\\r\\nContent-Disposition: form-data; name=' + ${py(py(f.key))} + '\\r\\n\\r\\n' + ${py(f.value)} + '\\r\\n').encode('utf-8')`);
      }
    }
    out.push("payload += ('--' + boundary + '--\\r\\n').encode('utf-8')");
    payload = "payload";
    headers = [...withoutHeader(i, "content-type"), { key: "Content-Type", value: "multipart/form-data; boundary=----CaesarFormBoundary" }];
  }
  out.push(...dict("headers", headers.map((h) => [h.key, h.value]), I));
  out.push(`conn.request(${py(i.method)}, ${py(u.path)}, ${payload}, headers)`, "res = conn.getresponse()", "data = res.read()", 'print(data.decode("utf-8"))');
  return joinLines(out);
}

export const PYTHON_LANGS: Lang[] = [
  { id: "py-requests", label: "Python - Requests", hl: "hash", ext: "py", opts: ["indent", "timeout", "follow"], gen: requestsGen },
  { id: "py-http", label: "Python - http.client", hl: "hash", ext: "py", opts: ["indent", "timeout"], gen: httpClientGen },
];
