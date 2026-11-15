import type { Lang, SnippetInput as In } from "./types.ts";
import { baseName, formBody, fwd, headerOf, joinLines, splitUrl, withoutHeader } from "./util.ts";

const BOUNDARY = "----CaesarFormBoundary";
const bytes = (s: string) => new TextEncoder().encode(s).length;

function httpGen(i: In): string {
  const u = splitUrl(i.url);
  const b = i.body;
  const host = u.port && !["80", "443"].includes(u.port) ? `${u.host}:${u.port}` : u.host;
  let headers = i.headers;
  let body = "";
  if (b.kind === "raw") body = b.text;
  else if (b.kind === "urlencoded") body = formBody(b.fields);
  else if (b.kind === "formdata") {
    headers = [...withoutHeader(i, "content-type"), { key: "Content-Type", value: `multipart/form-data; boundary=${BOUNDARY}` }];
    const parts = b.fields.map((f) =>
      f.file
        ? `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${f.key}"; filename="${baseName(f.path)}"\r\nContent-Type: ${f.contentType || "application/octet-stream"}\r\n\r\n<contents of ${fwd(f.path)}>\r\n`
        : `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value}\r\n`,
    );
    body = parts.join("") + `--${BOUNDARY}--\r\n`;
  }
  const L = [`${i.method.toUpperCase()} ${u.path} HTTP/1.1`];
  if (headerOf(i, "host") === undefined) L.push(`Host: ${host}`);
  for (const h of headers) L.push(`${h.key}: ${h.value}`);
  if (b.kind !== "none" && headerOf(i, "content-length") === undefined) L.push(`Content-Length: ${bytes(body)}`);
  return joinLines(L) + (b.kind !== "none" ? `\n\n${body.replace(/\r\n/g, "\n")}` : "");
}

export const RAW_LANGS: Lang[] = [{ id: "http", label: "HTTP", hl: "none", ext: "http", opts: [], gen: (i) => httpGen(i) }];
