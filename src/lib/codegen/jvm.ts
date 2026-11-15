import type { Lang, SnippetInput as In, SnippetOptions as O } from "./types.ts";
import { baseName, esc, formBody, fwd, ind, indent, joinLines, mimeOf, withoutHeader } from "./util.ts";

const NEEDS_BODY = ["POST", "PUT", "PATCH"];
const jstr = (s: string) => esc(s);
const kstr = (s: string) => esc(s, "kotlin");

/** Cabeceras sin Content-Type cuando el cuerpo ya lleva su media type. */
const hdrs = (i: In) => (i.body.kind === "none" ? i.headers : withoutHeader(i, "content-type"));

function okhttpJava(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const m = i.method.toUpperCase();
  const L: string[] = [];
  const builder = ["new OkHttpClient().newBuilder()"];
  if (o.timeout > 0) builder.push(`.callTimeout(${o.timeout}, TimeUnit.SECONDS)`);
  if (!o.follow) builder.push(".followRedirects(false)");
  builder.push(".build()");
  L.push(`OkHttpClient client = ${builder.join("")};`);
  let body = "null";
  if (b.kind === "raw" || b.kind === "urlencoded") {
    const text = b.kind === "raw" ? b.text : formBody(b.fields);
    L.push(`MediaType mediaType = MediaType.parse(${jstr(mimeOf(i))});`, `RequestBody body = RequestBody.create(mediaType, ${jstr(text)});`);
    body = "body";
  } else if (b.kind === "formdata") {
    L.push("RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)");
    for (const f of b.fields) {
      if (f.file) L.push(`${I}.addFormDataPart(${jstr(f.key)}, ${jstr(baseName(f.path))}, RequestBody.create(MediaType.parse(${jstr(f.contentType || "application/octet-stream")}), new File(${jstr(fwd(f.path))})))`);
      else L.push(`${I}.addFormDataPart(${jstr(f.key)}, ${jstr(f.value)})`);
    }
    L.push(`${I}.build();`);
    body = "body";
  } else if (NEEDS_BODY.includes(m)) {
    L.push("RequestBody body = RequestBody.create(null, new byte[0]);");
    body = "body";
  }
  L.push("Request request = new Request.Builder()", `${I}.url(${jstr(i.url)})`, `${I}.method(${jstr(m)}, ${body})`);
  for (const h of hdrs(i)) L.push(`${I}.addHeader(${jstr(h.key)}, ${jstr(h.value)})`);
  L.push(`${I}.build();`, "Response response = client.newCall(request).execute();", "System.out.println(response.body().string());");
  const imports = ["import okhttp3.*;", ...(b.kind === "formdata" ? ["import java.io.File;"] : []), ...(o.timeout > 0 ? ["import java.util.concurrent.TimeUnit;"] : [])];
  return joinLines([...imports, "", "public class Main {", `${I}public static void main(String[] args) throws Exception {`, ...indent(L, I, 2), `${I}}`, "}"]);
}

function httpClientJava(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const L: string[] = [];
  const cb = ["HttpClient.newBuilder()"];
  cb.push(`.followRedirects(HttpClient.Redirect.${o.follow ? "NORMAL" : "NEVER"})`);
  if (o.timeout > 0) cb.push(`.connectTimeout(Duration.ofSeconds(${o.timeout}))`);
  cb.push(".build()");
  L.push(`HttpClient client = ${cb.join("")};`);
  let publisher = "HttpRequest.BodyPublishers.noBody()";
  let headers = i.headers;
  if (b.kind === "raw" || b.kind === "urlencoded") {
    publisher = `HttpRequest.BodyPublishers.ofString(${jstr(b.kind === "raw" ? b.text : formBody(b.fields))})`;
  } else if (b.kind === "formdata") {
    headers = [...withoutHeader(i, "content-type"), { key: "Content-Type", value: "multipart/form-data; boundary=----CaesarFormBoundary" }];
    L.push('String boundary = "----CaesarFormBoundary";', "List<byte[]> parts = new ArrayList<>();");
    for (const f of b.fields) {
      if (f.file) {
        const head = `"--" + boundary + "\\r\\nContent-Disposition: form-data; name=\\"" + ${jstr(f.key)} + "\\"; filename=\\"" + ${jstr(baseName(f.path))} + "\\"\\r\\nContent-Type: ${f.contentType || "application/octet-stream"}\\r\\n\\r\\n"`;
        L.push(`parts.add((${head}).getBytes(StandardCharsets.UTF_8));`, `parts.add(Files.readAllBytes(Path.of(${jstr(fwd(f.path))})));`, 'parts.add("\\r\\n".getBytes(StandardCharsets.UTF_8));');
      } else {
        const text = `"--" + boundary + "\\r\\nContent-Disposition: form-data; name=\\"" + ${jstr(f.key)} + "\\"\\r\\n\\r\\n" + ${jstr(f.value)} + "\\r\\n"`;
        L.push(`parts.add((${text}).getBytes(StandardCharsets.UTF_8));`);
      }
    }
    L.push('parts.add(("--" + boundary + "--\\r\\n").getBytes(StandardCharsets.UTF_8));');
    publisher = "HttpRequest.BodyPublishers.ofByteArrays(parts)";
  }
  L.push("HttpRequest request = HttpRequest.newBuilder()", `${I}.uri(URI.create(${jstr(i.url)}))`);
  if (o.timeout > 0) L.push(`${I}.timeout(Duration.ofSeconds(${o.timeout}))`);
  for (const h of headers) L.push(`${I}.header(${jstr(h.key)}, ${jstr(h.value)})`);
  L.push(`${I}.method(${jstr(i.method.toUpperCase())}, ${publisher})`, `${I}.build();`);
  L.push("HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());", "System.out.println(response.body());");
  const imports = ["import java.net.URI;", "import java.net.http.HttpClient;", "import java.net.http.HttpRequest;", "import java.net.http.HttpResponse;"];
  if (o.timeout > 0) imports.push("import java.time.Duration;");
  if (b.kind === "formdata") imports.push("import java.nio.charset.StandardCharsets;", "import java.nio.file.Files;", "import java.nio.file.Path;", "import java.util.ArrayList;", "import java.util.List;");
  return joinLines([...imports, "", "public class Main {", `${I}public static void main(String[] args) throws Exception {`, ...indent(L, I, 2), `${I}}`, "}"]);
}

function okhttpKotlin(i: In, o: O): string {
  const I = ind(o);
  const b = i.body;
  const m = i.method.toUpperCase();
  const imports = ["import okhttp3.*", "import okhttp3.MediaType.Companion.toMediaType"];
  const L: string[] = [];
  const cb = ["OkHttpClient.Builder()"];
  if (o.timeout > 0) {
    cb.push(`.callTimeout(${o.timeout}, TimeUnit.SECONDS)`);
    imports.push("import java.util.concurrent.TimeUnit");
  }
  if (!o.follow) cb.push(".followRedirects(false)");
  cb.push(".build()");
  L.push(`val client = ${cb.join("")}`);
  let body = "null";
  if (b.kind === "raw" || b.kind === "urlencoded") {
    imports.push("import okhttp3.RequestBody.Companion.toRequestBody");
    L.push(`val mediaType = ${kstr(mimeOf(i))}.toMediaType()`, `val body = ${kstr(b.kind === "raw" ? b.text : formBody(b.fields))}.toRequestBody(mediaType)`);
    body = "body";
  } else if (b.kind === "formdata") {
    imports.push("import okhttp3.RequestBody.Companion.asRequestBody", "import java.io.File");
    L.push("val body = MultipartBody.Builder().setType(MultipartBody.FORM)");
    for (const f of b.fields) {
      if (f.file) L.push(`${I}.addFormDataPart(${kstr(f.key)}, ${kstr(baseName(f.path))}, File(${kstr(fwd(f.path))}).asRequestBody(${kstr(f.contentType || "application/octet-stream")}.toMediaType()))`);
      else L.push(`${I}.addFormDataPart(${kstr(f.key)}, ${kstr(f.value)})`);
    }
    L.push(`${I}.build()`);
    body = "body";
  } else if (NEEDS_BODY.includes(m)) {
    imports.push("import okhttp3.RequestBody.Companion.toRequestBody");
    L.push("val body = ByteArray(0).toRequestBody()");
    body = "body";
  }
  L.push("val request = Request.Builder()", `${I}.url(${kstr(i.url)})`, `${I}.method(${kstr(m)}, ${body})`);
  for (const h of hdrs(i)) L.push(`${I}.addHeader(${kstr(h.key)}, ${kstr(h.value)})`);
  L.push(`${I}.build()`, "val response = client.newCall(request).execute()", "println(response.body!!.string())");
  return joinLines([...imports, "", "fun main() {", ...indent(L, I), "}"]);
}

export const JVM_LANGS: Lang[] = [
  { id: "java-okhttp", label: "Java - OkHttp", hl: "c", ext: "java", opts: ["indent", "timeout", "follow"], gen: okhttpJava },
  { id: "java-http", label: "Java - HttpClient (11+)", hl: "c", ext: "java", opts: ["indent", "timeout", "follow"], gen: httpClientJava },
  { id: "kotlin-okhttp", label: "Kotlin - OkHttp", hl: "c", ext: "kt", opts: ["indent", "timeout", "follow"], gen: okhttpKotlin },
];
