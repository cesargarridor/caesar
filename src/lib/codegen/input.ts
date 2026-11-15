import type { SnippetBody, SnippetInput } from "./types.ts";

interface KvLike { key: string; value: string; enabled: boolean; kind?: "text" | "file"; path?: string; contentType?: string }
/** Forma de lo que devuelve buildExecuteArgs (request.ts). */
export interface ArgsLike {
  method: string;
  url: string;
  headers: KvLike[];
  body: { mode: string; raw: string; formdata: KvLike[]; urlencoded: KvLike[] };
}

/** Normaliza los argumentos de ejecución (ya con auth y variables resueltas) a la entrada del generador. */
export function fromArgs(a: ArgsLike): SnippetInput {
  const method = (a.method || "GET").toUpperCase();
  let headers = a.headers.filter((h) => h.enabled && h.key.trim()).map((h) => ({ key: h.key, value: h.value }));
  const hasCt = () => headers.some((h) => h.key.toLowerCase() === "content-type");
  const canBody = method !== "GET" && method !== "HEAD";
  const b = a.body;
  let body: SnippetBody = { kind: "none" };

  if (canBody && b.mode === "formdata" && b.formdata.some((f) => f.enabled && f.key)) {
    body = {
      kind: "formdata",
      fields: b.formdata.filter((f) => f.enabled && f.key).map((f) => ({
        key: f.key,
        value: f.value,
        file: f.kind === "file",
        path: f.path || f.value,
        contentType: f.contentType?.trim() ?? "",
      })),
    };
    // el boundary lo pone la librería al enviar
    headers = headers.filter((h) => !(h.key.toLowerCase() === "content-type" && /multipart\/form-data/i.test(h.value) && !/boundary=/i.test(h.value)));
  } else if (canBody && b.mode === "urlencoded" && b.urlencoded.some((f) => f.enabled && f.key)) {
    body = { kind: "urlencoded", fields: b.urlencoded.filter((f) => f.enabled && f.key).map((f) => ({ key: f.key, value: f.value })) };
    if (!hasCt()) headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded" });
  } else if (canBody && (b.mode === "json" || b.mode === "text") && b.raw.trim()) {
    body = { kind: "raw", text: b.raw };
    if (!hasCt()) headers.push({ key: "Content-Type", value: b.mode === "json" ? "application/json" : "text/plain" });
  }
  return { method, url: a.url, headers, body };
}
