import type { Lang, SnippetInput as In, SnippetOptions as O } from "./types.ts";
import { baseName, esc, formBody, fwd, ind, joinLines, splitUrl, withoutHeader } from "./util.ts";

const js = (s: string) => esc(s);
const ms = (o: O) => Math.round(o.timeout * 1000);

function fetchGen(i: In, o: O): string {
  const I = ind(o);
  const out: string[] = [];
  const hasH = i.headers.length > 0;
  if (hasH) {
    out.push("const myHeaders = new Headers();");
    for (const h of i.headers) out.push(`myHeaders.append(${js(h.key)}, ${js(h.value)});`);
    out.push("");
  }
  let bodyVar = "";
  const b = i.body;
  if (b.kind === "raw") {
    out.push(`const raw = ${js(b.text)};`, "");
    bodyVar = "raw";
  } else if (b.kind === "urlencoded") {
    out.push("const urlencoded = new URLSearchParams();");
    for (const f of b.fields) out.push(`urlencoded.append(${js(f.key)}, ${js(f.value)});`);
    out.push("");
    bodyVar = "urlencoded";
  } else if (b.kind === "formdata") {
    out.push("const formdata = new FormData();");
    for (const f of b.fields) {
      if (f.file) out.push(`formdata.append(${js(f.key)}, fileInput.files[0], ${js(baseName(f.path))}); // ${fwd(f.path)}`);
      else out.push(`formdata.append(${js(f.key)}, ${js(f.value)});`);
    }
    out.push("");
    bodyVar = "formdata";
  }
  const opts = [`method: ${js(i.method)}`];
  if (hasH) opts.push("headers: myHeaders");
  if (bodyVar) opts.push(`body: ${bodyVar}`);
  opts.push(`redirect: ${o.follow ? '"follow"' : '"manual"'}`);
  if (o.timeout > 0) opts.push(`signal: AbortSignal.timeout(${ms(o)})`);
  out.push("const requestOptions = {", ...opts.map((x, k) => I + x + (k < opts.length - 1 ? "," : "")), "};", "");
  out.push(`fetch(${js(i.url)}, requestOptions)`, `${I}.then((response) => response.text())`, `${I}.then((result) => console.log(result))`, `${I}.catch((error) => console.error(error));`);
  return joinLines(out);
}

function xhrGen(i: In, o: O): string {
  const I = ind(o);
  const out: string[] = [];
  const b = i.body;
  let data = "null";
  if (b.kind === "raw") {
    out.push(`const data = ${js(b.text)};`, "");
    data = "data";
  } else if (b.kind === "urlencoded") {
    out.push(`const data = ${js(formBody(b.fields))};`, "");
    data = "data";
  } else if (b.kind === "formdata") {
    out.push("const data = new FormData();");
    for (const f of b.fields) {
      if (f.file) out.push(`data.append(${js(f.key)}, fileInput.files[0], ${js(baseName(f.path))}); // ${fwd(f.path)}`);
      else out.push(`data.append(${js(f.key)}, ${js(f.value)});`);
    }
    out.push("");
    data = "data";
  }
  out.push("const xhr = new XMLHttpRequest();");
  if (o.timeout > 0) out.push(`xhr.timeout = ${ms(o)};`);
  out.push("", 'xhr.addEventListener("readystatechange", function () {', `${I}if (this.readyState === 4) {`, `${I}${I}console.log(this.responseText);`, `${I}}`, "});", "");
  out.push(`xhr.open(${js(i.method)}, ${js(i.url)});`);
  for (const h of i.headers) out.push(`xhr.setRequestHeader(${js(h.key)}, ${js(h.value)});`);
  out.push("", `xhr.send(${data});`);
  return joinLines(out);
}

function axiosGen(i: In, o: O): string {
  const I = ind(o);
  const out: string[] = ["const axios = require('axios');"];
  const b = i.body;
  let headers = i.headers;
  let multipart = false;
  if (b.kind === "formdata") {
    out.push("const FormData = require('form-data');", "const fs = require('fs');");
    multipart = true;
  }
  out.push("");
  if (b.kind === "raw") out.push(`let data = ${js(b.text)};`, "");
  else if (b.kind === "urlencoded") {
    out.push("let data = new URLSearchParams();");
    for (const f of b.fields) out.push(`data.append(${js(f.key)}, ${js(f.value)});`);
    out.push("");
  } else if (b.kind === "formdata") {
    out.push("let data = new FormData();");
    for (const f of b.fields) {
      if (f.file) out.push(`data.append(${js(f.key)}, fs.createReadStream(${js(fwd(f.path))}));`);
      else out.push(`data.append(${js(f.key)}, ${js(f.value)});`);
    }
    out.push("");
  }
  if (multipart) headers = withoutHeader(i, "content-type");
  const hl = headers.map((h) => `${I}${I}${js(h.key)}: ${js(h.value)}`);
  const cfg: string[] = [`${I}method: ${js(i.method.toLowerCase())}`, `${I}maxBodyLength: Infinity`, `${I}url: ${js(i.url)}`];
  if (headers.length || multipart) {
    const inner = [...(multipart ? [`${I}${I}...data.getHeaders()`] : []), ...hl];
    cfg.push(`${I}headers: {\n${inner.join(",\n")}\n${I}}`);
  }
  if (b.kind !== "none") cfg.push(`${I}data: data`);
  if (o.timeout > 0) cfg.push(`${I}timeout: ${ms(o)}`);
  if (!o.follow) cfg.push(`${I}maxRedirects: 0`);
  out.push("let config = {", cfg.join(",\n"), "};", "");
  out.push("axios.request(config)", `${I}.then((response) => {`, `${I}${I}console.log(JSON.stringify(response.data));`, `${I}})`, `${I}.catch((error) => {`, `${I}${I}console.log(error);`, `${I}});`);
  return joinLines(out);
}

function nodeGen(i: In, o: O): string {
  const I = ind(o);
  const u = splitUrl(i.url);
  const mod = u.scheme === "http" ? "http" : "https";
  const b = i.body;
  const out: string[] = [`const ${mod} = require('${mod}');`];
  let headers = i.headers;
  if (b.kind === "formdata") out.push("const fs = require('fs');");
  out.push("");
  let write = "";
  if (b.kind === "raw") out.push(`const postData = ${js(b.text)};`, "");
  else if (b.kind === "urlencoded") out.push(`const postData = ${js(formBody(b.fields))};`, "");
  else if (b.kind === "formdata") {
    headers = [...withoutHeader(i, "content-type"), { key: "Content-Type", value: "multipart/form-data; boundary=----CaesarFormBoundary" }];
    out.push("const boundary = '----CaesarFormBoundary';", "const parts = [];");
    for (const f of b.fields) {
      if (f.file) {
        out.push(`parts.push(Buffer.from('--' + boundary + '\\r\\nContent-Disposition: form-data; name=' + ${js(js(f.key))} + '; filename=' + ${js(js(baseName(f.path)))} + '\\r\\nContent-Type: ${f.contentType || "application/octet-stream"}\\r\\n\\r\\n'));`);
        out.push(`parts.push(fs.readFileSync(${js(fwd(f.path))}));`, "parts.push(Buffer.from('\\r\\n'));");
      } else {
        out.push(`parts.push(Buffer.from('--' + boundary + '\\r\\nContent-Disposition: form-data; name=' + ${js(js(f.key))} + '\\r\\n\\r\\n' + ${js(f.value)} + '\\r\\n'));`);
      }
    }
    out.push("parts.push(Buffer.from('--' + boundary + '--\\r\\n'));", "const postData = Buffer.concat(parts);", "");
  }
  if (b.kind !== "none") write = "req.write(postData);\n";
  const opt: string[] = [`${I}method: ${js(i.method)}`, `${I}hostname: ${js(u.host)}`];
  if (u.port) opt.push(`${I}port: ${u.port}`);
  opt.push(`${I}path: ${js(u.path)}`);
  const hl = headers.map((h) => `${I}${I}${js(h.key)}: ${js(h.value)}`);
  if (headers.length) opt.push(`${I}headers: {\n${hl.join(",\n")}\n${I}}`);
  if (o.timeout > 0) opt.push(`${I}timeout: ${ms(o)}`);
  out.push("const options = {", opt.join(",\n"), "};", "");
  out.push(
    `const req = ${mod}.request(options, (res) => {`,
    `${I}const chunks = [];`,
    `${I}res.on('data', (chunk) => chunks.push(chunk));`,
    `${I}res.on('end', () => console.log(Buffer.concat(chunks).toString()));`,
    `${I}res.on('error', (error) => console.error(error));`,
    "});",
    "",
  );
  if (o.timeout > 0) out.push(`req.on('timeout', () => req.destroy(new Error('Timeout')));`);
  out.push("req.on('error', (error) => console.error(error));");
  out.push(`${write}req.end();`);
  return joinLines(out);
}

export const WEB_LANGS: Lang[] = [
  { id: "js-fetch", label: "JavaScript - Fetch", hl: "c", ext: "js", opts: ["indent", "timeout", "follow"], gen: fetchGen },
  { id: "js-xhr", label: "JavaScript - XHR", hl: "c", ext: "js", opts: ["indent", "timeout"], gen: xhrGen },
  { id: "node-axios", label: "Node.js - Axios", hl: "c", ext: "js", opts: ["indent", "timeout", "follow"], gen: axiosGen },
  { id: "node-native", label: "Node.js - Native", hl: "c", ext: "js", opts: ["indent", "timeout"], gen: nodeGen },
];
