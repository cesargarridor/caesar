import { generateCurl } from "../curlOut.ts";
import { DEFAULT_OPTIONS, type Lang, type SnippetInput, type SnippetOptions } from "./types.ts";
import { WEB_LANGS } from "./web.ts";
import { PYTHON_LANGS } from "./python.ts";
import { JVM_LANGS } from "./jvm.ts";
import { DOTNET_LANGS } from "./dotnet.ts";
import { NATIVE_LANGS } from "./native.ts";
import { SCRIPT_LANGS } from "./scripting.ts";
import { RAW_LANGS } from "./raw.ts";

export { DEFAULT_OPTIONS };
export { fromArgs } from "./input.ts";
export type { Lang, SnippetInput, SnippetOptions };

const curlLang: Lang = {
  id: "curl",
  label: "cURL",
  hl: "curl",
  ext: "sh",
  opts: [],
  gen: (i) =>
    generateCurl({
      method: i.method,
      url: i.url,
      headers: i.headers.map((h) => ({ ...h, enabled: true })),
      body: {
        mode: i.body.kind === "raw" ? "text" : i.body.kind === "none" ? "none" : i.body.kind,
        raw: i.body.kind === "raw" ? i.body.text : "",
        formdata: i.body.kind === "formdata" ? i.body.fields.map((f) => ({ key: f.key, value: f.value, enabled: true, kind: f.file ? "file" : "text", path: f.path, contentType: f.contentType })) : [],
        urlencoded: i.body.kind === "urlencoded" ? i.body.fields.map((f) => ({ ...f, enabled: true })) : [],
      },
    }),
};

/** Todos los generadores, en el orden del desplegable. */
export const LANGS: Lang[] = [
  curlLang,
  ...WEB_LANGS.filter((l) => l.id === "js-fetch" || l.id === "js-xhr"),
  ...WEB_LANGS.filter((l) => l.id.startsWith("node")),
  ...PYTHON_LANGS,
  ...NATIVE_LANGS.filter((l) => l.id === "go"),
  ...JVM_LANGS.filter((l) => l.id.startsWith("java")),
  ...SCRIPT_LANGS.filter((l) => l.id === "php-curl"),
  ...DOTNET_LANGS,
  ...SCRIPT_LANGS.filter((l) => l.id === "ruby"),
  ...NATIVE_LANGS.filter((l) => l.id === "swift"),
  ...JVM_LANGS.filter((l) => l.id === "kotlin-okhttp"),
  ...NATIVE_LANGS.filter((l) => l.id === "dart" || l.id === "rust"),
  ...SCRIPT_LANGS.filter((l) => l.id === "powershell"),
  ...RAW_LANGS,
];

export const langById = (id: string): Lang => LANGS.find((l) => l.id === id) ?? LANGS[0];

export function generateSnippet(langId: string, input: SnippetInput, opts: Partial<SnippetOptions> = {}): string {
  return langById(langId).gen(input, { ...DEFAULT_OPTIONS, ...opts });
}
