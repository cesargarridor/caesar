#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sync;
mod team;
mod vault;

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

// ───────────────────────────── Postman Collection v2.1 (entrada) ─────────────────────────────
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

/// Evento de Postman (`prerequest` / `test`) con su script.
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
    /// Entornos/variables de Postman: el valor actual y el inicial pueden venir aparte de `value`.
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
    /// "none" | "json" | "text" | "formdata" | "urlencoded"
    mode: String,
    #[serde(default)]
    raw: String,
    #[serde(default)]
    formdata: Vec<Kv>,
    #[serde(default)]
    urlencoded: Vec<Kv>,
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
                _ => "manual",
            };
            // Sin URL de token no se puede pedir uno: se queda con el token que traiga el archivo.
            let url = kv_get(&a.oauth2, "accessTokenUrl");
            let g = if g != "manual" && url.is_empty() { "manual" } else { g };
            put(&mut out, "grantType", g.into());
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

/// host/path de Postman pueden ser un string o un array de strings.
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

fn parse_postman_collection(content: &str) -> Result<ImportedCollection, String> {
    let col: PmCollection = serde_json::from_str(content)
        .map_err(|e| format!("El archivo no es una Postman Collection v2.1 válida: {e}"))?;
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
async fn import_postman_collection(
    app: tauri::AppHandle,
) -> Result<Option<ImportedCollection>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Postman Collection (JSON)", &["json"])
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
    parse_postman_collection(&content).map(Some)
}

#[derive(Debug, Serialize)]
struct TextFile {
    name: String,
    content: String,
}

/// Elige un archivo de colección (Postman, Insomnia o HAR) y devuelve su texto. `Ok(None)` = canceló.
#[tauri::command]
async fn pick_text_file(app: tauri::AppHandle) -> Result<Option<TextFile>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Postman, Insomnia o HAR", &["json", "yaml", "yml", "har"])
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

/// Convierte el texto de una Postman Collection v2.1 (la interfaz ya detectó el formato).
#[tauri::command]
fn parse_postman_content(content: String) -> Result<ImportedCollection, String> {
    if content.len() as u64 > MAX_COLLECTION_BYTES {
        return Err("El contenido supera el límite de 50 MB".into());
    }
    parse_postman_collection(&content)
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

    let timeout = args.settings.timeout_secs.clamp(1, 600);
    let policy = if args.settings.follow_redirects {
        redirect::Policy::limited(10)
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
            let c = reqwest::Client::builder()
                .timeout(Duration::from_secs(timeout))
                .redirect(policy)
                .danger_accept_invalid_certs(!args.settings.verify_ssl)
                .user_agent("PostmanRuntime/7.43.0")
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
        if buf.len() + chunk.len() > MAX_RESPONSE_BYTES {
            let remaining = MAX_RESPONSE_BYTES - buf.len();
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
    let body = String::from_utf8_lossy(&buf).into_owned();
    let pretty = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok());
    tr.done(
        "process",
        L_PROC,
        t,
        if pretty.is_some() { "JSON válido".into() } else { "texto".into() },
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
    })
}

// ───────────────────────────── Comando IPC: abrir enlace ─────────────────────────────

/// Abre un enlace http(s) en el navegador del sistema, tras validarlo.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
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

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Dónde se publican las versiones de desarrollo (rama develop): una Release fija llamada `dev`.
const DEV_ENDPOINT: &str = "https://github.com/cesargarridor/caesar/releases/download/dev/latest.json";

/// Actualizador del canal elegido: "stable" (el de tauri.conf.json) o "dev" (versiones de prueba).
fn updater_for(app: &tauri::AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    let mut b = app.updater_builder();
    if channel == "dev" {
        let url: Url = DEV_ENDPOINT.parse().map_err(|e| format!("Dirección del canal de desarrollo no válida: {e}"))?;
        b = b.endpoints(vec![url]).map_err(|e| format!("Canal de desarrollo no disponible: {e}"))?;
    }
    b.build().map_err(|e| format!("Actualizador no disponible: {e}"))
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, channel: Option<String>) -> Result<Option<UpdateInfo>, String> {
    let updater = updater_for(&app, channel.as_deref().unwrap_or("stable"))?;
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
async fn install_update(app: tauri::AppHandle, channel: Option<String>) -> Result<(), String> {
    let updater = updater_for(&app, channel.as_deref().unwrap_or("stable"))?;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(GrantedFiles::default())
        .manage(vault::VaultState::default())
        .manage(sync::SyncState::default())
        .setup(|app| {
            sync::start_worker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_postman_collection,
            pick_text_file,
            parse_postman_content,
            execute_request,
            open_url,
            pick_file,
            save_text_file,
            app_version,
            check_update,
            install_update,
            vault::vault_status,
            vault::vault_create,
            vault::vault_restore,
            vault::vault_forget,
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
            sync::sync_sign_in,
            sync::sync_github_begin,
            sync::sync_github_finish,
            sync::sync_sign_out,
            sync::sync_now,
            sync::sync_billing,
            sync::sync_delete_account,
            sync::sync_checkout_url,
            team::team_publish,
            team::team_join,
            team::team_push,
            team::team_pull,
            team::team_unshare
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        eprintln!("Error fatal al iniciar Caesar: {e}");
        std::process::exit(1);
    }
}
