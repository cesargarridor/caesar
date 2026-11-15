import type { Lang, SnippetInput as In, SnippetOptions as O } from "./types.ts";
import { formBody, fwd, ind, joinLines, psq, splitUrl, sq, withoutHeader } from "./util.ts";

function phpGen(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const L: string[] = ["<?php", "", "$curl = curl_init();", "", "curl_setopt_array($curl, array("];
  const opt: string[] = [
    `CURLOPT_URL => ${sq(i.url)}`,
    "CURLOPT_RETURNTRANSFER => true",
    "CURLOPT_ENCODING => ''",
    "CURLOPT_MAXREDIRS => 10",
    `CURLOPT_TIMEOUT => ${o.timeout > 0 ? o.timeout : 0}`,
    `CURLOPT_FOLLOWLOCATION => ${o.follow ? "true" : "false"}`,
    "CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1",
    `CURLOPT_CUSTOMREQUEST => ${sq(i.method.toUpperCase())}`,
  ];
  let headers = i.headers;
  if (b.kind === "raw") opt.push(`CURLOPT_POSTFIELDS => ${sq(b.text)}`);
  else if (b.kind === "urlencoded") opt.push(`CURLOPT_POSTFIELDS => ${sq(formBody(b.fields))}`);
  else if (b.kind === "formdata") {
    const parts = b.fields.map((f) => `${I}${I}${sq(f.key)} => ${f.file ? `new CURLFILE(${sq(fwd(f.path))}${f.contentType ? `, ${sq(f.contentType)}` : ""})` : sq(f.value)}`);
    opt.push(`CURLOPT_POSTFIELDS => array(\n${parts.join(",\n")}\n${I})`);
    headers = withoutHeader(i, "content-type");
  }
  if (headers.length) opt.push(`CURLOPT_HTTPHEADER => array(\n${headers.map((h) => `${I}${I}${sq(`${h.key}: ${h.value}`)}`).join(",\n")}\n${I})`);
  L.push(opt.map((x) => I + x).join(",\n") + ",", "));", "", "$response = curl_exec($curl);", "", "curl_close($curl);", "echo $response;");
  return joinLines(L);
}

const RUBY_CLASSES = ["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "Trace"];

function rubyGen(i: In, o: O): string {
  const b = i.body;
  const m = i.method.toUpperCase();
  const L: string[] = ['require "uri"', 'require "net/http"', "", `url = URI(${sq(i.url)})`, "", "http = Net::HTTP.new(url.host, url.port)"];
  if (splitUrl(i.url).scheme !== "http") L.push("http.use_ssl = true");
  if (o.timeout > 0) L.push(`http.open_timeout = ${o.timeout}`, `http.read_timeout = ${o.timeout}`);
  const cls = m.charAt(0) + m.slice(1).toLowerCase();
  L.push("", RUBY_CLASSES.includes(cls) ? `request = Net::HTTP::${cls}.new(url)` : `request = Net::HTTPGenericRequest.new(${sq(m)}, true, true, url)`);
  for (const h of b.kind === "none" ? i.headers : withoutHeader(i, "content-type")) L.push(`request[${sq(h.key)}] = ${sq(h.value)}`);
  if (b.kind === "raw") L.push(`request["Content-Type"] = ${sq(i.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "text/plain")}`, `request.body = ${sq(b.text)}`);
  else if (b.kind === "urlencoded") L.push("request.set_form([", ...b.fields.map((f) => `  [${sq(f.key)}, ${sq(f.value)}],`), '], "application/x-www-form-urlencoded")');
  else if (b.kind === "formdata") L.push("form_data = [", ...b.fields.map((f) => `  [${sq(f.key)}, ${f.file ? `File.open(${sq(fwd(f.path))})` : sq(f.value)}],`), "]", 'request.set_form(form_data, "multipart/form-data")');
  L.push("", "response = http.request(request)", "puts response.read_body");
  return joinLines(L);
}

function powershellGen(i: In, o: O): string {
  const b = i.body;
  const L: string[] = [];
  const headers = b.kind === "formdata" ? withoutHeader(i, "content-type") : i.headers;
  if (headers.length) {
    L.push('$headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"');
    for (const h of headers) L.push(`$headers.Add(${psq(h.key)}, ${psq(h.value)})`);
    L.push("");
  }
  const args = [`${psq(i.url)}`, `-Method ${psq(i.method.toUpperCase())}`];
  if (headers.length) args.push("-Headers $headers");
  if (b.kind === "raw") {
    L.push(`$body = ${psq(b.text)}`, "");
    args.push("-Body $body");
  } else if (b.kind === "urlencoded") {
    L.push(`$body = ${psq(formBody(b.fields))}`, "");
    args.push("-Body $body");
  } else if (b.kind === "formdata") {
    L.push("$form = @{", ...b.fields.map((f) => `    ${psq(f.key)} = ${f.file ? `Get-Item -Path ${psq(fwd(f.path))}` : psq(f.value)}`), "}", "");
    args.push("-Form $form");
  }
  if (o.timeout > 0) args.push(`-TimeoutSec ${o.timeout}`);
  if (!o.follow) args.push("-MaximumRedirection 0");
  L.push(`$response = Invoke-RestMethod ${args.join(" ")}`, "$response | ConvertTo-Json");
  return joinLines(L);
}

export const SCRIPT_LANGS: Lang[] = [
  { id: "php-curl", label: "PHP - cURL", hl: "c", ext: "php", opts: ["indent", "timeout", "follow"], gen: phpGen },
  { id: "ruby", label: "Ruby - Net::HTTP", hl: "hash", ext: "rb", opts: ["timeout"], gen: rubyGen },
  { id: "powershell", label: "PowerShell - RestMethod", hl: "hash", ext: "ps1", opts: ["timeout", "follow"], gen: powershellGen },
];
