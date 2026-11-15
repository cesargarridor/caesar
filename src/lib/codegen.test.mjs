// node --experimental-strip-types --test src/lib/codegen.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGS, generateSnippet, fromArgs } from "./codegen/index.ts";
import { highlight } from "./codegen/highlight.ts";
import { esc } from "./codegen/util.ts";

const kv = (key, value, extra = {}) => ({ key, value, enabled: true, ...extra });
const args = (over = {}) => ({
  method: "GET",
  url: "https://api.example.com/users?id=1",
  headers: [kv("Accept", "application/json")],
  body: { mode: "none", raw: "", formdata: [], urlencoded: [] },
  ...over,
});
const body = (b) => ({ mode: "none", raw: "", formdata: [], urlencoded: [], ...b });

const get = fromArgs(args());
const postJson = fromArgs(args({ method: "POST", body: body({ mode: "json", raw: '{"a":1}' }) }));
const urlenc = fromArgs(args({ method: "POST", body: body({ mode: "urlencoded", urlencoded: [kv("name", "John Doe"), kv("q", "a&b")] }) }));
const form = fromArgs(args({ method: "POST", body: body({ mode: "formdata", formdata: [kv("title", "hola"), kv("doc", "", { kind: "file", path: "/tmp/cv.pdf" })] }) }));
const quotes = fromArgs(args({ method: "POST", body: body({ mode: "text", raw: 'di "hola"\nlínea 2 \\ fin' }) }));

// fragmentos clave por lenguaje: [GET, POST JSON, urlencoded, form-data, comillas]
const EXPECT = {
  curl: ["curl --location 'https://api.example.com/users?id=1'", "--data '{\"a\":1}'", "--data-urlencode 'name=John Doe'", "--form 'doc=@\"/tmp/cv.pdf\"'", "--data 'di \"hola\"\nlínea 2"],
  "js-fetch": ['myHeaders.append("Accept", "application/json")', 'body: raw', 'urlencoded.append("name", "John Doe")', 'formdata.append("doc", fileInput.files[0], "cv.pdf")', '"di \\"hola\\"\\nlínea 2 \\\\ fin"'],
  "js-xhr": ['xhr.open("GET", "https://api.example.com/users?id=1")', "xhr.send(data)", 'name=John+Doe&q=a%26b', 'data.append("doc", fileInput.files[0]', '\\"hola\\"\\nlínea'],
  "node-axios": ["method: \"get\"", "let data = \"{\\\"a\\\":1}\"", "data.append(\"name\", \"John Doe\")", "fs.createReadStream(\"/tmp/cv.pdf\")", "\\nlínea 2"],
  "node-native": ["require('https')", "req.write(postData)", "name=John+Doe", "fs.readFileSync(\"/tmp/cv.pdf\")", "\\nlínea 2"],
  "py-requests": ['requests.request("GET", url, headers=headers', 'payload = "{\\"a\\":1}"', '"name": "John Doe"', "open(\"/tmp/cv.pdf\", 'rb')", "\\nlínea 2"],
  "py-http": ['conn = http.client.HTTPSConnection("api.example.com")', 'conn.request("POST", "/users?id=1", payload', "name=John+Doe", "open(\"/tmp/cv.pdf\", 'rb').read()", "\\nlínea 2"],
  go: ['http.NewRequest(method, url, nil)', 'strings.NewReader("{\\"a\\":1}")', "strings.NewReader(\"name=John+Doe&q=a%26b\")", 'writer.CreateFormFile("doc", "cv.pdf")', "\\nlínea 2"],
  "java-okhttp": ['.url("https://api.example.com/users?id=1")', 'RequestBody.create(mediaType, "{\\"a\\":1}")', 'name=John+Doe', 'new File("/tmp/cv.pdf")', "\\nlínea 2"],
  "java-http": ['URI.create("https://api.example.com/users?id=1")', 'ofString("{\\"a\\":1}")', "name=John+Doe", 'Path.of("/tmp/cv.pdf")', "\\nlínea 2"],
  "php-curl": ["CURLOPT_URL => 'https://api.example.com/users?id=1'", "CURLOPT_POSTFIELDS => '{\"a\":1}'", "name=John+Doe", "new CURLFILE('/tmp/cv.pdf')", "di \"hola\"\nlínea 2 \\\\ fin"],
  "cs-httpclient": ["HttpMethod.Get", 'new StringContent("{\\"a\\":1}", Encoding.UTF8, "application/json")', "name=John+Doe", 'File.ReadAllBytes("/tmp/cv.pdf")', "\\nlínea 2"],
  "cs-restsharp": ["Method.Get", 'AddStringBody("{\\"a\\":1}", "application/json")', 'AddParameter("name", "John Doe")', 'AddFile("doc", "/tmp/cv.pdf")', "\\nlínea 2"],
  ruby: ["Net::HTTP::Get.new(url)", "request.body = '{\"a\":1}'", "['name', 'John Doe']", "File.open('/tmp/cv.pdf')", "di \"hola\"\nlínea 2 \\\\ fin"],
  swift: ["request.httpMethod = \"GET\"", 'let parameters = "{\\"a\\":1}"', "name=John+Doe", 'FileManager.default.contents(atPath: "/tmp/cv.pdf")', "\\nlínea 2"],
  "kotlin-okhttp": ['.url("https://api.example.com/users?id=1")', '"{\\"a\\":1}".toRequestBody(mediaType)', "name=John+Doe", 'File("/tmp/cv.pdf").asRequestBody', "\\nlínea 2"],
  dart: ["http.Request(\"GET\"", 'request.body = "{\\"a\\":1}"', 'request.bodyFields = {', "MultipartFile.fromPath(\"doc\", \"/tmp/cv.pdf\")", "\\nlínea 2"],
  rust: ["reqwest::Method::GET", '.body("{\\"a\\":1}")', '.body("name=John+Doe&q=a%26b")', 'form.file("doc", "/tmp/cv.pdf")', "\\nlínea 2"],
  powershell: ["Invoke-RestMethod 'https://api.example.com/users?id=1' -Method 'GET'", "$body = '{\"a\":1}'", "name=John+Doe", "Get-Item -Path '/tmp/cv.pdf'", "di \"hola\"\nlínea 2 \\ fin"],
  http: ["GET /users?id=1 HTTP/1.1\nHost: api.example.com\nAccept: application/json", '\n\n{"a":1}', "\n\nname=John+Doe&q=a%26b", 'filename="cv.pdf"', "di \"hola\"\nlínea 2 \\ fin"],
};

test("hay un generador por cada lenguaje pedido", () => {
  assert.equal(LANGS.length, 20);
  assert.deepEqual(LANGS.map((l) => l.id).sort(), Object.keys(EXPECT).sort());
});

const CASES = [["GET con header", get], ["POST JSON", postJson], ["urlencoded", urlenc], ["form-data con archivo", form], ["comillas y saltos", quotes]];
for (const l of LANGS) {
  CASES.forEach(([name, input], n) => {
    test(`${l.id}: ${name}`, () => {
      const out = generateSnippet(l.id, input);
      const frag = EXPECT[l.id][n];
      assert.ok(out.includes(frag), `falta ${JSON.stringify(frag)} en:\n${out}`);
    });
  });
}

test("GET con header lleva el header en cada lenguaje", () => {
  for (const l of LANGS) {
    const out = generateSnippet(l.id, get);
    assert.ok(/Accept/.test(out) && /application\/json/.test(out), l.id);
  }
});

test("opciones: indentación, timeout y redirecciones", () => {
  assert.ok(generateSnippet("js-fetch", get, { indent: 4 }).includes('    method: "GET"'));
  assert.ok(generateSnippet("js-fetch", get, { indent: 0 }).includes('\tmethod: "GET"'));
  assert.ok(generateSnippet("js-fetch", get, { timeout: 5 }).includes("AbortSignal.timeout(5000)"));
  assert.ok(generateSnippet("js-fetch", get, { follow: false }).includes('redirect: "manual"'));
  assert.ok(generateSnippet("py-requests", get, { timeout: 5, follow: false }).includes("timeout=5, allow_redirects=False"));
  assert.ok(generateSnippet("go", get, { timeout: 3 }).includes("3 * time.Second"));
});

test("fromArgs: sin body en GET, content-type por defecto y multipart sin boundary", () => {
  assert.equal(fromArgs(args({ body: body({ mode: "json", raw: "{}" }) })).body.kind, "none");
  assert.ok(postJson.headers.some((h) => h.key === "Content-Type" && h.value === "application/json"));
  const f = fromArgs(args({ method: "POST", headers: [kv("Content-Type", "multipart/form-data")], body: body({ mode: "formdata", formdata: [kv("a", "b")] }) }));
  assert.equal(f.headers.length, 0);
  const off = fromArgs(args({ headers: [{ key: "X", value: "1", enabled: false }] }));
  assert.equal(off.headers.length, 0);
});

test("escapado por lenguaje", () => {
  assert.equal(esc('a"b\né'), '"a\\"b\\né"');
  assert.equal(esc("$x\f", "kotlin"), '"\\$x\\u000c"');
  assert.equal(esc("a\u0001\"", "brace"), '"a\\u{1}\\""');
  assert.equal(esc("${a}", "dart"), '"\\${a}"');
});

test("resaltado: cadenas, números, comentarios y flags", () => {
  const t = highlight('const a = "x // no"; // hola\nlet n = 42', "c");
  assert.ok(t.some((x) => x.k === "str" && x.s === '"x // no"'));
  assert.ok(t.some((x) => x.k === "com" && x.s === "// hola"));
  assert.ok(t.some((x) => x.k === "num" && x.s === "42"));
  assert.ok(highlight("curl --header 'a: b'", "curl").some((x) => x.k === "flag" && x.s === "--header"));
  assert.equal(highlight("GET / HTTP/1.1", "none").length, 1);
});
