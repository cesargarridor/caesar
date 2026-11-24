#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
mod deeplink;
mod ai;
mod history;
mod keyrole;
mod localcrypt;
mod limit;
mod merge;
mod oauth;
mod mock;
mod openapi;
mod pack;
mod runner;
mod secret;
mod sync;
mod team;
mod vault;
mod ws;

use std::time::{Duration, Instant};

use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE},
    multipart, redirect, Method,
};
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const MAX_COLLECTION_BYTES: u64 = 50 * 1024 * 1024; // 50 MB
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024; // 10 MB

// ───────────────────────────── Colección JSON v2.1 (entrada) ─────────────────────────────
// Parseo tolerante: todo es opcional y los campos con forma inesperada se ignoran.

fn lenient_vec<'de, D, T>(d: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    let v = Value::deserialize(d)?;
    Ok(serde_json::from_value(v).unwrap_or_default())
}

fn lenient_opt<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    let v = Option::<Value>::deserialize(d)?;
    Ok(v.and_then(|x| serde_json::from_value(x).ok()))
}

#[derive(Debug, Deserialize)]
struct PmCollection {
    info: PmInfo,
    #[serde(default, deserialize_with = "lenient_vec")]
    item: Vec<PmItem>,
    #[serde(default, deserialize_with = "lenient_vec")]
    variable: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_opt")]
    auth: Option<PmAuth>,
    #[serde(default, deserialize_with = "lenient_vec")]
    event: Vec<PmEvent>,
}

/// Evento (`prerequest` / `test`) con su script.
#[derive(Debug, Deserialize)]
struct PmEvent {
    listen: Option<String>,
    script: Option<PmScript>,
}

#[derive(Debug, Deserialize)]
struct PmScript {
    /// Array de líneas o una sola cadena.
    exec: Option<Value>,
}

/// Une los scripts `test` de una lista de eventos en un único texto.
fn test_script(events: &[PmEvent]) -> String {
    events
        .iter()
        .filter(|e| e.listen.as_deref() == Some("test"))
        .filter_map(|e| e.script.as_ref()?.exec.as_ref())
        .map(|x| match x {
            Value::Array(a) => a.iter().filter_map(|l| l.as_str()).collect::<Vec<_>>().join("\n"),
            Value::String(s) => s.clone(),
            _ => String::new(),
        })
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Concatena el script heredado (colección/carpeta) con el propio.
fn join_scripts(parent: &str, own: String) -> String {
    match (parent.trim().is_empty(), own.trim().is_empty()) {
        (true, _) => own,
        (_, true) => parent.to_string(),
        _ => format!("{parent}\n{own}"),
    }
}

#[derive(Debug, Deserialize)]
struct PmInfo {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PmItem {
    name: Option<String>,
    /// Presente => es una carpeta.
    #[serde(default, deserialize_with = "lenient_opt_items")]
    item: Option<Vec<PmItem>>,
    #[serde(default, deserialize_with = "lenient_opt")]
    request: Option<PmRequestField>,
    #[serde(default, deserialize_with = "lenient_opt")]
    auth: Option<PmAuth>,
    #[serde(default, deserialize_with = "lenient_vec")]
    event: Vec<PmEvent>,
}

fn lenient_opt_items<'de, D>(d: D) -> Result<Option<Vec<PmItem>>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::Array(a)) => Some(
            a.into_iter()
                .filter_map(|x| serde_json::from_value(x).ok())
                .collect(),
        ),
        _ => None,
    })
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PmRequestField {
    Raw(String),
    Full(PmRequest),
}

#[derive(Debug, Deserialize)]
struct PmRequest {
    method: Option<String>,
    #[serde(default, deserialize_with = "lenient_vec")]
    header: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_opt")]
    url: Option<PmUrl>,
    #[serde(default, deserialize_with = "lenient_opt")]
    body: Option<PmBody>,
    #[serde(default, deserialize_with = "lenient_opt")]
    auth: Option<PmAuth>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PmUrl {
    Raw(String),
    Obj(PmUrlObj),
}

#[derive(Debug, Deserialize)]
struct PmUrlObj {
    raw: Option<String>,
    protocol: Option<String>,
    host: Option<Value>,
    path: Option<Value>,
}

#[derive(Debug, Deserialize, Clone)]
struct PmKeyValue {
    key: Option<String>,
    value: Option<Value>,
    disabled: Option<bool>,
    #[serde(rename = "type")]
    kind: Option<String>,
    src: Option<Value>,
    #[serde(rename = "contentType")]
    content_type: Option<String>,
    /// Entornos/variables: el valor actual y el inicial pueden venir aparte de `value`.
    #[serde(rename = "currentValue")]
    current_value: Option<Value>,
    #[serde(rename = "initialValue")]
    initial_value: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct PmBody {
    mode: Option<String>,
    raw: Option<String>,
    #[serde(default, deserialize_with = "lenient_vec")]
    formdata: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    urlencoded: Vec<PmKeyValue>,
    options: Option<Value>,
    graphql: Option<Value>,
}

#[derive(Debug, Deserialize, Clone)]
struct PmAuth {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient_vec")]
    bearer: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    basic: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    apikey: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    digest: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    ntlm: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    oauth1: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    oauth2: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    awsv4: Vec<PmKeyValue>,
    #[serde(default, deserialize_with = "lenient_vec")]
    edgegrid: Vec<PmKeyValue>,
}

// ───────────────────────────── Árbol seguro (salida hacia el frontend) ─────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Kv {
    key: String,
    value: String,
    enabled: bool,
    /// "text" (por defecto) | "file" (solo form-data)
    #[serde(default)]
    kind: String,
    /// Ruta del archivo cuando kind == "file" (debe haberse elegido con el selector nativo).
    #[serde(default)]
    path: String,
    /// Content-Type de la parte multipart (vacío = automático).
    #[serde(default, rename = "contentType")]
    content_type: String,
}

/// Valida un Content-Type de parte: solo `tipo/subtipo` con caracteres seguros (sin saltos de línea).
fn clean_part_type(ct: &str) -> Option<&str> {
    let ct = ct.trim();
    let ok = !ct.is_empty()
        && ct.len() <= 100
        && ct.contains('/')
        && ct.chars().all(|c| c.is_ascii_alphanumeric() || "/+.-*_;= \"".contains(c));
    ok.then_some(ct)
}

/// Rutas que el usuario eligió con el diálogo nativo en esta sesión.
/// El frontend NO puede pedir a Rust que lea una ruta arbitraria: solo las de este conjunto.
#[derive(Default)]
struct GrantedFiles(std::sync::Mutex<std::collections::HashSet<std::path::PathBuf>>);

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct BodyData {
    /// "none" | "json" | "text" | "formdata" | "urlencoded" | "graphql"
    mode: String,
    #[serde(default)]
    raw: String,
    #[serde(default)]
    formdata: Vec<Kv>,
    #[serde(default)]
    urlencoded: Vec<Kv>,
    /// Modo "graphql": consulta y variables (JSON en texto).
    #[serde(default, rename = "gqlQuery")]
    gql_query: String,
    #[serde(default, rename = "gqlVars")]
    gql_vars: String,
    #[serde(default, rename = "gqlOp")]
    gql_op: String,
}

#[derive(Debug, Serialize, Clone, Default)]
struct AuthData {
    /// "none" | "bearer" | "basic" | "apikey" | "digest" | "ntlm" | "oauth1" | "oauth2" | "awsv4" | "akamai"
    #[serde(rename = "type")]
    kind: String,
    token: String,
    username: String,
    password: String,
    key: String,
    value: String,
    #[serde(rename = "in")]
    location: String,
    /// Campos propios de cada tipo (OAuth, AWS, NTLM…), con los mismos nombres que usa la interfaz.
    extra: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum TreeNode {
    Folder {
        name: String,
        children: Vec<TreeNode>,
    },
    Request {
        name: String,
        method: String,
        url: String,
        headers: Vec<Kv>,
        body: BodyData,
        auth: AuthData,
        /// Script de tests (post-respuesta), heredado de colección/carpeta + propio.
        tests: String,
    },
}

#[derive(Debug, Serialize)]
struct ImportedCollection {
    root: TreeNode,
    variables: Vec<Kv>,
}

fn value_to_string(v: &Option<Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

/// Primer valor no vacío de la lista (value → currentValue → initialValue).
fn first_value(vals: &[&Option<Value>]) -> String {
    for v in vals {
        let s = value_to_string(v);
        if !s.is_empty() {
            return s;
        }
    }
    String::new()
}

fn convert_kvs(list: Vec<PmKeyValue>) -> Vec<Kv> {
    list.into_iter()
        .map(|kv| {
            let is_file = kv.kind.as_deref() == Some("file");
            let src = match &kv.src {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Array(a)) => a.first().and_then(|x| x.as_str()).unwrap_or("").to_string(),
                _ => String::new(),
            };
            let name = std::path::Path::new(&src)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            Kv {
                key: kv.key.unwrap_or_default(),
                // Archivo importado: solo mostramos el nombre; hay que reseleccionarlo para poder enviarlo.
                value: if is_file { name } else { first_value(&[&kv.value, &kv.current_value, &kv.initial_value]) },
                enabled: !kv.disabled.unwrap_or(false),
                kind: if is_file { "file".into() } else { "text".into() },
                path: String::new(),
                content_type: kv.content_type.clone().unwrap_or_default(),
            }
        })
        .collect()
}

fn kv_get(list: &[PmKeyValue], key: &str) -> String {
    list.iter()
        .find(|k| k.key.as_deref() == Some(key))
        .map(|k| value_to_string(&k.value))
        .unwrap_or_default()
}

/// `None` = el item no define auth (hereda del padre).
fn convert_auth(auth: Option<PmAuth>) -> Option<AuthData> {
    let a = auth?;
    let mut out = AuthData::default();
    match a.kind.as_deref() {
        Some("noauth") => out.kind = "none".into(),
        Some("bearer") => {
            out.kind = "bearer".into();
            out.token = kv_get(&a.bearer, "token");
        }
        Some("basic") => {
            out.kind = "basic".into();
            out.username = kv_get(&a.basic, "username");
            out.password = kv_get(&a.basic, "password");
        }
        Some("apikey") => {
            out.kind = "apikey".into();
            out.key = kv_get(&a.apikey, "key");
            out.value = kv_get(&a.apikey, "value");
            out.location = if kv_get(&a.apikey, "in") == "query" {
                "query".into()
            } else {
                "header".into()
            };
        }
        Some("digest") => {
            out.kind = "digest".into();
            out.username = kv_get(&a.digest, "username");
            out.password = kv_get(&a.digest, "password");
        }
        Some("ntlm") => {
            out.kind = "ntlm".into();
            out.username = kv_get(&a.ntlm, "username");
            out.password = kv_get(&a.ntlm, "password");
            put(&mut out, "domain", kv_get(&a.ntlm, "domain"));
            put(&mut out, "workstation", kv_get(&a.ntlm, "workstation"));
        }
        Some("oauth1") => {
            out.kind = "oauth1".into();
            for k in ["consumerKey", "consumerSecret", "token", "tokenSecret", "signatureMethod", "realm"] {
                put(&mut out, k, kv_get(&a.oauth1, k));
            }
            let in_header = kv_get(&a.oauth1, "addParamsToHeader") != "false";
            put(&mut out, "addTo", if in_header { "header" } else { "query" }.into());
        }
        Some("oauth2") => {
            out.kind = "oauth2".into();
            let grant = kv_get(&a.oauth2, "grant_type");
            let g = match grant.as_str() {
                "client_credentials" => "client_credentials",
                "password_credentials" | "password" => "password",
                "authorization_code" | "authorization_code_with_pkce" => "authorization_code",
                "implicit" => "implicit",
                _ => "manual",
            };
            // Sin URL de token no se puede pedir uno: se queda con el token que traiga el archivo.
            let url = kv_get(&a.oauth2, "accessTokenUrl");
            let auth_url = kv_get(&a.oauth2, "authUrl");
            // El flujo con ventana necesita la Authorization URL (y el implícito no pide token por URL).
            let g = match g {
                "implicit" if auth_url.is_empty() => "manual",
                "authorization_code" if auth_url.is_empty() || url.is_empty() => "manual",
                "client_credentials" | "password" if url.is_empty() => "manual",
                other => other,
            };
            put(&mut out, "grantType", g.into());
            put(&mut out, "authUrl", auth_url);
            put(&mut out, "redirectUri", kv_get(&a.oauth2, "redirect_uri"));
            put(&mut out, "accessToken", kv_get(&a.oauth2, "accessToken"));
            put(&mut out, "accessTokenUrl", url);
            put(&mut out, "clientId", kv_get(&a.oauth2, "clientId"));
            put(&mut out, "clientSecret", kv_get(&a.oauth2, "clientSecret"));
            put(&mut out, "scope", kv_get(&a.oauth2, "scope"));
            let prefix = kv_get(&a.oauth2, "headerPrefix");
            put(&mut out, "headerPrefix", if prefix.is_empty() { "Bearer".into() } else { prefix });
            let to = if kv_get(&a.oauth2, "addTokenTo") == "queryParams" { "query" } else { "header" };
            put(&mut out, "addTokenTo", to.into());
            out.username = kv_get(&a.oauth2, "username");
            out.password = kv_get(&a.oauth2, "password");
        }
        Some("awsv4") => {
            out.kind = "awsv4".into();
            for k in ["accessKey", "secretKey", "region", "service", "sessionToken"] {
                put(&mut out, k, kv_get(&a.awsv4, k));
            }
        }
        Some("edgegrid") => {
            out.kind = "akamai".into();
            for (to, from) in [
                ("accessToken", "accessToken"),
                ("clientToken", "clientToken"),
                ("clientSecret", "clientSecret"),
                ("baseUri", "baseURL"),
                ("nonce", "nonce"),
                ("timestamp", "timestamp"),
                ("headersToSign", "headersToSign"),
            ] {
                put(&mut out, to, kv_get(&a.edgegrid, from));
            }
        }
        _ => return None,
    }
    Some(out)
}

fn put(a: &mut AuthData, k: &str, v: String) {
    if !v.is_empty() {
        a.extra.insert(k.to_string(), v);
    }
}

fn none_auth() -> AuthData {
    AuthData {
        kind: "none".into(),
        location: "header".into(),
        ..Default::default()
    }
}

/// host/path pueden ser un string o un array de strings.
fn join_value(v: &Option<Value>, sep: &str) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str())
            .collect::<Vec<_>>()
            .join(sep),
        _ => String::new(),
    }
}

fn convert_url(url: Option<PmUrl>) -> String {
    match url {
        Some(PmUrl::Raw(s)) => s,
        Some(PmUrl::Obj(o)) => {
            if let Some(raw) = o.raw.filter(|r| !r.is_empty()) {
                return raw;
            }
            let host = join_value(&o.host, ".");
            let path = join_value(&o.path, "/");
            let scheme = o.protocol.unwrap_or_else(|| "https".to_string());
            if host.is_empty() {
                String::new()
            } else {
                format!("{scheme}://{host}/{path}")
            }
        }
        None => String::new(),
    }
}

fn convert_body(body: Option<PmBody>) -> BodyData {
    let Some(b) = body else {
        return BodyData {
            mode: "none".into(),
            ..Default::default()
        };
    };
    match b.mode.as_deref() {
        Some("raw") => {
            let raw = b.raw.unwrap_or_default();
            let lang = b
                .options
                .as_ref()
                .and_then(|o| o.get("raw"))
                .and_then(|r| r.get("language"))
                .and_then(|l| l.as_str())
                .unwrap_or("");
            let t = raw.trim_start();
            let is_json = lang == "json" || (lang.is_empty() && (t.starts_with('{') || t.starts_with('[')));
            BodyData {
                mode: if is_json { "json" } else { "text" }.into(),
                raw,
                ..Default::default()
            }
        }
        Some("formdata") => BodyData {
            mode: "formdata".into(),
            formdata: convert_kvs(b.formdata),
            ..Default::default()
        },
        Some("urlencoded") => BodyData {
            mode: "urlencoded".into(),
            urlencoded: convert_kvs(b.urlencoded),
            ..Default::default()
        },
        Some("graphql") => {
            let g = b.graphql.unwrap_or(Value::Null);
            let s = |k: &str| g.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            BodyData {
                mode: "graphql".into(),
                gql_query: s("query"),
                gql_vars: s("variables"),
                ..Default::default()
            }
        }
        _ => BodyData {
            mode: "none".into(),
            ..Default::default()
        },
    }
}

fn convert_items(items: Vec<PmItem>, parent_auth: &AuthData, parent_tests: &str) -> Vec<TreeNode> {
    items
        .into_iter()
        .filter_map(|item| {
            let name = item.name.unwrap_or_else(|| "Sin nombre".to_string());
            let own_auth = convert_auth(item.auth).unwrap_or_else(|| parent_auth.clone());
            let tests = join_scripts(parent_tests, test_script(&item.event));
            if let Some(children) = item.item {
                return Some(TreeNode::Folder {
                    name,
                    children: convert_items(children, &own_auth, &tests),
                });
            }
            match item.request? {
                PmRequestField::Raw(url) => Some(TreeNode::Request {
                    name,
                    method: "GET".into(),
                    url,
                    headers: vec![],
                    body: convert_body(None),
                    auth: own_auth,
                    tests,
                }),
                PmRequestField::Full(r) => Some(TreeNode::Request {
                    name,
                    method: r.method.unwrap_or_else(|| "GET".into()).to_uppercase(),
                    url: convert_url(r.url),
                    headers: convert_kvs(r.header),
                    body: convert_body(r.body),
                    auth: convert_auth(r.auth).unwrap_or(own_auth),
                    tests,
                }),
            }
        })
        .collect()
}

fn parse_collection_json(content: &str) -> Result<ImportedCollection, String> {
    let col: PmCollection = serde_json::from_str(content)
        .map_err(|e| format!("El archivo no es una colección JSON v2.1 válida: {e}"))?;
    let root_auth = convert_auth(col.auth).unwrap_or_else(none_auth);
    let variables: Vec<Kv> = convert_kvs(col.variable)
        .into_iter()
        .filter(|v| !v.key.is_empty())
        .collect();
    Ok(ImportedCollection {
        root: TreeNode::Folder {
            name: col.info.name.unwrap_or_else(|| "Colección importada".into()),
            children: convert_items(col.item, &root_auth, &test_script(&col.event)),
        },
        variables,
    })
}

// ───────────────────────────── Comando IPC: importar ─────────────────────────────

/// Abre el selector nativo, lee y parsea el JSON. `Ok(None)` = el usuario canceló.
#[tauri::command]
async fn import_collection_file(
    app: tauri::AppHandle,
) -> Result<Option<ImportedCollection>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Colección (JSON)", &["json"])
        .blocking_pick_file();

    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|e| format!("Ruta de archivo no válida: {e}"))?;

    let meta = std::fs::metadata(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    if !meta.is_file() {
        return Err("La selección no es un archivo".into());
    }
    if meta.len() > MAX_COLLECTION_BYTES {
        return Err("El archivo supera el límite de 50 MB".into());
    }

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    parse_collection_json(&content).map(Some)
}

#[derive(Debug, Serialize)]
struct TextFile {
    name: String,
    content: String,
}

/// Elige un archivo de colección o esquema (JSON, YAML, HAR o GraphQL) y devuelve su texto. `Ok(None)` = canceló.
#[tauri::command]
async fn pick_text_file(app: tauri::AppHandle) -> Result<Option<TextFile>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Colección o esquema (JSON, YAML, HAR, GraphQL)", &["json", "yaml", "yml", "har", "graphql", "gql"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| format!("Ruta de archivo no válida: {e}"))?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    if !meta.is_file() {
        return Err("La selección no es un archivo".into());
    }
    if meta.len() > MAX_COLLECTION_BYTES {
        return Err("El archivo supera el límite de 50 MB".into());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("No se pudo leer el archivo (¿es de texto?): {e}"))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Some(TextFile { name, content }))
}

/// Como `pick_text_file`, pero permite elegir varios archivos a la vez (p. ej. una colección y su entorno de Postman). Vacío = canceló.
#[tauri::command]
async fn pick_text_files(app: tauri::AppHandle) -> Result<Vec<TextFile>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Colección o entorno (JSON, YAML o HAR)", &["json", "yaml", "yml", "har"])
        .blocking_pick_files();
    let Some(files) = picked else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for file in files.into_iter().take(20) {
        let path = file.into_path().map_err(|e| format!("Ruta de archivo no válida: {e}"))?;
        let meta = std::fs::metadata(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
        if !meta.is_file() {
            return Err("La selección no es un archivo".into());
        }
        if meta.len() > MAX_COLLECTION_BYTES {
            return Err("El archivo supera el límite de 50 MB".into());
        }
        let content = std::fs::read_to_string(&path).map_err(|e| format!("No se pudo leer el archivo (¿es de texto?): {e}"))?;
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        out.push(TextFile { name, content });
    }
    Ok(out)
}

/// Convierte el texto de una colección JSON v2.1 (la interfaz ya detectó el formato).
#[tauri::command]
fn parse_collection_content(content: String) -> Result<ImportedCollection, String> {
    if content.len() as u64 > MAX_COLLECTION_BYTES {
        return Err("El contenido supera el límite de 50 MB".into());
    }
    parse_collection_json(&content)
}

// ───────────────────────────── Comando IPC: elegir archivo para form-data ─────────────────────────────

#[derive(Debug, Serialize)]
struct PickedFile {
    path: String,
    name: String,
    size: u64,
}

const MAX_UPLOAD_BYTES: u64 = 100 * 1024 * 1024; // 100 MB

#[tauri::command]
async fn pick_file(
    app: tauri::AppHandle,
    granted: tauri::State<'_, GrantedFiles>,
) -> Result<Option<PickedFile>, String> {
    let Some(file) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|e| format!("Ruta de archivo no válida: {e}"))?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    if !meta.is_file() {
        return Err("La selección no es un archivo".into());
    }
    if meta.len() > MAX_UPLOAD_BYTES {
        return Err("El archivo supera el límite de 100 MB".into());
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let shown = path.to_string_lossy().into_owned();
    granted
        .0
        .lock()
        .map_err(|_| "Estado interno bloqueado".to_string())?
        .insert(path);
    Ok(Some(PickedFile { path: shown, name, size: meta.len() }))
}

/// Abre "Guardar como" nativo y escribe el texto. `Ok(None)` = el usuario canceló.
/// El frontend solo aporta el nombre sugerido y el contenido; la ruta la elige el usuario en el diálogo.
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    suggested_name: String,
    content: String,
    ext: Option<String>,
) -> Result<Option<String>, String> {
    if content.len() as u64 > MAX_COLLECTION_BYTES {
        return Err("El contenido supera el límite de 50 MB".into());
    }
    // Nombre sugerido saneado: sin separadores de ruta.
    let name: String = suggested_name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let Some(file) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter(
            match ext.as_deref() {
                Some("yaml") => "YAML",
                Some("har") => "HAR",
                _ => "JSON",
            },
            match ext.as_deref() {
                Some("yaml") => &["yaml", "yml"][..],
                Some("har") => &["har"][..],
                _ => &["json"][..],
            },
        )
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|e| format!("Ruta de archivo no válida: {e}"))?;
    tokio::fs::write(&path, content.as_bytes())
        .await
        .map_err(|e| format!("No se pudo guardar el archivo: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// «Guardar como» para una respuesta: texto (`content`) o bytes en base64 (`data_b64`). `Ok(None)` = el usuario canceló.
#[tauri::command]
async fn save_response_file(
    app: tauri::AppHandle,
    suggested_name: String,
    content: Option<String>,
    data_b64: Option<String>,
) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let bytes = match (data_b64, content) {
        (Some(b), _) => B64.decode(b.as_bytes()).map_err(|_| "Los datos de la respuesta no son válidos.".to_string())?,
        (None, Some(c)) => c.into_bytes(),
        (None, None) => return Err("No hay contenido que guardar.".into()),
    };
    if bytes.len() > MAX_BINARY_RESPONSE_BYTES {
        return Err("La respuesta supera el límite de 50 MB.".into());
    }
    let name: String = suggested_name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let Some(file) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| format!("Ruta de archivo no válida: {e}"))?;
    tokio::fs::write(&path, &bytes).await.map_err(|e| format!("No se pudo guardar el archivo: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("txt") => "text/plain",
        Some("csv") => "text/csv",
        Some("xml") => "application/xml",
        Some("html") => "text/html",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("zip") => "application/zip",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("xls") => "application/vnd.ms-excel",
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

// ───────────────────────────── Comando IPC: ejecutar petición ─────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    follow_redirects: bool,
    timeout_secs: u64,
    verify_ssl: bool,
    /** "auto" (se negocia: HTTP/2 si el servidor lo ofrece), "1.1" o "2". */
    #[serde(default)]
    http_version: String,
}

#[derive(Debug, Deserialize)]
struct RequestArgs {
    method: String,
    url: String,
    headers: Vec<Kv>,
    body: BodyData,
    settings: Settings,
    /// Misma sesión = mismo cliente HTTP y misma conexión (necesario para NTLM, que autentica la conexión).
    #[serde(default)]
    session: String,
}

/// Último cliente de sesión usado (solo se guarda uno).
static SESSION_CLIENT: std::sync::Mutex<Option<(String, reqwest::Client)>> = std::sync::Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseData {
    status: u16,
    status_text: String,
    time_ms: u64,
    size_bytes: usize,
    truncated: bool,
    headers: Vec<(String, String)>,
    /// Cuerpo original tal cual llegó.
    body: String,
    /// Versión indentada si el cuerpo es JSON válido.
    pretty: Option<String>,
    /// Pasos de la petición con su duración.
    timeline: Vec<StepInfo>,
    /// Tipo de contenido: "text" (incluye JSON y XML), "html", "pdf", "image", "audio", "video" o "binary".
    kind: String,
    /// Cabecera Content-Type sin parámetros (puede estar vacía).
    content_type: String,
    /// Nombre sugerido para guardar la respuesta (Content-Disposition o último tramo de la URL).
    file_name: String,
    /// Bytes de la respuesta en base64 (todo salvo text y html, donde va `body`).
    body_b64: Option<String>,
}

const MAX_BINARY_RESPONSE_BYTES: usize = 50 * 1024 * 1024; // 50 MB para PDF, imágenes y descargas

/// Clasifica por Content-Type y, si no basta, por los primeros bytes.
fn classify_body(content_type: &str, buf: &[u8]) -> &'static str {
    let ct = content_type.to_ascii_lowercase();
    if ct.contains("html") && !ct.contains("xhtml+xml-binary") {
        return "html";
    }
    if ct == "application/pdf" || buf.starts_with(b"%PDF-") {
        return "pdf";
    }
    if ct.starts_with("image/") || buf.starts_with(b"\x89PNG\r\n\x1a\n") || buf.starts_with(&[0xFF, 0xD8, 0xFF]) || buf.starts_with(b"GIF8") || (buf.len() > 12 && &buf[..4] == b"RIFF" && &buf[8..12] == b"WEBP") {
        return "image";
    }
    if ct.starts_with("audio/") || buf.starts_with(b"ID3") || buf.starts_with(b"OggS") || buf.starts_with(b"fLaC") || (buf.len() > 12 && &buf[..4] == b"RIFF" && &buf[8..12] == b"WAVE") {
        return "audio";
    }
    if ct.starts_with("video/") || (buf.len() >= 8 && &buf[4..8] == b"ftyp") || buf.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return "video";
    }
    let texty = ct.starts_with("text/")
        || ["json", "xml", "javascript", "yaml", "x-www-form-urlencoded", "graphql", "csv", "x-ndjson"].iter().any(|k| ct.contains(k));
    if texty {
        return "text";
    }
    if ct.is_empty() || ct == "application/octet-stream" {
        // Sin pista: es texto si es UTF-8 válido y sin bytes nulos.
        if !buf.contains(&0) && std::str::from_utf8(buf).is_ok() {
            let head = String::from_utf8_lossy(&buf[..buf.len().min(512)]).to_ascii_lowercase();
            return if head.trim_start().starts_with("<!doctype html") || head.trim_start().starts_with("<html") { "html" } else { "text" };
        }
        return "binary";
    }
    if !buf.contains(&0) && std::str::from_utf8(buf).is_ok() && !ct.starts_with("audio/") && !ct.starts_with("video/") && !ct.contains("zip") {
        return "text";
    }
    "binary"
}

fn is_download_type(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    !(ct.is_empty() || ct.starts_with("text/") || ct.contains("json") || ct.contains("xml") || ct.contains("javascript") || ct.contains("yaml") || ct.contains("x-www-form-urlencoded") || ct.contains("graphql"))
}

/// Nombre de archivo sugerido: `filename=` de Content-Disposition, o el último tramo de la URL, o uno por tipo.
fn suggest_file_name(headers: &[(String, String)], url_path: &str, kind: &str, content_type: &str) -> String {
    let clean = |n: &str| -> String {
        n.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c }).collect::<String>().trim().to_string()
    };
    if let Some((_, cd)) = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("content-disposition")) {
        for part in cd.split(';') {
            let part = part.trim();
            if let Some(v) = part.strip_prefix("filename=") {
                let n = clean(v.trim().trim_matches('"'));
                if !n.is_empty() {
                    return n;
                }
            }
        }
    }
    let last = url_path.rsplit('/').find(|x| !x.is_empty()).unwrap_or("");
    let ext = match (kind, content_type.to_ascii_lowercase().as_str()) {
        ("pdf", _) => "pdf",
        ("html", _) => "html",
        (_, "image/png") => "png",
        (_, "image/jpeg") => "jpg",
        (_, "image/gif") => "gif",
        (_, "image/webp") => "webp",
        (_, "image/svg+xml") => "svg",
        (_, "application/zip") => "zip",
        (_, ct) if ct.contains("json") => "json",
        (_, ct) if ct.contains("xml") => "xml",
        (_, ct) if ct.starts_with("text/") => "txt",
        ("text", _) => "txt",
        _ => "bin",
    };
    if !last.is_empty() {
        let n = clean(last);
        if n.contains('.') {
            return n;
        }
        return format!("{n}.{ext}");
    }
    format!("respuesta.{ext}")
}

#[derive(Debug, Serialize, Clone)]
struct StepInfo {
    id: String,
    label: String,
    ms: u64,
    detail: String,
}

/// Evento enviado al frontend mientras avanza la petición.
#[derive(Debug, Serialize, Clone)]
struct Progress {
    id: String,
    label: String,
    /// "start" | "progress" | "done" | "error"
    state: String,
    ms: u64,
    detail: String,
}

struct Tracker {
    app: tauri::AppHandle,
    t0: Instant,
    steps: Vec<StepInfo>,
}

impl Tracker {
    fn new(app: tauri::AppHandle) -> Self {
        Tracker { app, t0: Instant::now(), steps: vec![] }
    }
    fn emit(&self, id: &str, label: &str, state: &str, ms: u64, detail: &str) {
        let _ = self.app.emit(
            "request-progress",
            Progress {
                id: id.into(),
                label: label.into(),
                state: state.into(),
                ms,
                detail: detail.into(),
            },
        );
    }
    fn begin(&self, id: &str, label: &str) {
        self.emit(id, label, "start", self.t0.elapsed().as_millis() as u64, "");
    }
    fn progress(&self, id: &str, label: &str, started: Instant, detail: &str) {
        self.emit(id, label, "progress", started.elapsed().as_millis() as u64, detail);
    }
    fn done(&mut self, id: &str, label: &str, started: Instant, detail: String) {
        let ms = started.elapsed().as_millis() as u64;
        self.emit(id, label, "done", ms, &detail);
        self.steps.push(StepInfo { id: id.into(), label: label.into(), ms, detail });
    }
    fn fail(&self, id: &str, label: &str, started: Instant, detail: &str) {
        self.emit(id, label, "error", started.elapsed().as_millis() as u64, detail);
    }
}

/// ¿Es una IP de metadatos cloud / link-local? (169.254.0.0/16, fd00:ec2::254 y sus formas IPv4-mapped).
pub(crate) fn is_metadata_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => v4.octets()[0] == 169 && v4.octets()[1] == 254,
        IpAddr::V6(v6) => {
            if v6 == "fd00:ec2::254".parse::<std::net::Ipv6Addr>().unwrap() {
                return true;
            }
            match v6.to_ipv4_mapped() {
                Some(v4) => is_metadata_ip(IpAddr::V4(v4)),
                None => false,
            }
        }
    }
}

/// Host de metadatos cloud (usa el enum de `url`, que ya normaliza formas decimal/hex/octal).
pub(crate) fn is_metadata_host(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Ipv4(a) => is_metadata_ip(std::net::IpAddr::V4(*a)),
        url::Host::Ipv6(a) => is_metadata_ip(std::net::IpAddr::V6(*a)),
        url::Host::Domain(d) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d == "metadata.google.internal" || d == "metadata"
        }
    }
}

/// IP de la red interna: loopback, no especificada, privada (RFC1918), link-local, CGNAT 100.64/10, ULA fc00::/7.
pub(crate) fn is_internal_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_unspecified()
                || v4.is_private()
                || v4.is_link_local()
                || (o[0] == 100 && (o[1] & 0xC0) == 64)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_internal_ip(IpAddr::V4(v4));
            }
            let s0 = v6.segments()[0];
            v6.is_loopback() || v6.is_unspecified() || (s0 & 0xFE00) == 0xFC00 || (s0 & 0xFFC0) == 0xFE80
        }
    }
}

/// Host de la red interna (IP interna, `localhost`, `*.local`, nombres sin punto y sufijos típicos de LAN).
pub(crate) fn is_internal_host(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Ipv4(a) => is_internal_ip(std::net::IpAddr::V4(*a)),
        url::Host::Ipv6(a) => is_internal_ip(std::net::IpAddr::V6(*a)),
        url::Host::Domain(d) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d == "localhost"
                || !d.contains('.')
                || [".localhost", ".local", ".internal", ".lan", ".localdomain", ".home.arpa"].iter().any(|suf| d.ends_with(suf))
        }
    }
}

pub(crate) fn url_is_internal(u: &Url) -> bool {
    u.host().map_or(false, |h| is_internal_host(&h))
}

pub(crate) fn url_targets_metadata(u: &Url) -> bool {
    u.host().map_or(false, |h| is_metadata_host(&h))
}

/// Resolver DNS que descarta direcciones de metadatos/link-local (anti DNS rebinding).
struct SafeResolver;
impl reqwest::dns::Resolve for SafeResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?
                .filter(|a| !is_metadata_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err(Box::<dyn std::error::Error + Send + Sync>::from(
                    "El host resuelve solo a direcciones de metadatos/link-local (bloqueado)",
                ));
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// Validación estática de la URL antes de que llegue a reqwest.
fn validate_url(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("La URL está vacía".into());
    }
    let url = Url::parse(raw).map_err(|e| {
        format!("URL inválida ({e}). Si usa variables {{{{var}}}}, defínalas en el panel Variables.")
    })?;
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Esquema no permitido: '{other}' (solo http/https)")),
    }
    if url.host_str().map_or(true, str::is_empty) {
        return Err("La URL no tiene host".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Las credenciales embebidas en la URL no están permitidas".into());
    }
    if url_targets_metadata(&url) {
        return Err("Host de metadatos/link-local bloqueado (169.254.0.0/16, metadata.google.internal)".into());
    }
    Ok(url)
}

fn parse_method(m: &str) -> Result<Method, String> {
    match m.trim().to_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "DELETE" => Ok(Method::DELETE),
        "PATCH" => Ok(Method::PATCH),
        "HEAD" => Ok(Method::HEAD),
        "OPTIONS" => Ok(Method::OPTIONS),
        // CONNECT (túnel) y TRACE no tienen sentido en un cliente de APIs.
        "CONNECT" | "TRACE" => Err(format!("Método HTTP no soportado: {}", m.trim().to_uppercase())),
        // PROPFIND, MKCOL, COPY, LOCK, PURGE, LINK, VIEW… (WebDAV y extensiones)
        other if !other.is_empty() && other.len() <= 20 && other.bytes().all(|b| b.is_ascii_uppercase() || b == b'-') => {
            Method::from_bytes(other.as_bytes()).map_err(|_| format!("Método HTTP no válido: {other}"))
        }
        other => Err(format!("Método HTTP no soportado: {other}")),
    }
}

fn build_headers(list: &[Kv]) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for kv in list.iter().filter(|k| k.enabled && !k.key.trim().is_empty()) {
        let name = HeaderName::from_bytes(kv.key.trim().as_bytes())
            .map_err(|_| format!("Nombre de header inválido: '{}'", kv.key))?;
        let value = HeaderValue::from_str(kv.value.trim())
            .map_err(|_| format!("Valor de header inválido para '{}'", kv.key))?;
        map.append(name, value);
    }
    Ok(map)
}

async fn load_file_part(
    granted: &GrantedFiles,
    path: &str,
    shown_name: &str,
) -> Result<multipart::Part, String> {
    let p = std::path::PathBuf::from(path);
    let allowed = granted
        .0
        .lock()
        .map(|set| set.contains(&p))
        .unwrap_or(false);
    if !path.is_empty() && !allowed || path.is_empty() {
        return Err(format!(
            "El archivo '{shown_name}' no está autorizado en esta sesión. Vuelve a seleccionarlo con el botón de archivo."
        ));
    }
    let meta = tokio::fs::metadata(&p)
        .await
        .map_err(|e| format!("No se pudo leer '{shown_name}': {e}"))?;
    if meta.len() > MAX_UPLOAD_BYTES {
        return Err(format!("'{shown_name}' supera el límite de 100 MB"));
    }
    let bytes = tokio::fs::read(&p)
        .await
        .map_err(|e| format!("No se pudo leer '{shown_name}': {e}"))?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    multipart::Part::bytes(bytes)
        .file_name(name.clone())
        .mime_str(mime_for(&name))
        .map_err(|e| format!("Tipo MIME inválido: {e}"))
}

#[tauri::command]
async fn execute_request(
    app: tauri::AppHandle,
    granted: tauri::State<'_, GrantedFiles>,
    args: RequestArgs,
) -> Result<ResponseData, String> {
    let mut tr = Tracker::new(app);

    // 1) Validación estática
    const L_VAL: &str = "Validando petición";
    tr.begin("validate", L_VAL);
    let t = Instant::now();
    let prep = (|| -> Result<(Url, Method, HeaderMap), String> {
        Ok((
            validate_url(&args.url)?,
            parse_method(&args.method)?,
            build_headers(&args.headers)?,
        ))
    })();
    let (url, method, mut headers) = match prep {
        Ok(v) => v,
        Err(e) => {
            tr.fail("validate", L_VAL, t, &e);
            return Err(e);
        }
    };
    tr.done("validate", L_VAL, t, format!("{} {}", method, url.host_str().unwrap_or("")));

    // 2) DNS (informativo: si falla localmente, reqwest lo reintenta por su cuenta)
    const L_DNS: &str = "Resolviendo DNS";
    tr.begin("dns", L_DNS);
    let t = Instant::now();
    let host = url.host_str().unwrap_or("").to_string();
    let port = url.port_or_known_default().unwrap_or(80);
    let dns_detail = if host.parse::<std::net::IpAddr>().is_ok() || host.starts_with('[') {
        format!("IP directa {host}")
    } else {
        match tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::lookup_host((host.as_str(), port)),
        )
        .await
        {
            Ok(Ok(mut it)) => it
                .next()
                .map(|a| format!("{host} → {}", a.ip()))
                .unwrap_or_else(|| "sin resultados".into()),
            _ => "no resuelto localmente".into(),
        }
    };
    tr.done("dns", L_DNS, t, dns_detail);

    // Límite máximo de 1 hora: 0 (o más de 3600) = 1 hora, para poder depurar el servidor sin que salte el error de espera.
    let timeout = match args.settings.timeout_secs {
        0 => 3600,
        n => n.min(3600),
    };
    let policy = if args.settings.follow_redirects {
        redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 {
                attempt.error("Demasiadas redirecciones (máximo 10)")
            } else if url_targets_metadata(attempt.url()) {
                attempt.error("Redirección a host de metadatos/link-local bloqueada")
            } else if url_is_internal(attempt.url()) && attempt.previous().first().map_or(false, |o| !url_is_internal(o)) {
                attempt.error("Redirección de un host público a la red interna bloqueada")
            } else {
                attempt.follow()
            }
        })
    } else {
        redirect::Policy::none()
    };
    let reused = if args.session.is_empty() {
        None
    } else {
        SESSION_CLIENT
            .lock()
            .ok()
            .and_then(|g| g.as_ref().filter(|(id, _)| *id == args.session).map(|(_, c)| c.clone()))
    };
    let client = match reused {
        Some(c) => c,
        None => {
            let mut builder = reqwest::Client::builder();
            builder = match args.settings.http_version.as_str() {
                "1.1" => builder.http1_only(),
                "2" => builder.http2_prior_knowledge(),
                _ => builder,
            };
            builder = builder.timeout(Duration::from_secs(timeout));
            let c = builder
                .redirect(policy)
                .dns_resolver(std::sync::Arc::new(SafeResolver))
                .danger_accept_invalid_certs(!args.settings.verify_ssl)
                .user_agent(concat!("Caesar/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| format!("No se pudo crear el cliente HTTP: {e}"))?;
            if !args.session.is_empty() {
                if let Ok(mut g) = SESSION_CLIENT.lock() {
                    *g = Some((args.session.clone(), c.clone()));
                }
            }
            c
        }
    };

    let can_have_body = !matches!(method, Method::GET | Method::HEAD);
    let mut multipart_form = None;
    let mut text_body: Option<String> = None;
    let mut form_pairs: Option<Vec<(String, String)>> = None;

    if can_have_body {
        match args.body.mode.as_str() {
            mode @ ("json" | "text") if !args.body.raw.trim().is_empty() => {
                if !headers.contains_key(CONTENT_TYPE) {
                    let ct = if mode == "json" {
                        "application/json"
                    } else {
                        "text/plain"
                    };
                    headers.insert(CONTENT_TYPE, HeaderValue::from_static(ct));
                }
                text_body = Some(args.body.raw.clone());
            }
            "formdata" => {
                let mut form = multipart::Form::new();
                let mut any = false;
                for kv in args.body.formdata.iter().filter(|k| k.enabled && !k.key.is_empty()) {
                    if kv.kind == "file" {
                        let part = match load_file_part(&granted, &kv.path, &kv.value).await {
                            Ok(p) => p,
                            Err(e) => {
                                tr.fail("validate", L_VAL, Instant::now(), &e);
                                return Err(e);
                            }
                        };
                        let part = match clean_part_type(&kv.content_type) {
                            Some(ct) => part.mime_str(ct).map_err(|e| format!("Content-Type inválido '{ct}': {e}"))?,
                            None => part,
                        };
                        form = form.part(kv.key.clone(), part);
                    } else {
                        let part = multipart::Part::text(kv.value.clone());
                        let part = match clean_part_type(&kv.content_type) {
                            Some(ct) => part.mime_str(ct).map_err(|e| format!("Content-Type inválido '{ct}': {e}"))?,
                            None => part,
                        };
                        form = form.part(kv.key.clone(), part);
                    }
                    any = true;
                }
                if any {
                    // reqwest fija el Content-Type multipart con su boundary.
                    headers.remove(CONTENT_TYPE);
                    multipart_form = Some(form);
                }
            }
            "urlencoded" => {
                let pairs: Vec<(String, String)> = args
                    .body
                    .urlencoded
                    .iter()
                    .filter(|k| k.enabled && !k.key.is_empty())
                    .map(|k| (k.key.clone(), k.value.clone()))
                    .collect();
                if !pairs.is_empty() {
                    form_pairs = Some(pairs);
                }
            }
            _ => {}
        }
    }

    let mut req = client.request(method, url).headers(headers);
    if let Some(b) = text_body {
        req = req.body(b);
    }
    if let Some(f) = multipart_form {
        req = req.multipart(f);
    }
    if let Some(p) = form_pairs {
        req = req.form(&p);
    }

    // 3) Conexión, TLS, envío y espera de cabeceras
    const L_REQ: &str = "Conectando y esperando respuesta";
    tr.begin("request", L_REQ);
    let start = Instant::now();
    let mut resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Error de red: {e}");
            tr.fail("request", L_REQ, start, &msg);
            return Err(msg);
        }
    };

    let status = resp.status();
    tr.done("request", L_REQ, start, format!("HTTP {}", status.as_u16()));
    let resp_headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned()))
        .collect();

    let content_type = resp_headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    let url_path = resp.url().path().to_string();
    let max_bytes = if is_download_type(&content_type) { MAX_BINARY_RESPONSE_BYTES } else { MAX_RESPONSE_BYTES };

    // Lectura por chunks con tope de tamaño para no agotar la memoria.
    const L_DL: &str = "Descargando respuesta";
    tr.begin("download", L_DL);
    let dl_start = Instant::now();
    let mut last_emit = Instant::now();
    let mut buf: Vec<u8> = Vec::new();
    let mut truncated = false;
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => {
                let msg = format!("Error leyendo la respuesta: {e}");
                tr.fail("download", L_DL, dl_start, &msg);
                return Err(msg);
            }
        };
        if last_emit.elapsed() >= Duration::from_millis(80) {
            tr.progress("download", L_DL, dl_start, &format!("{:.1} KB", buf.len() as f64 / 1024.0));
            last_emit = Instant::now();
        }
        if buf.len() + chunk.len() > max_bytes {
            let remaining = max_bytes - buf.len();
            buf.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        buf.extend_from_slice(&chunk);
    }
    let time_ms = start.elapsed().as_millis() as u64;
    tr.done("download", L_DL, dl_start, format!("{:.1} KB", buf.len() as f64 / 1024.0));

    const L_PROC: &str = "Procesando respuesta";
    tr.begin("process", L_PROC);
    let t = Instant::now();
    let kind = classify_body(&content_type, &buf);
    let file_name = suggest_file_name(&resp_headers, &url_path, kind, &content_type);
    let (body, body_b64) = if matches!(kind, "pdf" | "image" | "audio" | "video" | "binary") {
        use base64::{engine::general_purpose::STANDARD as B64, Engine};
        (String::new(), Some(B64.encode(&buf)))
    } else {
        (String::from_utf8_lossy(&buf).into_owned(), None)
    };
    let pretty = if kind == "text" {
        serde_json::from_str::<Value>(&body).ok().and_then(|v| serde_json::to_string_pretty(&v).ok())
    } else {
        None
    };
    tr.done(
        "process",
        L_PROC,
        t,
        if pretty.is_some() { "JSON válido".into() } else { match kind { "text" => "texto".into(), other => other.to_string() } },
    );

    Ok(ResponseData {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        time_ms,
        size_bytes: buf.len(),
        truncated,
        headers: resp_headers,
        body,
        pretty,
        timeline: tr.steps.clone(),
        kind: kind.to_string(),
        content_type,
        file_name,
        body_b64,
    })
}

// ───────────────────────────── Comando IPC: abrir enlace ─────────────────────────────

/// Abre un enlace http(s) en el navegador del sistema, tras validarlo.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if url.len() > 8192 {
        return Err("Enlace demasiado largo".into());
    }
    let u = validate_url(&url)?;
    open::that_detached(u.as_str()).map_err(|e| format!("No se pudo abrir el enlace: {e}"))
}

// ───────────────────────────── Actualizaciones (firmadas) ─────────────────────────────
// Toda la red del actualizador ocurre en Rust: el frontend solo invoca estos comandos.
// El paquete descargado se verifica con la clave pública incrustada en tauri.conf.json.

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

/// Cierre de la aplicación en curso: la interfaz está volcando sus últimos cambios a disco (ver `begin_flush`).
static CLOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Antes de salir (cerrar ventana, Cmd+Q, Alt+F4) se avisa a la interfaz para que vuelque ya lo pendiente (la barrera de 2 s de
/// guardado no puede perder el último cambio). Cuando termina llama a `flush_done`; si no responde, se sale igual a los 3 s.
fn begin_flush(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    if CLOSING.swap(true, Ordering::SeqCst) {
        return;
    }
    if app.emit_to("main", "flush-before-close", ()).is_err() {
        app.exit(0);
        return;
    }
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        h.exit(0);
    });
}

/// La interfaz ya guardó todo: ahora sí se puede salir.
#[tauri::command]
fn flush_done(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    // Dentro de un snap el sistema de archivos es de solo lectura y Snap Store actualiza solo.
    if std::env::var_os("SNAP").is_some() {
        return Ok(None);
    }
    let updater = app
        .updater()
        .map_err(|e| format!("Actualizador no disponible: {e}"))?;
    let found = updater
        .check()
        .await
        .map_err(|e| format!("No se pudo comprobar si hay actualizaciones: {e}"))?;
    Ok(found.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    }))
}

/// Descarga e instala la última versión (emite `update-progress`) y reinicia la app.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format!("Actualizador no disponible: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("No se pudo comprobar si hay actualizaciones: {e}"))?
        .ok_or_else(|| "Ya tienes la última versión.".to_string())?;

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("No se pudo instalar la actualización: {e}"))?;

    app.restart()
}

fn main() {
    let result = tauri::Builder::default()
        // single-instance debe ir el primero: reenvía los enlaces caesar:// a la ventana ya abierta (Windows/Linux).
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| deeplink::handle(app, args)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(GrantedFiles::default())
        .manage(vault::VaultState::default())
        .manage(sync::SyncState::default())
        .manage(ws::WsState::default())
        .manage(mock::MockState::default())
        .manage(deeplink::DeepLinks::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && !CLOSING.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_close();
                    { use tauri::Manager; begin_flush(window.app_handle()); }
                }
            }
            if let tauri::WindowEvent::Focused(true) = event {
                { use tauri::Manager; sync::on_focus(window.app_handle()); }
            }
        })
        .setup(|app| {
            {
                use tauri::Manager;
                if let Ok(dir) = app.path().app_data_dir() { secret::init(dir); }
            }
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h = app.handle().clone();
                // Enlace con el que se abrió la app (arranque en frío) y enlaces con la app ya abierta (macOS).
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    deeplink::handle(&h, urls.into_iter().map(|u| u.to_string()));
                }
                app.deep_link().on_open_url(move |e| deeplink::handle(&h, e.urls().into_iter().map(|u| u.to_string())));
                // En desarrollo (Windows/Linux) el esquema no lo registra un instalador: se registra aquí.
                #[cfg(any(windows, target_os = "linux"))]
                if cfg!(debug_assertions) {
                    let _ = app.deep_link().register_all();
                }
            }
            sync::start_worker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_collection_file,
            pick_text_file,
            pick_text_files,
            parse_collection_content,
            execute_request,
            open_url,
            pick_file,
            save_text_file,
            save_response_file,
            app_version,
            flush_done,
            check_update,
            install_update,
            vault::vault_status,
            vault::vault_create,
            vault::vault_restore,
            vault::vault_forget,
            vault::vault_recovery,
            vault::vault_rotate,
            vault::vault_replace,
            vault::vault_encrypt,
            vault::vault_decrypt,
            vault::pairing_begin,
            vault::pairing_code,
            vault::pairing_finish,
            vault::pairing_approve_start,
            vault::pairing_approve_confirm,
            vault::pairing_cancel,
            sync::sync_status,
            sync::local_save,
            sync::local_load,
            sync::local_wipe,
            sync::sync_sign_in,
            sync::sync_reset_password,
            sync::sync_google,
            sync::sync_link_confirm,
            sync::sync_link_cancel,
            sync::sync_github_begin,
            sync::sync_github_finish,
            sync::sync_sign_out,
            sync::sync_now,
            oauth::oauth_authorize,
            deeplink::deeplink_take,
            mock::mock_start,
            mock::mock_stop,
            mock::mock_status,
            ai::ai_status,
            ai::ai_set_key,
            ai::ai_clear_key,
            ai::ai_chat,
            history::history_add,
            history::history_list,
            history::history_clear,
            openapi::import_openapi,
            runner::runner_pick_csv,
            sync::sync_cancel,
            sync::sync_billing,
            sync::sync_delete_account,
            sync::sync_checkout_url,
            team::team_publish,
            team::team_join,
            team::team_push,
            team::team_pull,
            account::check_trial_and_whitelist,
            account::redeem_code,
            account::record_terms,
            account::account_state,
            sync::sync_link_idp,
            keyrole::sync_role,
            keyrole::sync_activate,
            keyrole::sync_show_key,
            keyrole::sync_regenerate_key,
            keyrole::sync_enter_key,
            keyrole::sync_make_master,
            team::team_unshare,
            ws::ws_connect,
            ws::ws_send,
            ws::ws_close
        ])
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|handle, event| {
                // Cmd+Q y otras salidas que no pasan por «cerrar ventana»: se vuelca antes de morir.
                if let tauri::RunEvent::ExitRequested { api, .. } = event {
                    if !CLOSING.load(std::sync::atomic::Ordering::SeqCst) {
                        api.prevent_exit();
                        begin_flush(handle);
                    }
                }
            })
        });

    if let Err(e) = result {
        eprintln!("Error fatal al iniciar Caesar: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod security_tests {
    #[test]
    fn clasifica_respuestas() {
        assert_eq!(classify_body("application/json", b"{}"), "text");
        assert_eq!(classify_body("text/html; charset=utf-8", b"<p>"), "html");
        assert_eq!(classify_body("application/pdf", b"%PDF-1.7"), "pdf");
        assert_eq!(classify_body("application/octet-stream", b"%PDF-1.4\n"), "pdf");
        assert_eq!(classify_body("", b"\x89PNG\r\n\x1a\n...."), "image");
        assert_eq!(classify_body("image/svg+xml", b"<svg/>"), "image");
        assert_eq!(classify_body("application/zip", b"PK\x03\x04\x00"), "binary");
        assert_eq!(classify_body("audio/mpeg", b"\xff\xfb\x90"), "audio");
        assert_eq!(classify_body("", b"OggS\x00\x02"), "audio");
        assert_eq!(classify_body("video/mp4", b"\x00\x00\x00\x18ftypmp42"), "video");
        assert_eq!(classify_body("application/octet-stream", b"\x00\x00\x00\x18ftypisom"), "video");
        assert_eq!(classify_body("", b"hola"), "text");
        assert_eq!(classify_body("", b"<!DOCTYPE html><html>"), "html");
        assert_eq!(classify_body("application/octet-stream", &[0xff, 0xfe, 0x00]), "binary");
    }

    #[test]
    fn nombre_de_archivo_sugerido() {
        let h = vec![("Content-Disposition".to_string(), "attachment; filename=\"informe.pdf\"".to_string())];
        assert_eq!(suggest_file_name(&h, "/x/y", "pdf", "application/pdf"), "informe.pdf");
        assert_eq!(suggest_file_name(&[], "/files/report", "pdf", "application/pdf"), "report.pdf");
        assert_eq!(suggest_file_name(&[], "/", "html", "text/html"), "respuesta.html");
    }

    use super::*;

    #[test]
    fn blocks_metadata() {
        for u in [
            "http://169.254.169.254/latest/meta-data",
            "http://[::ffff:169.254.169.254]/",
            "http://2852039166/",
            "http://0xa9fea9fe/",
            "http://metadata.google.internal/",
            "http://metadata/",
            "http://[fd00:ec2::254]/",
        ] {
            assert!(validate_url(u).is_err(), "debería bloquear {u}");
        }
    }

    #[test]
    fn allows_local_and_private() {
        for u in ["http://localhost:3000/", "http://127.0.0.1/", "http://192.168.1.1/", "https://example.com/"] {
            assert!(validate_url(u).is_ok(), "debería permitir {u}");
        }
    }

    #[test]
    fn open_url_rejects_long() {
        let long = format!("https://example.com/{}", "a".repeat(9000));
        assert!(open_url(long).is_err());
    }

    fn internal(u: &str) -> bool {
        url_is_internal(&Url::parse(u).unwrap())
    }

    #[test]
    fn clasifica_hosts_internos() {
        for u in [
            "http://localhost/", "http://LOCALHOST./", "http://api.localhost/", "http://127.0.0.1/", "http://127.5.5.5/", "http://[::1]/",
            "http://10.0.0.1/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.1.1/",
            "http://100.64.0.1/", "http://100.127.255.255/", "http://[fd00::1]/", "http://[fc00::1]/", "http://[fe80::1]/",
            "http://[::ffff:10.0.0.1]/", "http://0.0.0.0/", "http://impresora.local/", "http://nas/", "http://x.internal/", "http://2130706433/",
        ] {
            assert!(internal(u), "debería ser interno: {u}");
        }
        for u in [
            "https://example.com/", "http://8.8.8.8/", "http://172.32.0.1/", "http://172.15.0.1/", "http://100.63.255.255/", "http://100.128.0.1/",
            "http://[2001:db8::1]/", "http://[::ffff:8.8.8.8]/", "http://192.169.0.1/", "https://localhost.example.com/", "https://notlocal.com/",
        ] {
            assert!(!internal(u), "debería ser público: {u}");
        }
    }
}
