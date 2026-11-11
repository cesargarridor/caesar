import type { BodyData, KV } from "../types";

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`; // comillas simples seguras para bash

/** Genera un cURL con el mismo formato que exporta Postman (--location, --header, --form …). */
export function generateCurl(a: { method: string; url: string; headers: KV[]; body: BodyData }): string {
  const lines: string[] = [];
  const method = a.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const headers = a.headers.filter((h) => h.enabled && h.key.trim());
  const hasCt = headers.some((h) => h.key.toLowerCase() === "content-type");

  const first = [`curl --location`];
  if (method !== "GET" && method !== "POST") first.push(method === "HEAD" ? "--head" : `--request ${method}`);
  first.push(sq(a.url));
  lines.push(first.join(" "));

  for (const h of headers) {
    // el boundary lo calcula el cliente al enviar
    const v = /multipart\/form-data/i.test(h.value) && !/boundary=/i.test(h.value)
      ? `${h.value}; boundary=<calculated when request is sent>`
      : h.value;
    lines.push(`--header ${sq(`${h.key}: ${v}`)}`);
  }

  const b = a.body;
  if (hasBody && b.mode === "formdata" && b.formdata.some((f) => f.enabled && f.key)) {
    if (!hasCt) lines.push(`--header ${sq("Content-Type: multipart/form-data; boundary=<calculated when request is sent>")}`);
    for (const f of b.formdata.filter((x) => x.enabled && x.key)) {
      const type = f.contentType?.trim() ? `;type=${f.contentType.trim()}` : "";
      if (f.kind === "file") {
        lines.push(`--form ${sq(`${f.key}=@"${(f.path || f.value).replace(/\\/g, "/")}"${type}`)}`);
      } else {
        lines.push(`--form ${sq(`${f.key}="${f.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"${type}`)}`);
      }
    }
  } else if (hasBody && b.mode === "urlencoded" && b.urlencoded.some((f) => f.enabled && f.key)) {
    if (!hasCt) lines.push(`--header ${sq("Content-Type: application/x-www-form-urlencoded")}`);
    for (const f of b.urlencoded.filter((x) => x.enabled && x.key)) {
      lines.push(`--data-urlencode ${sq(`${f.key}=${f.value}`)}`);
    }
  } else if (hasBody && (b.mode === "json" || b.mode === "text") && b.raw.trim()) {
    if (!hasCt) lines.push(`--header ${sq(b.mode === "json" ? "Content-Type: application/json" : "Content-Type: text/plain")}`);
    lines.push(`--data ${sq(b.raw)}`);
  }

  return lines.join(" \\\n");
}
