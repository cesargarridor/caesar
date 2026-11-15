import type { Lang, SnippetInput as In, SnippetOptions as O } from "./types.ts";
import { baseName, esc, formBody, fwd, ind, indent, joinLines, withoutHeader } from "./util.ts";

const go = (s: string) => esc(s);
const brace = (s: string) => esc(s, "brace");
const dart = (s: string) => esc(s, "dart");

function goGen(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const imports = new Set(["fmt", "io", "net/http"]);
  const L: string[] = [`url := ${go(i.url)}`, `method := ${go(i.method.toUpperCase())}`, ""];
  let payload = "nil";
  let ctSet = "";
  if (b.kind === "raw" || b.kind === "urlencoded") {
    imports.add("strings");
    L.push(`payload := strings.NewReader(${go(b.kind === "raw" ? b.text : formBody(b.fields))})`, "");
    payload = "payload";
  } else if (b.kind === "formdata") {
    imports.add("bytes").add("mime/multipart");
    L.push("payload := &bytes.Buffer{}", "writer := multipart.NewWriter(payload)");
    b.fields.forEach((f, n) => {
      if (f.file) {
        imports.add("os");
        L.push(`file${n}, errFile${n} := os.Open(${go(fwd(f.path))})`, `if errFile${n} != nil {`, `${I}fmt.Println(errFile${n})`, `${I}return`, "}", `defer file${n}.Close()`);
        L.push(`part${n}, errFile${n} := writer.CreateFormFile(${go(f.key)}, ${go(baseName(f.path))})`, `_, errFile${n} = io.Copy(part${n}, file${n})`, `if errFile${n} != nil {`, `${I}fmt.Println(errFile${n})`, `${I}return`, "}");
      } else L.push(`_ = writer.WriteField(${go(f.key)}, ${go(f.value)})`);
    });
    L.push("err := writer.Close()", "if err != nil {", `${I}fmt.Println(err)`, `${I}return`, "}", "");
    payload = "payload";
    ctSet = 'req.Header.Set("Content-Type", writer.FormDataContentType())';
  }
  const client: string[] = [];
  if (o.timeout > 0) {
    imports.add("time");
    client.push(`${I}Timeout: ${o.timeout} * time.Second,`);
  }
  if (!o.follow) client.push(`${I}CheckRedirect: func(req *http.Request, via []*http.Request) error {`, `${I}${I}return http.ErrUseLastResponse`, `${I}},`);
  L.push(...(client.length ? ["client := &http.Client{", ...client, "}"] : ["client := &http.Client{}"]));
  L.push(`req, err := http.NewRequest(method, url, ${payload})`);
  L.push("if err != nil {", `${I}fmt.Println(err)`, `${I}return`, "}");
  for (const h of b.kind === "formdata" ? withoutHeader(i, "content-type") : i.headers) L.push(`req.Header.Add(${go(h.key)}, ${go(h.value)})`);
  if (ctSet) L.push(ctSet);
  L.push("res, err := client.Do(req)", "if err != nil {", `${I}fmt.Println(err)`, `${I}return`, "}", "defer res.Body.Close()", "", "body, err := io.ReadAll(res.Body)", "if err != nil {", `${I}fmt.Println(err)`, `${I}return`, "}", "fmt.Println(string(body))");
  const imp = [...imports].sort();
  return joinLines(["package main", "", "import (", ...imp.map((x) => `${I}"${x}"`), ")", "", "func main() {", ...indent(L, I), "}"]);
}

function rustGen(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const m = i.method.toUpperCase();
  const known = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"];
  const L: string[] = [];
  const cb = ["reqwest::Client::builder()"];
  if (!o.follow) cb.push(".redirect(reqwest::redirect::Policy::none())");
  if (o.timeout > 0) cb.push(`.timeout(std::time::Duration::from_secs(${o.timeout}))`);
  cb.push(".build()?");
  L.push(`let client = ${cb.join("\n" + I + I)};`, "");
  const hdrs = b.kind === "formdata" ? withoutHeader(i, "content-type") : i.headers;
  if (b.kind === "formdata") {
    L.push("let mut form = reqwest::multipart::Form::new();");
    for (const f of b.fields) {
      if (f.file) L.push(`form = form.file(${brace(f.key)}, ${brace(fwd(f.path))}).await?;`);
      else L.push(`form = form.text(${brace(f.key)}, ${brace(f.value)});`);
    }
    L.push("");
  }
  L.push(`let response = client.request(${known.includes(m) ? `reqwest::Method::${m}` : `reqwest::Method::from_bytes(b${brace(m)})?`}, ${brace(i.url)})`);
  for (const h of hdrs) L.push(`${I}.header(${brace(h.key)}, ${brace(h.value)})`);
  if (b.kind === "raw") L.push(`${I}.body(${brace(b.text)})`);
  else if (b.kind === "urlencoded") L.push(`${I}.body(${brace(formBody(b.fields))})`);
  else if (b.kind === "formdata") L.push(`${I}.multipart(form)`);
  L.push(`${I}.send()`, `${I}.await?;`, "", 'println!("{}", response.text().await?);', "Ok(())");
  return joinLines(["#[tokio::main]", "async fn main() -> Result<(), Box<dyn std::error::Error>> {", ...indent(L, I), "}"]);
}

function swiftGen(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const L: string[] = [];
  let headers = i.headers;
  if (b.kind === "formdata") {
    headers = [...withoutHeader(i, "content-type"), { key: "Content-Type", value: "multipart/form-data; boundary=----CaesarFormBoundary" }];
    L.push('let boundary = "----CaesarFormBoundary"', "var body = Data()");
    for (const f of b.fields) {
      if (f.file) {
        L.push(`body.append(Data(("--" + boundary + "\\r\\nContent-Disposition: form-data; name=\\"" + ${brace(f.key)} + "\\"; filename=\\"" + ${brace(baseName(f.path))} + "\\"\\r\\nContent-Type: ${f.contentType || "application/octet-stream"}\\r\\n\\r\\n").utf8))`);
        L.push(`if let fileData = FileManager.default.contents(atPath: ${brace(fwd(f.path))}) {`, `${I}body.append(fileData)`, "}", 'body.append(Data("\\r\\n".utf8))');
      } else {
        L.push(`body.append(Data(("--" + boundary + "\\r\\nContent-Disposition: form-data; name=\\"" + ${brace(f.key)} + "\\"\\r\\n\\r\\n" + ${brace(f.value)} + "\\r\\n").utf8))`);
      }
    }
    L.push('body.append(Data(("--" + boundary + "--\\r\\n").utf8))', "");
  } else if (b.kind === "raw" || b.kind === "urlencoded") {
    L.push(`let parameters = ${brace(b.kind === "raw" ? b.text : formBody(b.fields))}`, "let postData = parameters.data(using: .utf8)", "");
  }
  L.push(`var request = URLRequest(url: URL(string: ${brace(i.url)})!${o.timeout > 0 ? `, timeoutInterval: ${o.timeout}` : ""})`, `request.httpMethod = ${brace(i.method.toUpperCase())}`);
  for (const h of headers) L.push(`request.addValue(${brace(h.value)}, forHTTPHeaderField: ${brace(h.key)})`);
  if (b.kind === "formdata") L.push("request.httpBody = body");
  else if (b.kind !== "none") L.push("request.httpBody = postData");
  L.push("", "let task = URLSession.shared.dataTask(with: request) { data, response, error in", `${I}guard let data = data else {`, `${I}${I}print(String(describing: error))`, `${I}${I}return`, `${I}}`, `${I}print(String(data: data, encoding: .utf8)!)`, "}", "", "task.resume()");
  return joinLines(["import Foundation", "#if canImport(FoundationNetworking)", "import FoundationNetworking", "#endif", "", ...L]);
}

function dartGen(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const m = i.method.toUpperCase();
  const L: string[] = [];
  const hdrs = b.kind === "formdata" ? withoutHeader(i, "content-type") : i.headers;
  if (hdrs.length) L.push("var headers = {", ...hdrs.map((h) => `${I}${dart(h.key)}: ${dart(h.value)},`), "};");
  if (b.kind === "formdata") {
    L.push(`var request = http.MultipartRequest(${dart(m)}, Uri.parse(${dart(i.url)}));`);
    const texts = b.fields.filter((f) => !f.file);
    if (texts.length) L.push("request.fields.addAll({", ...texts.map((f) => `${I}${dart(f.key)}: ${dart(f.value)},`), "});");
    for (const f of b.fields.filter((x) => x.file)) L.push(`request.files.add(await http.MultipartFile.fromPath(${dart(f.key)}, ${dart(fwd(f.path))}));`);
  } else {
    L.push(`var request = http.Request(${dart(m)}, Uri.parse(${dart(i.url)}));`);
    if (b.kind === "raw") L.push(`request.body = ${dart(b.text)};`);
    else if (b.kind === "urlencoded") L.push(`request.bodyFields = {`, ...b.fields.map((f) => `${I}${dart(f.key)}: ${dart(f.value)},`), "};");
  }
  if (hdrs.length) L.push("request.headers.addAll(headers);");
  if (!o.follow) L.push("request.followRedirects = false;");
  L.push("", `http.StreamedResponse response = await request.send()${o.timeout > 0 ? `.timeout(Duration(seconds: ${o.timeout}))` : ""};`, "", "if (response.statusCode == 200) {", `${I}print(await response.stream.bytesToString());`, "} else {", `${I}print(response.reasonPhrase);`, "}");
  return joinLines([...(o.timeout > 0 ? ["import 'dart:async';"] : []), "import 'package:http/http.dart' as http;", "", "void main() async {", ...indent(L, I), "}"]);
}

export const NATIVE_LANGS: Lang[] = [
  { id: "go", label: "Go - net/http", hl: "c", ext: "go", opts: ["indent", "timeout", "follow"], gen: goGen },
  { id: "swift", label: "Swift - URLSession", hl: "c", ext: "swift", opts: ["indent", "timeout"], gen: swiftGen },
  { id: "dart", label: "Dart - http", hl: "c", ext: "dart", opts: ["indent", "timeout", "follow"], gen: dartGen },
  { id: "rust", label: "Rust - reqwest", hl: "c", ext: "rs", opts: ["indent", "timeout", "follow"], gen: rustGen },
];
