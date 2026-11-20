//! Caesar CLI: ejecuta una colección exportada de Caesar (o en formato JSON v2.1) desde la terminal o un pipeline de CI/CD.
//! Un único ejecutable en Rust: sin Node.js, sin `npm install`, arranque inmediato.
//!
//! Uso:  caesar run <coleccion.json> [-e entorno.json] [--var clave=valor]... [--data datos.csv]
//!                  [--folder NOMBRE] [--bail] [--timeout SEG] [--reporter cli|json|junit] [--out ARCHIVO]
//! Códigos de salida: 0 todo bien · 1 alguna petición falló (HTTP ≥ 400 o error de red) · 2 uso incorrecto o archivo no válido.
//! Límite conocido: los scripts de tests (pm.test…) NO se ejecutan; una petición cuenta como correcta si responde con estado < 400.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::Value;

struct Req {
    name: String,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<(String, String)>, // (content-type, cuerpo)
    form: Vec<(String, String)>,
}

struct Outcome {
    name: String,
    row: Option<usize>,
    status: Option<u16>,
    ms: u128,
    size: usize,
    error: Option<String>,
}

impl Outcome {
    fn ok(&self) -> bool {
        self.error.is_none() && self.status.map(|s| s < 400).unwrap_or(false)
    }
}

/// Sustituye `{{variable}}`; las desconocidas se dejan tal cual.
fn substitute(s: &str, vars: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("{{") {
        out.push_str(&rest[..i]);
        match rest[i + 2..].find("}}") {
            Some(j) => {
                let key = rest[i + 2..i + 2 + j].trim();
                match vars.get(key) {
                    Some(v) => out.push_str(v),
                    None => out.push_str(&rest[i..i + 2 + j + 2]),
                }
                rest = &rest[i + 2 + j + 2..];
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn kv_list(v: &Value) -> Vec<(String, String)> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter(|x| x["disabled"].as_bool() != Some(true) && x["enabled"].as_bool() != Some(false))
                .filter_map(|x| Some((x["key"].as_str()?.to_string(), x["value"].as_str().unwrap_or("").to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn auth_headers(auth: &Value, headers: &mut Vec<(String, String)>, query: &mut Vec<(String, String)>) {
    let find = |k: &str| -> String {
        auth[auth["type"].as_str().unwrap_or("")]
            .as_array()
            .and_then(|a| a.iter().find(|x| x["key"] == k))
            .and_then(|x| x["value"].as_str())
            .unwrap_or("")
            .to_string()
    };
    match auth["type"].as_str() {
        Some("bearer") => headers.push(("Authorization".into(), format!("Bearer {}", find("token")))),
        Some("basic") => {
            let pair = format!("{}:{}", find("username"), find("password"));
            headers.push(("Authorization".into(), format!("Basic {}", b64(pair.as_bytes()))));
        }
        Some("apikey") => {
            if find("in") == "query" {
                query.push((find("key"), find("value")));
            } else {
                headers.push((find("key"), find("value")));
            }
        }
        _ => {}
    }
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Aplana la colección en orden. `folder` limita a una carpeta (por nombre). La autorización de carpeta se hereda.
fn collect(items: &Value, inherited: &Value, only: Option<&str>, inside: bool, out: &mut Vec<Req>) {
    for it in items.as_array().into_iter().flatten() {
        let auth = if it["auth"].is_object() { &it["auth"] } else { inherited };
        if let Some(children) = it["item"].as_array().map(|_| &it["item"]) {
            let hit = inside || only.map(|f| it["name"].as_str() == Some(f)).unwrap_or(true);
            collect(children, auth, only, hit, out);
            continue;
        }
        if !(inside || only.is_none()) {
            continue;
        }
        let r = &it["request"];
        let (method, raw) = if let Some(u) = r.as_str() {
            ("GET".to_string(), u.to_string())
        } else {
            let raw = r["url"].as_str().map(str::to_string).or_else(|| r["url"]["raw"].as_str().map(str::to_string)).unwrap_or_default();
            (r["method"].as_str().unwrap_or("GET").to_uppercase(), raw)
        };
        let mut headers = kv_list(&r["header"]);
        let mut query = Vec::new();
        auth_headers(if r["auth"].is_object() { &r["auth"] } else { auth }, &mut headers, &mut query);
        let mut url = raw;
        for (k, v) in query {
            url.push(if url.contains('?') { '&' } else { '?' });
            url.push_str(&format!("{k}={v}"));
        }
        let body = &r["body"];
        let (b, form) = match body["mode"].as_str() {
            Some("raw") => {
                let ct = if body["options"]["raw"]["language"] == "json" { "application/json" } else { "text/plain" };
                (Some((ct.to_string(), body["raw"].as_str().unwrap_or("").to_string())), vec![])
            }
            Some("graphql") => {
                let q = body["graphql"]["query"].as_str().unwrap_or("");
                let v = body["graphql"]["variables"].as_str().unwrap_or("").trim();
                let mut payload = serde_json::json!({ "query": q });
                if !v.is_empty() {
                    if let Ok(parsed) = serde_json::from_str::<Value>(v) {
                        payload["variables"] = parsed;
                    }
                }
                (Some(("application/json".to_string(), payload.to_string())), vec![])
            }
            Some("urlencoded") => (None, kv_list(&body["urlencoded"])),
            _ => (None, vec![]),
        };
        out.push(Req { name: it["name"].as_str().unwrap_or("Sin nombre").to_string(), method, url, headers, body: b, form });
    }
}

fn load_vars(collection: &Value, env: Option<&Value>, cli: &[(String, String)]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for (k, v) in kv_list(&collection["variable"]) {
        m.insert(k, v);
    }
    if let Some(e) = env {
        for (k, v) in kv_list(&e["values"]) {
            m.insert(k, v);
        }
    }
    for (k, v) in cli {
        m.insert(k.clone(), v.clone());
    }
    m
}

/// Separador del CSV: el más frecuente en la primera línea entre `,` `;` y tabulador.
fn detect_delimiter(text: &str) -> u8 {
    let first = text.lines().next().unwrap_or("");
    [b',', b';', b'\t'].into_iter().max_by_key(|d| first.bytes().filter(|b| b == d).count()).unwrap_or(b',')
}

/// Variables `{{x}}` que siguen sin valor tras sustituir (para avisar: casi siempre es un error de nombre).
fn unresolved(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = s;
    while let Some(i) = rest.find("{{") {
        match rest[i + 2..].find("}}") {
            Some(j) => {
                let k = rest[i + 2..i + 2 + j].trim();
                if !k.is_empty() && !k.starts_with('$') && !out.iter().any(|x: &String| x == k) {
                    out.push(k.to_string());
                }
                rest = &rest[i + 2 + j + 2..];
            }
            None => break,
        }
    }
    out
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn junit(name: &str, res: &[Outcome]) -> String {
    let fails = res.iter().filter(|r| !r.ok()).count();
    let mut s = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuite name=\"{}\" tests=\"{}\" failures=\"{fails}\">\n", esc(name), res.len());
    for r in res {
        s.push_str(&format!("  <testcase name=\"{}\" time=\"{:.3}\"", esc(&r.name), r.ms as f64 / 1000.0));
        if r.ok() {
            s.push_str("/>\n");
        } else {
            let msg = r.error.clone().unwrap_or_else(|| format!("HTTP {}", r.status.unwrap_or(0)));
            s.push_str(&format!("><failure message=\"{}\"/></testcase>\n", esc(&msg)));
        }
    }
    s.push_str("</testsuite>\n");
    s
}

fn json_report(res: &[Outcome]) -> String {
    let items: Vec<Value> = res
        .iter()
        .map(|r| serde_json::json!({ "name": r.name, "row": r.row, "status": r.status, "timeMs": r.ms as u64, "sizeBytes": r.size, "ok": r.ok(), "error": r.error }))
        .collect();
    serde_json::to_string_pretty(&serde_json::json!({ "total": res.len(), "failed": res.iter().filter(|r| !r.ok()).count(), "results": items })).unwrap_or_default()
}

struct Opts {
    file: String,
    env: Option<String>,
    vars: Vec<(String, String)>,
    data: Option<String>,
    folder: Option<String>,
    bail: bool,
    timeout: u64,
    reporter: String,
    out: Option<String>,
}

fn parse_args(args: &[String]) -> Result<Opts, String> {
    let mut o = Opts { file: String::new(), env: None, vars: vec![], data: None, folder: None, bail: false, timeout: 30, reporter: "cli".into(), out: None };
    let mut i = 0;
    let next = |i: &mut usize, flag: &str| -> Result<String, String> {
        *i += 1;
        args.get(*i).cloned().ok_or_else(|| format!("Falta el valor de {flag}"))
    };
    while i < args.len() {
        match args[i].as_str() {
            "-e" | "--env" => o.env = Some(next(&mut i, "--env")?),
            "--var" => {
                let kv = next(&mut i, "--var")?;
                let (k, v) = kv.split_once('=').ok_or("--var espera clave=valor")?;
                o.vars.push((k.to_string(), v.to_string()));
            }
            "--data" => o.data = Some(next(&mut i, "--data")?),
            "--folder" => o.folder = Some(next(&mut i, "--folder")?),
            "--bail" => o.bail = true,
            "--timeout" => o.timeout = next(&mut i, "--timeout")?.parse().map_err(|_| "--timeout espera segundos")?,
            "--reporter" => o.reporter = next(&mut i, "--reporter")?,
            "--out" => o.out = Some(next(&mut i, "--out")?),
            f if f.starts_with('-') => return Err(format!("Opción desconocida: {f}")),
            f if o.file.is_empty() => o.file = f.to_string(),
            f => return Err(format!("Argumento sobrante: {f}")),
        }
        i += 1;
    }
    if o.file.is_empty() {
        return Err("Indica la colección: caesar run <coleccion.json>".into());
    }
    if !["cli", "json", "junit"].contains(&o.reporter.as_str()) {
        return Err("--reporter debe ser cli, json o junit".into());
    }
    Ok(o)
}

fn read_json(path: &str) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("No se pudo leer {path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{path} no es un JSON válido: {e}"))
}

async fn run(o: Opts) -> Result<i32, String> {
    let col = read_json(&o.file)?;
    if !col["item"].is_array() {
        return Err(format!("{} no parece una colección (falta «item»). Se admite JSON v2.1.", o.file));
    }
    let env = o.env.as_deref().map(read_json).transpose()?;
    let base = load_vars(&col, env.as_ref(), &o.vars);
    let mut reqs = Vec::new();
    collect(&col["item"], &col["auth"], o.folder.as_deref(), false, &mut reqs);
    if reqs.is_empty() {
        return Err("No hay peticiones que ejecutar (revisa --folder).".into());
    }
    let rows: Vec<Vec<(String, String)>> = match &o.data {
        Some(p) => {
            let text = std::fs::read_to_string(p).map_err(|e| format!("No se pudo leer el CSV: {e}"))?;
            let text = text.trim_start_matches('\u{feff}');
            let delim = detect_delimiter(text);
            let mut rdr = csv::ReaderBuilder::new().delimiter(delim).flexible(true).trim(csv::Trim::All).from_reader(text.as_bytes());
            let heads: Vec<String> = rdr.headers().map_err(|e| format!("CSV no válido: {e}"))?.iter().map(str::to_string).collect();
            let mut v = Vec::new();
            for rec in rdr.records() {
                let rec = rec.map_err(|e| format!("CSV no válido: {e}"))?;
                if rec.iter().all(str::is_empty) {
                    continue;
                }
                v.push(heads.iter().cloned().zip(rec.iter().map(str::to_string).chain(std::iter::repeat(String::new()))).collect());
            }
            if v.is_empty() {
                return Err("El CSV no tiene filas de datos.".into());
            }
            v
        }
        None => vec![vec![]],
    };
    let client = reqwest::Client::builder().timeout(Duration::from_secs(o.timeout.max(1))).user_agent("caesar-cli").build().map_err(|e| e.to_string())?;
    let mut results: Vec<Outcome> = Vec::new();
    'all: for (ri, row) in rows.iter().enumerate() {
        let mut vars = base.clone();
        vars.extend(row.iter().cloned());
        let row_no = o.data.as_ref().map(|_| ri + 1);
        for r in &reqs {
            let url = substitute(&r.url, &vars);
            let missing = unresolved(&url);
            if !missing.is_empty() && o.reporter == "cli" {
                eprintln!("  ! variable(s) sin valor en la URL de «{}»: {}", r.name, missing.join(", "));
            }
            let method = reqwest::Method::from_bytes(r.method.as_bytes()).unwrap_or(reqwest::Method::GET);
            let mut rb = client.request(method, &url);
            for (k, v) in &r.headers {
                rb = rb.header(substitute(k, &vars), substitute(v, &vars));
            }
            if let Some((ct, body)) = &r.body {
                if !r.headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-type")) {
                    rb = rb.header("content-type", ct.as_str());
                }
                rb = rb.body(substitute(body, &vars));
            } else if !r.form.is_empty() {
                let body: Vec<String> = r.form.iter().map(|(k, v)| format!("{}={}", substitute(k, &vars), substitute(v, &vars))).collect();
                rb = rb.header("content-type", "application/x-www-form-urlencoded").body(body.join("&"));
            }
            let t0 = Instant::now();
            let out = match rb.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let size = resp.bytes().await.map(|b| b.len()).unwrap_or(0);
                    Outcome { name: r.name.clone(), row: row_no, status: Some(status), ms: t0.elapsed().as_millis(), size, error: None }
                }
                Err(e) => Outcome { name: r.name.clone(), row: row_no, status: None, ms: t0.elapsed().as_millis(), size: 0, error: Some(if e.is_timeout() { "tiempo agotado".into() } else if e.is_builder() { format!("URL no válida: {url}") } else { "sin conexión".into() }) },
            };
            if o.reporter == "cli" {
                let mark = if out.ok() { "✓" } else { "✗" };
                let st = out.status.map(|s| s.to_string()).unwrap_or_else(|| out.error.clone().unwrap_or_default());
                println!("{mark} {}{} {} {st} · {} ms · {} B", out.row.map(|n| format!("[fila {n}] ")).unwrap_or_default(), r.method, out.name, out.ms, out.size);
            }
            let failed = !out.ok();
            results.push(out);
            if failed && o.bail {
                break 'all;
            }
        }
    }
    let name = col["info"]["name"].as_str().unwrap_or("Caesar");
    let report = match o.reporter.as_str() {
        "json" => Some(json_report(&results)),
        "junit" => Some(junit(name, &results)),
        _ => None,
    };
    if let Some(text) = report {
        match &o.out {
            Some(p) => std::fs::write(p, text).map_err(|e| format!("No se pudo escribir {p}: {e}"))?,
            None => println!("{text}"),
        }
    }
    let failed = results.iter().filter(|r| !r.ok()).count();
    if o.reporter == "cli" {
        println!("\n{} peticiones · {} correctas · {} con fallo", results.len(), results.len() - failed, failed);
    }
    Ok(if failed > 0 { 1 } else { 0 })
}

const HELP: &str = "Caesar CLI — ejecuta colecciones en CI/CD (sin Node.js)\n\nUso:\n  caesar run <coleccion.json> [-e entorno.json] [--var k=v]... [--data datos.csv]\n             [--folder NOMBRE] [--bail] [--timeout SEG] [--reporter cli|json|junit] [--out ARCHIVO]\n\nSalida: 0 todo bien · 1 alguna petición falló · 2 uso incorrecto.\nNota: los scripts de tests (pm.test…) no se ejecutan; una petición es correcta si responde con estado < 400.";

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("run") {
        println!("{HELP}");
        std::process::exit(if args.is_empty() || matches!(args[0].as_str(), "-h" | "--help" | "help") { 0 } else { 2 });
    }
    let code = match parse_args(&args[1..]) {
        Ok(o) => match run(o).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Error: {e}");
                2
            }
        },
        Err(e) => {
            eprintln!("Error: {e}\n\n{HELP}");
            2
        }
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variables() {
        let mut v = HashMap::new();
        v.insert("id".into(), "7".into());
        assert_eq!(substitute("/u/{{id}}/{{ id }}/{{x}}/{{abierta", &v), "/u/7/7/{{x}}/{{abierta");
    }

    #[test]
    fn base64() {
        assert_eq!(b64(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(b64(b"a"), "YQ==");
        assert_eq!(b64(b"ab"), "YWI=");
    }

    #[test]
    fn aplana_con_carpetas_y_auth_heredada() {
        let c: Value = serde_json::from_str(r#"{"item":[
          {"name":"A","auth":{"type":"bearer","bearer":[{"key":"token","value":"T"}]},"item":[
            {"name":"uno","request":{"method":"get","url":{"raw":"http://x/{{id}}"},"header":[{"key":"H","value":"1","disabled":true}]}}]},
          {"name":"B","item":[{"name":"dos","request":{"method":"POST","url":"http://y","body":{"mode":"raw","raw":"{}","options":{"raw":{"language":"json"}}}}}]}]}"#).unwrap();
        let mut all = vec![];
        collect(&c["item"], &c["auth"], None, false, &mut all);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].method, "GET");
        assert!(all[0].headers.iter().any(|(k, v)| k == "Authorization" && v == "Bearer T"));
        assert!(!all[0].headers.iter().any(|(k, _)| k == "H"));
        assert_eq!(all[1].body.as_ref().map(|b| b.0.as_str()), Some("application/json"));
        let mut only = vec![];
        collect(&c["item"], &c["auth"], Some("B"), false, &mut only);
        assert_eq!(only.len(), 1);
        assert_eq!(only[0].name, "dos");
    }

    #[test]
    fn csv_y_variables_sin_valor() {
        assert_eq!(detect_delimiter("id;name\n1;a"), b';');
        assert_eq!(detect_delimiter("id,name"), b',');
        assert_eq!(detect_delimiter("a\tb\tc"), b'\t');
        assert_eq!(unresolved("http://x/{{id}}/{{ id }}/{{$guid}}/{{b}}/{{abierta"), vec!["id", "b"]);
    }

    #[test]
    fn argumentos_y_junit() {
        let a = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let o = parse_args(&a(&["c.json", "-e", "e.json", "--var", "a=b=c", "--bail", "--reporter", "junit"])).unwrap();
        assert_eq!((o.file.as_str(), o.vars[0].1.as_str(), o.bail), ("c.json", "b=c", true));
        assert!(parse_args(&a(&[])).is_err() && parse_args(&a(&["c.json", "--zzz"])).is_err() && parse_args(&a(&["c", "--reporter", "x"])).is_err());
        let r = vec![Outcome { name: "a<b".into(), row: None, status: Some(500), ms: 12, size: 0, error: None }];
        let x = junit("S", &r);
        assert!(x.contains("failures=\"1\"") && x.contains("a&lt;b") && x.contains("HTTP 500"));
    }
}
