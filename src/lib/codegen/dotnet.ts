import type { Lang, SnippetInput as In, SnippetOptions as O } from "./types.ts";
import { baseName, esc, formBody, fwd, ind, joinLines, mimeOf, withoutHeader } from "./util.ts";

const cs = (s: string) => esc(s);
const KNOWN = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
const pascal = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();

function httpClientGen(i: In, o: O): string {
  const b = i.body;
  const m = i.method.toUpperCase();
  const L: string[] = [];
  const handler = o.follow ? "" : "var handler = new HttpClientHandler { AllowAutoRedirect = false };";
  if (handler) L.push(handler);
  const init = o.timeout > 0 ? ` { Timeout = TimeSpan.FromSeconds(${o.timeout}) }` : "";
  L.push(`var client = new HttpClient(${handler ? "handler" : ""})${init};`);
  L.push(`var request = new HttpRequestMessage(${KNOWN.includes(m) ? `HttpMethod.${pascal(m)}` : `new HttpMethod(${cs(m)})`}, ${cs(i.url)});`);
  for (const h of b.kind === "none" ? i.headers : withoutHeader(i, "content-type")) {
    L.push(`request.Headers.TryAddWithoutValidation(${cs(h.key)}, ${cs(h.value)});`);
  }
  if (b.kind === "raw") {
    L.push(`var content = new StringContent(${cs(b.text)}, Encoding.UTF8, ${cs(mimeOf(i))});`, "request.Content = content;");
  } else if (b.kind === "urlencoded") {
    L.push(`var content = new StringContent(${cs(formBody(b.fields))}, Encoding.UTF8, "application/x-www-form-urlencoded");`, "request.Content = content;");
  } else if (b.kind === "formdata") {
    L.push("var content = new MultipartFormDataContent();");
    for (const f of b.fields) {
      if (f.file) L.push(`content.Add(new ByteArrayContent(File.ReadAllBytes(${cs(fwd(f.path))})), ${cs(f.key)}, ${cs(baseName(f.path))});`);
      else L.push(`content.Add(new StringContent(${cs(f.value)}), ${cs(f.key)});`);
    }
    L.push("request.Content = content;");
  }
  L.push("var response = await client.SendAsync(request);", "response.EnsureSuccessStatusCode();", "Console.WriteLine(await response.Content.ReadAsStringAsync());");
  return joinLines(["using System.Net.Http;", ...(b.kind === "raw" || b.kind === "urlencoded" ? ["using System.Text;"] : []), ...(b.kind === "formdata" ? ["using System.IO;"] : []), "", ...L]);
}

function restSharpGen(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const m = i.method.toUpperCase();
  const L: string[] = [];
  const opts: string[] = [];
  if (o.timeout > 0) opts.push(`${I}Timeout = TimeSpan.FromSeconds(${o.timeout})`);
  if (!o.follow) opts.push(`${I}FollowRedirects = false`);
  L.push(opts.length ? `var options = new RestClientOptions(${cs(i.url)})\n{\n${opts.join(",\n")}\n};` : `var options = new RestClientOptions(${cs(i.url)});`);
  L.push("var client = new RestClient(options);", `var request = new RestRequest("", Method.${KNOWN.includes(m) ? pascal(m) : "Get"});`);
  const headers = b.kind === "none" ? i.headers : withoutHeader(i, "content-type");
  for (const h of headers) L.push(`request.AddHeader(${cs(h.key)}, ${cs(h.value)});`);
  if (b.kind === "raw") L.push(`request.AddStringBody(${cs(b.text)}, ${cs(mimeOf(i))});`);
  else if (b.kind === "urlencoded") {
    for (const f of b.fields) L.push(`request.AddParameter(${cs(f.key)}, ${cs(f.value)});`);
  } else if (b.kind === "formdata") {
    L.push("request.AlwaysMultipartFormData = true;");
    for (const f of b.fields) {
      if (f.file) L.push(`request.AddFile(${cs(f.key)}, ${cs(fwd(f.path))});`);
      else L.push(`request.AddParameter(${cs(f.key)}, ${cs(f.value)});`);
    }
  }
  L.push("RestResponse response = await client.ExecuteAsync(request);", "Console.WriteLine(response.Content);");
  return joinLines(["using RestSharp;", "", ...L]);
}

export const DOTNET_LANGS: Lang[] = [
  { id: "cs-httpclient", label: "C# - HttpClient", hl: "c", ext: "cs", opts: ["timeout", "follow"], gen: httpClientGen },
  { id: "cs-restsharp", label: "C# - RestSharp", hl: "c", ext: "cs", opts: ["indent", "timeout", "follow"], gen: restSharpGen },
];
