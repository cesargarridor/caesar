//! Sincronización con Firebase (plan gratuito), siempre cifrada de extremo a extremo.
//!
//! Tres barreras entre lo que se teclea y la nube:
//! 1. React espera 2 s sin teclear (debounce) antes de llamar a `local_save`.
//! 2. `local_save` escribe `datos.json` en disco (atómico) y solo levanta una bandera: no toca internet.
//! 3. Un trabajador en segundo plano se despierta cada 30 s; si la bandera está levantada, cifra el archivo y lo sube
//!    en UNA petición. Si no hay cambios, no hace ninguna llamada.
//!
//! Para bajar cambios de otros equipos lee el documento remoto al arrancar, al iniciar sesión, al pulsar «Sincronizar»
//! y cada 5 minutos. Conflictos: gana la última escritura (documento entero).
//! El servidor solo ve un bloque cifrado y una marca de tiempo. Firebase se usa por su API REST desde Rust: la interfaz
//! nunca hace peticiones de red.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::vault;

const CONFIG: &str = include_str!("../sync_config.json");
const SERVICE: &str = "Caesar";
const ACCOUNT: &str = "sync-refresh-token";
/// Cada cuánto despierta el trabajador.
const TICK: Duration = Duration::from_secs(30);
/// Cada cuántos despertares baja cambios remotos (10 × 30 s = 5 min).
const PULL_EVERY: u32 = 10;
/// Firestore admite documentos de hasta 1 MiB; las reglas exigen menos de 900 000 caracteres.
const MAX_BLOB: usize = 880_000;

/// Página que ve el usuario en el navegador al terminar el inicio de sesión con Google (gato de Caesar).
const OAUTH_DONE_HTML: &str = include_str!("oauth_done.html");

#[derive(Deserialize)]
pub(crate) struct Cfg {
    #[serde(rename = "projectId")]
    pub(crate) project_id: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    /// Identificador público de la OAuth App de GitHub (vacío = el botón de GitHub no aparece).
    #[serde(rename = "githubClientId", default)]
    github_client_id: String,
    /// Cliente OAuth de Google de tipo «Aplicación de escritorio» (vacío = el botón de Google no aparece).
    /// En apps de escritorio el «secreto» no es confidencial (lo exige Google), por eso va en el binario.
    #[serde(rename = "googleClientId", default)]
    google_client_id: String,
    #[serde(rename = "googleClientSecret", default)]
    google_client_secret: String,
    /// Enlace de compra de Lemon Squeezy (vacío = sin cobro: la sincronización es gratuita y no se exige suscripción).
    #[serde(rename = "checkoutUrl", default)]
    checkout_url: String,
}

pub(crate) fn cfg() -> Option<Cfg> {
    let mut c: Cfg = serde_json::from_str(CONFIG).ok()?;
    // El secreto del cliente de Google no se guarda en el repositorio: lo inyecta la compilación (secreto de GitHub).
    if c.google_client_secret.is_empty() {
        c.google_client_secret = option_env!("CAESAR_GOOGLE_CLIENT_SECRET").unwrap_or("").to_string();
    }
    if c.google_client_secret.is_empty() {
        c.google_client_id.clear(); // sin secreto no se ofrece el botón
    }
    (!c.project_id.is_empty() && !c.api_key.is_empty()).then_some(c)
}

struct Session {
    uid: String,
    email: String,
    id_token: String,
    refresh_token: String,
    expires: Instant,
}

pub struct SyncState {
    session: Mutex<Option<Session>>,
    dirty: AtomicBool,
    /// La nube rechazó la subida por falta de suscripción: se deja de insistir hasta que cambie.
    blocked: AtomicBool,
    /// Marca de tiempo (ms) del último documento remoto que ya conocemos.
    last_remote: Mutex<i64>,
    last_sync: Mutex<i64>,
    last_error: Mutex<Option<String>>,
    /// Entrada con GitHub/Google pendiente de vincular a una cuenta que ya existe: (postBody, correo).
    pending_link: Mutex<Option<(String, String)>>,
    pub(crate) client: reqwest::Client,
}

impl SyncState {
    /// Fuerza que lo local se vuelva a subir (p. ej. tras cambiar de clave de cifrado).
    pub(crate) fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }
}

impl Default for SyncState {
    fn default() -> Self {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default();
        Self {
            session: Mutex::new(None),
            dirty: AtomicBool::new(false),
            blocked: AtomicBool::new(false),
            last_remote: Mutex::new(0),
            last_sync: Mutex::new(0),
            last_error: Mutex::new(None),
            pending_link: Mutex::new(None),
            client,
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("Sin carpeta de datos: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta de datos: {e}"))?;
    Ok(dir.join("datos.json"))
}

// ───────────────────────── llavero (token de sesión) ─────────────────────────

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Llavero no disponible: {e}"))
}
fn save_refresh(t: &str) {
    if let Ok(e) = token_entry() {
        let _ = e.set_password(t);
    }
}
fn load_refresh() -> Option<String> {
    token_entry().ok()?.get_password().ok()
}
fn clear_refresh() {
    if let Ok(e) = token_entry() {
        let _ = e.delete_credential();
    }
}

// ───────────────────────── Firebase Auth (REST) ─────────────────────────

fn auth_error(code: &str) -> String {
    let c = code.split(" : ").next().unwrap_or(code);
    match c {
        "EMAIL_EXISTS" => "Ya existe una cuenta con ese correo. Inicia sesión.",
        "EMAIL_NOT_FOUND" | "INVALID_PASSWORD" | "INVALID_LOGIN_CREDENTIALS" => "Correo o contraseña incorrectos.",
        "INVALID_EMAIL" => "El correo no es válido.",
        "WEAK_PASSWORD" => "La contraseña es demasiado débil (mínimo 6 caracteres).",
        "USER_DISABLED" => "Esta cuenta está desactivada.",
        "TOO_MANY_ATTEMPTS_TRY_LATER" => "Demasiados intentos. Espera un rato e inténtalo de nuevo.",
        "OPERATION_NOT_ALLOWED" | "CONFIGURATION_NOT_FOUND" => {
            "El inicio de sesión con correo y contraseña no está activado en Firebase."
        }
        _ => return format!("Error de cuenta: {c}"),
    }
    .to_string()
}

async fn post_json(st: &SyncState, url: &str, body: Value) -> Result<Value, String> {
    let res = st
        .client
        .post(url)
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&body).map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|_| "Sin conexión con Firebase.".to_string())?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|_| "Respuesta incompleta de Firebase.".to_string())?;
    let v: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if status.is_success() {
        Ok(v)
    } else {
        Err(auth_error(v["error"]["message"].as_str().unwrap_or("desconocido")))
    }
}

fn session_from(v: &Value, fallback_email: &str) -> Result<Session, String> {
    let get = |k: &str| v[k].as_str().map(str::to_string);
    let secs: u64 = v["expiresIn"].as_str().and_then(|s| s.parse().ok()).unwrap_or(3600);
    Ok(Session {
        uid: get("localId").ok_or("Respuesta de cuenta incompleta.")?,
        email: get("email").unwrap_or_else(|| fallback_email.to_string()),
        id_token: get("idToken").ok_or("Respuesta de cuenta incompleta.")?,
        refresh_token: get("refreshToken").ok_or("Respuesta de cuenta incompleta.")?,
        expires: Instant::now() + Duration::from_secs(secs.saturating_sub(60)),
    })
}

/// Devuelve (uid, idToken) válidos, renovando el token si hace falta.
pub(crate) async fn valid_token(st: &SyncState) -> Result<(String, String), String> {
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let (uid, tok, refresh, fresh) = {
        let g = st.session.lock().map_err(|_| "Estado bloqueado")?;
        let s = g.as_ref().ok_or("No has iniciado sesión.")?;
        (s.uid.clone(), s.id_token.clone(), s.refresh_token.clone(), Instant::now() < s.expires)
    };
    if fresh {
        return Ok((uid, tok));
    }
    let url = format!("https://securetoken.googleapis.com/v1/token?key={}", c.api_key);
    let res = st
        .client
        .post(&url)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(format!("grant_type=refresh_token&refresh_token={refresh}"))
        .send()
        .await
        .map_err(|_| "Sin conexión con Firebase.".to_string())?;
    let ok = res.status().is_success();
    let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).unwrap_or(Value::Null);
    if !ok {
        return Err("La sesión caducó. Vuelve a iniciar sesión.".into());
    }
    let new_id = v["id_token"].as_str().ok_or("Respuesta de sesión incompleta.")?.to_string();
    let new_refresh = v["refresh_token"].as_str().unwrap_or(&refresh).to_string();
    let secs: u64 = v["expires_in"].as_str().and_then(|s| s.parse().ok()).unwrap_or(3600);
    save_refresh(&new_refresh);
    if let Ok(mut g) = st.session.lock() {
        if let Some(s) = g.as_mut() {
            s.id_token = new_id.clone();
            s.refresh_token = new_refresh;
            s.expires = Instant::now() + Duration::from_secs(secs.saturating_sub(60));
        }
    }
    Ok((uid, new_id))
}

// ───────────────────────── Firestore (REST) ─────────────────────────

fn doc_url(uid: &str) -> Option<String> {
    let c = cfg()?;
    Some(format!(
        "https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/users/{uid}/sync/main",
        c.project_id
    ))
}

fn context(uid: &str) -> String {
    format!("sync:{uid}")
}

/// Sube el archivo local (cifrado) en una sola petición.
async fn push(app: &AppHandle, st: &SyncState) -> Result<(), String> {
    let (uid, tok) = valid_token(st).await?;
    let plain = std::fs::read(data_file(app)?).map_err(|e| format!("No se pudo leer datos.json: {e}"))?;
    let key = vault::load_key()?.ok_or("Activa el cifrado (clave de recuperación) antes de sincronizar.")?;
    let blob = vault::encrypt(&key, &context(&uid), &plain)?;
    if blob.len() > MAX_BLOB {
        return Err("Tus colecciones superan el límite de la nube gratuita (~650 KB). Exporta o divide las colecciones.".into());
    }
    let stamp = now_ms();
    let body = json!({ "fields": { "blob": { "stringValue": blob }, "updatedAt": { "integerValue": stamp.to_string() } } });
    let res = st
        .client
        .patch(doc_url(&uid).ok_or("Sincronización no configurada.")?)
        .bearer_auth(tok)
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&body).map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|_| "Sin conexión con Firebase.".to_string())?;
    if res.status().as_u16() == 403 && cfg().map(|c| !c.checkout_url.is_empty()).unwrap_or(false) {
        st.blocked.store(true, Ordering::SeqCst);
        return Err("Tu suscripción no está activa: tus datos siguen guardados en este equipo y en la nube, pero no se suben cambios nuevos.".into());
    }
    if !res.status().is_success() {
        return Err(format!("Firebase rechazó la subida ({}).", res.status().as_u16()));
    }
    st.blocked.store(false, Ordering::SeqCst);
    *st.last_remote.lock().map_err(|_| "Estado bloqueado")? = stamp;
    *st.last_sync.lock().map_err(|_| "Estado bloqueado")? = stamp;
    Ok(())
}

/// Baja el documento remoto; si es más nuevo y no hay cambios locales pendientes, lo aplica y avisa a la interfaz.
async fn pull(app: &AppHandle, st: &SyncState) -> Result<(), String> {
    let (uid, tok) = valid_token(st).await?;
    let url = doc_url(&uid).ok_or("Sincronización no configurada.")?;
    // 1) Solo la fecha (unos bytes). El documento entero se descarga únicamente si hay algo más nuevo.
    let head = st
        .client
        .get(format!("{url}?mask.fieldPaths=updatedAt"))
        .bearer_auth(&tok)
        .send()
        .await
        .map_err(|_| "Sin conexión con Firebase.".to_string())?;
    if head.status().is_success() {
        let hv: Value = serde_json::from_slice(&head.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).unwrap_or(Value::Null);
        let ms: i64 = hv["fields"]["updatedAt"]["integerValue"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
        if ms <= *st.last_remote.lock().map_err(|_| "Estado bloqueado")? || st.dirty.load(Ordering::SeqCst) {
            return Ok(());
        }
    }
    let res = st
        .client
        .get(url)
        .bearer_auth(tok)
        .send()
        .await
        .map_err(|_| "Sin conexión con Firebase.".to_string())?;
    let status = res.status();
    if status.as_u16() == 404 {
        // Primera vez en la nube: sube lo que haya en este equipo.
        if data_file(app).map(|p| p.exists()).unwrap_or(false) {
            st.dirty.store(true, Ordering::SeqCst);
        }
        return Ok(());
    }
    if !status.is_success() {
        return Err(format!("Firebase rechazó la lectura ({}).", status.as_u16()));
    }
    let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).map_err(|e| e.to_string())?;
    let remote_ms: i64 = v["fields"]["updatedAt"]["integerValue"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
    let known = *st.last_remote.lock().map_err(|_| "Estado bloqueado")?;
    if remote_ms <= known || st.dirty.load(Ordering::SeqCst) {
        return Ok(()); // nada nuevo, o lo local gana (se subirá en el próximo ciclo)
    }
    let blob = v["fields"]["blob"]["stringValue"].as_str().ok_or("El documento remoto no tiene datos.")?;
    let key = vault::load_key()?.ok_or("Falta la clave de cifrado en este equipo: vincúlalo o restaura la clave de recuperación.")?;
    let plain = vault::decrypt_any(&key, &context(&uid), blob)?;
    let text = String::from_utf8(plain).map_err(|_| "Los datos remotos no son texto válido.".to_string())?;
    let file = data_file(app)?;
    let _ = std::fs::copy(&file, file.with_extension("json.bak")); // copia de seguridad de lo local
    write_atomic(&file, text.as_bytes())?;
    *st.last_remote.lock().map_err(|_| "Estado bloqueado")? = remote_ms;
    *st.last_sync.lock().map_err(|_| "Estado bloqueado")? = now_ms();
    let _ = app.emit("sync-remote", text);
    Ok(())
}

fn set_error(st: &SyncState, e: Option<String>) {
    if let Ok(mut g) = st.last_error.lock() {
        *g = e;
    }
}

// ───────────────────────── disco ─────────────────────────

fn write_atomic(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("No se pudo guardar: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("No se pudo guardar: {e}"))
}

// ───────────────────────── trabajador de fondo ─────────────────────────

pub fn start_worker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let st = app.state::<SyncState>();
        // Restaura la sesión guardada en el llavero.
        if let (Some(refresh), Some(c)) = (load_refresh(), cfg()) {
            let _ = c;
            if let Ok(mut g) = st.session.lock() {
                *g = Some(Session {
                    uid: String::new(),
                    email: String::new(),
                    id_token: String::new(),
                    refresh_token: refresh,
                    expires: Instant::now(),
                });
            }
            if restore_identity(&st).await.is_ok() {
                if let Err(e) = pull(&app, &st).await {
                    set_error(&st, Some(e));
                }
            }
        }
        let mut n: u32 = 0;
        loop {
            tokio::time::sleep(TICK).await;
            n = n.wrapping_add(1);
            let signed = st.session.lock().map(|g| g.is_some()).unwrap_or(false);
            if !signed {
                continue;
            }
            let r = if st.dirty.load(Ordering::SeqCst) && (!st.blocked.load(Ordering::SeqCst) || n % 20 == 0) {
                // Baja la bandera ANTES de subir: si el usuario edita durante la subida, vuelve a levantarse.
                st.dirty.store(false, Ordering::SeqCst);
                let r = push(&app, &st).await;
                if r.is_err() {
                    st.dirty.store(true, Ordering::SeqCst);
                }
                r
            } else if n % PULL_EVERY == 0 {
                pull(&app, &st).await
            } else {
                Ok(())
            };
            set_error(&st, r.err());
        }
    });
}

/// Con solo el refresh token guardado, averigua uid y correo.
async fn restore_identity(st: &SyncState) -> Result<(), String> {
    let c = cfg().ok_or("Sin configuración")?;
    let refresh = st.session.lock().map_err(|_| "bloqueado")?.as_ref().map(|s| s.refresh_token.clone()).ok_or("Sin sesión")?;
    let res = st
        .client
        .post(format!("https://securetoken.googleapis.com/v1/token?key={}", c.api_key))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(format!("grant_type=refresh_token&refresh_token={refresh}"))
        .send()
        .await
        .map_err(|_| "Sin conexión con Firebase.".to_string())?;
    let ok = res.status().is_success();
    let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).unwrap_or(Value::Null);
    if !ok {
        // La sesión no caduca sola: solo se cierra si el servidor dice que el token ya no vale (contraseña cambiada,
        // cuenta borrada o desactivada). Sin red o ante un error pasajero del servidor se conserva.
        let code = v["error"]["message"].as_str().unwrap_or("");
        if matches!(code, "TOKEN_EXPIRED" | "USER_DISABLED" | "USER_NOT_FOUND" | "INVALID_REFRESH_TOKEN" | "MISSING_REFRESH_TOKEN") {
            clear_refresh();
            *st.session.lock().map_err(|_| "bloqueado")? = None;
        }
        return Err("Sesión caducada".into());
    }
    let id = v["id_token"].as_str().ok_or("Respuesta incompleta")?.to_string();
    let uid = v["user_id"].as_str().ok_or("Respuesta incompleta")?.to_string();
    let new_refresh = v["refresh_token"].as_str().unwrap_or(&refresh).to_string();
    let secs: u64 = v["expires_in"].as_str().and_then(|s| s.parse().ok()).unwrap_or(3600);
    save_refresh(&new_refresh);
    // El correo se consulta una sola vez.
    let email = lookup_email(st, &c.api_key, &id).await.unwrap_or_default();
    *st.session.lock().map_err(|_| "bloqueado")? = Some(Session {
        uid,
        email,
        id_token: id,
        refresh_token: new_refresh,
        expires: Instant::now() + Duration::from_secs(secs.saturating_sub(60)),
    });
    Ok(())
}

async fn lookup_email(st: &SyncState, key: &str, id_token: &str) -> Option<String> {
    let v = post_json(st, &format!("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={key}"), json!({ "idToken": id_token })).await.ok()?;
    v["users"][0]["email"].as_str().map(str::to_string)
}

// ───────────────────────── comandos ─────────────────────────

#[derive(Serialize)]
pub struct SyncStatus {
    configured: bool,
    github: bool,
    google: bool,
    /// Hay cobro configurado (si no, la sincronización es gratuita).
    billing: bool,
    /// La nube rechazó la última subida por falta de suscripción.
    blocked: bool,
    signed_in: bool,
    email: String,
    has_key: bool,
    dirty: bool,
    last_sync: i64,
    error: Option<String>,
}

#[tauri::command]
pub fn sync_status(st: tauri::State<SyncState>) -> SyncStatus {
    let (signed_in, email) = st
        .session
        .lock()
        .map(|g| (g.is_some(), g.as_ref().map(|s| s.email.clone()).unwrap_or_default()))
        .unwrap_or((false, String::new()));
    SyncStatus {
        configured: cfg().is_some(),
        github: cfg().map(|c| !c.github_client_id.is_empty()).unwrap_or(false),
        google: cfg().map(|c| !c.google_client_id.is_empty()).unwrap_or(false),
        billing: cfg().map(|c| !c.checkout_url.is_empty()).unwrap_or(false),
        blocked: st.blocked.load(Ordering::SeqCst),
        signed_in,
        email,
        has_key: vault::load_key().map(|k| k.is_some()).unwrap_or(false),
        dirty: st.dirty.load(Ordering::SeqCst),
        last_sync: st.last_sync.lock().map(|g| *g).unwrap_or(0),
        error: st.last_error.lock().ok().and_then(|g| g.clone()),
    }
}

/// Barrera 2: guarda en disco y levanta la bandera. No toca internet.
#[tauri::command]
pub fn local_save(app: AppHandle, st: tauri::State<SyncState>, json: String) -> Result<(), String> {
    let path = data_file(&app)?;
    if std::fs::read(&path).map(|old| old == json.as_bytes()).unwrap_or(false) {
        return Ok(()); // sin cambios reales: no se levanta la bandera
    }
    write_atomic(&path, json.as_bytes())?;
    // Solo se marca para subir si hay sesión: un equipo nuevo, sin sesión, no debe pisar la nube con datos vacíos.
    if st.session.lock().map(|g| g.is_some()).unwrap_or(false) {
        st.dirty.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_sign_in(app: AppHandle, st: tauri::State<'_, SyncState>, email: String, password: String, create: bool) -> Result<(), String> {
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    if email.trim().is_empty() || password.is_empty() {
        return Err("Escribe tu correo y tu contraseña.".into());
    }
    let endpoint = if create { "accounts:signUp" } else { "accounts:signInWithPassword" };
    let url = format!("https://identitytoolkit.googleapis.com/v1/{endpoint}?key={}", c.api_key);
    let v = post_json(&st, &url, json!({ "email": email.trim(), "password": password, "returnSecureToken": true })).await?;
    let s = session_from(&v, email.trim())?;
    save_refresh(&s.refresh_token);
    *st.session.lock().map_err(|_| "Estado bloqueado")? = Some(s);
    *st.last_remote.lock().map_err(|_| "Estado bloqueado")? = 0;
    // Al entrar manda lo que haya en la nube (si no hay nada, se sube lo de este equipo).
    st.dirty.store(false, Ordering::SeqCst);
    let r = pull(&app, &st).await;
    set_error(&st, r.err());
    Ok(())
}

#[derive(Serialize)]
pub struct DeviceCode {
    user_code: String,
    verification_uri: String,
    device_code: String,
    interval: u64,
    expires_in: u64,
}

async fn gh_post(st: &SyncState, url: &str, form: String) -> Result<Value, String> {
    let res = st
        .client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/x-www-form-urlencoded")
        .header("user-agent", "Caesar")
        .body(form)
        .send()
        .await
        .map_err(|_| "Sin conexión con GitHub.".to_string())?;
    let bytes = res.bytes().await.map_err(|_| "Respuesta incompleta de GitHub.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "Respuesta no válida de GitHub.".to_string())
}

/// GitHub paso 1: pide un código para que el usuario lo escriba en github.com/login/device.
#[tauri::command]
pub async fn sync_github_begin(st: tauri::State<'_, SyncState>) -> Result<DeviceCode, String> {
    let c = cfg().filter(|c| !c.github_client_id.is_empty()).ok_or("El inicio de sesión con GitHub no está configurado.")?;
    let v = gh_post(&st, "https://github.com/login/device/code", format!("client_id={}&scope=read:user%20user:email", c.github_client_id)).await?;
    if let Some(e) = v["error"].as_str() {
        return Err(format!("GitHub: {e}"));
    }
    Ok(DeviceCode {
        user_code: v["user_code"].as_str().ok_or("Respuesta de GitHub incompleta.")?.to_string(),
        verification_uri: v["verification_uri"].as_str().unwrap_or("https://github.com/login/device").to_string(),
        device_code: v["device_code"].as_str().ok_or("Respuesta de GitHub incompleta.")?.to_string(),
        interval: v["interval"].as_u64().unwrap_or(5),
        expires_in: v["expires_in"].as_u64().unwrap_or(900),
    })
}

/// GitHub paso 2: espera a que el usuario autorice y entra en Firebase con el token de GitHub.
#[tauri::command]
pub async fn sync_github_finish(app: AppHandle, st: tauri::State<'_, SyncState>, device_code: String, interval: u64, expires_in: u64) -> Result<(), String> {
    let c = cfg().filter(|c| !c.github_client_id.is_empty()).ok_or("El inicio de sesión con GitHub no está configurado.")?;
    let deadline = Instant::now() + Duration::from_secs(expires_in.min(900));
    let mut wait = interval.max(5);
    let gh_token = loop {
        tokio::time::sleep(Duration::from_secs(wait)).await;
        if Instant::now() > deadline {
            return Err("El código de GitHub caducó. Inténtalo de nuevo.".into());
        }
        let v = gh_post(
            &st,
            "https://github.com/login/oauth/access_token",
            format!("client_id={}&device_code={device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code", c.github_client_id),
        )
        .await?;
        if let Some(t) = v["access_token"].as_str() {
            break t.to_string();
        }
        match v["error"].as_str().unwrap_or("") {
            "authorization_pending" => {}
            "slow_down" => wait += 5,
            "access_denied" => return Err("Has cancelado la autorización en GitHub.".into()),
            "expired_token" => return Err("El código de GitHub caducó. Inténtalo de nuevo.".into()),
            e => return Err(format!("GitHub: {e}")),
        }
    };
    idp_sign_in(&app, &st, format!("access_token={gh_token}&providerId=github.com"), "GitHub").await
}

/// Inicio de sesión con Google: abre el navegador, recibe el código en 127.0.0.1 (OAuth con PKCE) y entra en Firebase.
#[tauri::command]
pub async fn sync_google(app: AppHandle, st: tauri::State<'_, SyncState>) -> Result<(), String> {
    use aes_gcm::aead::{rand_core::RngCore, OsRng};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
    use sha2::{Digest, Sha256};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let c = cfg().filter(|c| !c.google_client_id.is_empty()).ok_or("El inicio de sesión con Google no está configurado.")?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("No se pudo abrir el puerto local: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let mut vb = [0u8; 32];
    OsRng.fill_bytes(&mut vb);
    let verifier = B64.encode(vb);
    let challenge = B64.encode(Sha256::digest(verifier.as_bytes()));
    let mut sb = [0u8; 16];
    OsRng.fill_bytes(&mut sb);
    let state = B64.encode(sb);

    let mut auth = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|e| e.to_string())?;
    auth.query_pairs_mut()
        .append_pair("client_id", &c.google_client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("prompt", "select_account");
    open::that_detached(auth.as_str()).map_err(|e| format!("No se pudo abrir el navegador: {e}"))?;

    // Espera la redirección del navegador (máx. 3 min). Se ignoran peticiones ajenas (p. ej. favicon).
    let wait = async {
        loop {
            let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = req.lines().next().unwrap_or("").split_whitespace().nth(1).unwrap_or("").to_string();
            let q: std::collections::HashMap<String, String> = url::Url::parse(&format!("http://127.0.0.1{path}"))
                .map(|u| u.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect())
                .unwrap_or_default();
            let es = req.lines().any(|l| l.to_ascii_lowercase().starts_with("accept-language:") && l.to_ascii_lowercase().contains("es"));
            let (result, kind) = if q.get("state").map(String::as_str) != Some(state.as_str()) {
                (None, "wait")
            } else if let Some(code) = q.get("code") {
                (Some(Ok(code.clone())), "ok")
            } else if q.contains_key("error") {
                (Some(Err("Has cancelado el acceso con Google.".to_string())), "cancel")
            } else {
                (None, "wait")
            };
            let (msg, sub, hint) = match (kind, es) {
                ("ok", true) => ("¡Listo! Has iniciado sesión.", "Caesar ya tiene tu cuenta.", "Puedes cerrar esta pestaña y volver a Caesar"),
                ("ok", false) => ("All set! You're signed in.", "Caesar has your account now.", "You can close this tab and go back to Caesar"),
                ("cancel", true) => ("Acceso cancelado.", "No se ha iniciado sesión.", "Puedes cerrar esta pestaña y volver a Caesar"),
                ("cancel", false) => ("Sign-in cancelled.", "You were not signed in.", "You can close this tab and go back to Caesar"),
                (_, true) => ("Esperando…", "", "Vuelve a Caesar"),
                (_, false) => ("Waiting…", "", "Go back to Caesar"),
            };
            let body = OAUTH_DONE_HTML.replace("{{LANG}}", if es { "es" } else { "en" }).replace("{{MSG}}", msg).replace("{{SUB}}", sub).replace("{{HINT}}", hint);
            let resp = format!("HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}", body.len(), body);
            let _ = sock.write_all(resp.as_bytes()).await;
            let _ = sock.shutdown().await;
            if let Some(r) = result {
                return r;
            }
        }
    };
    let code = tokio::time::timeout(Duration::from_secs(180), wait)
        .await
        .map_err(|_| "Se agotó el tiempo esperando a Google. Inténtalo de nuevo.".to_string())??;

    let form = |pairs: &[(&str, &str)]| {
        let mut s = url::form_urlencoded::Serializer::new(String::new());
        for (k, v) in pairs {
            s.append_pair(k, v);
        }
        s.finish()
    };
    let res = st
        .client
        .post("https://oauth2.googleapis.com/token")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form(&[
            ("client_id", &c.google_client_id),
            ("client_secret", &c.google_client_secret),
            ("code", &code),
            ("code_verifier", &verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect),
        ]))
        .send()
        .await
        .map_err(|_| "Sin conexión con Google.".to_string())?;
    let ok = res.status().is_success();
    let tok: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta de Google.".to_string())?).unwrap_or(Value::Null);
    if !ok {
        return Err(format!("Google: {}", tok["error_description"].as_str().or(tok["error"].as_str()).unwrap_or("error desconocido")));
    }
    let id_token = tok["id_token"].as_str().ok_or("Google no devolvió la identidad.")?;

    idp_sign_in(&app, &st, form(&[("id_token", id_token), ("providerId", "google.com")]), "Google").await
}

/// Entra en Firebase con las credenciales de un proveedor. Si el correo ya existe con otro método de acceso,
/// guarda la entrada pendiente y devuelve `LINK_REQUIRED|correo|métodos` para que la interfaz pida confirmar.
async fn idp_sign_in(app: &AppHandle, st: &SyncState, post_body: String, fallback: &str) -> Result<(), String> {
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let url = format!("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={}", c.api_key);
    let v = post_json(
        st,
        &url,
        json!({ "postBody": post_body, "requestUri": "http://localhost", "returnSecureToken": true, "returnIdpCredential": true }),
    )
    .await?;
    if v["idToken"].is_null() {
        if let Some(email) = v["email"].as_str() {
            let others = v["allProviders"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(",")).unwrap_or_default();
            *st.pending_link.lock().map_err(|_| "Estado bloqueado")? = Some((post_body, email.to_string()));
            return Err(format!("LINK_REQUIRED|{email}|{others}"));
        }
    }
    let name = v["screenName"].as_str().map(|n| format!("{fallback}: {n}")).unwrap_or_else(|| fallback.to_string());
    finish_session(app, st, session_from(&v, &name)?).await
}

async fn finish_session(app: &AppHandle, st: &SyncState, s: Session) -> Result<(), String> {
    save_refresh(&s.refresh_token);
    *st.session.lock().map_err(|_| "Estado bloqueado")? = Some(s);
    *st.last_remote.lock().map_err(|_| "Estado bloqueado")? = 0;
    st.dirty.store(false, Ordering::SeqCst);
    let r = pull(app, st).await;
    set_error(st, r.err());
    Ok(())
}

/// Confirma la vinculación: la contraseña demuestra que la cuenta existente es tuya y se le añade GitHub/Google.
#[tauri::command]
pub async fn sync_link_confirm(app: AppHandle, st: tauri::State<'_, SyncState>, password: String) -> Result<(), String> {
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let (post_body, email) = st.pending_link.lock().map_err(|_| "Estado bloqueado")?.clone().ok_or("No hay ninguna vinculación pendiente.")?;
    let pw = post_json(&st, &format!("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={}", c.api_key), json!({ "email": email, "password": password, "returnSecureToken": true })).await?;
    let id_token = pw["idToken"].as_str().ok_or("Respuesta de cuenta incompleta.")?.to_string();
    let url = format!("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={}", c.api_key);
    let v = post_json(&st, &url, json!({ "idToken": id_token, "postBody": post_body, "requestUri": "http://localhost", "returnSecureToken": true, "returnIdpCredential": true })).await?;
    let s = session_from(&v, &email)?;
    *st.pending_link.lock().map_err(|_| "Estado bloqueado")? = None;
    finish_session(&app, &st, s).await
}

#[tauri::command]
pub fn sync_link_cancel(st: tauri::State<'_, SyncState>) {
    if let Ok(mut g) = st.pending_link.lock() {
        *g = None;
    }
}

#[derive(Serialize)]
pub struct Billing {
    active: bool,
    status: String,
    ends_at: i64,
    portal: String,
}

/// Estado de la suscripción (lo escribe el Worker de Cloudflare cuando Lemon Squeezy avisa de un pago).
#[tauri::command]
pub async fn sync_billing(st: tauri::State<'_, SyncState>) -> Result<Billing, String> {
    let (uid, tok) = valid_token(&st).await?;
    let c = cfg().ok_or("Sincronización no configurada.")?;
    let url = format!(
        "https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/users/{uid}/billing/status",
        c.project_id
    );
    let res = st.client.get(url).bearer_auth(tok).send().await.map_err(|_| "Sin conexión con Firebase.".to_string())?;
    let status = res.status();
    if status.as_u16() == 404 {
        return Ok(Billing { active: false, status: "none".into(), ends_at: 0, portal: String::new() });
    }
    if !status.is_success() {
        return Err(format!("No se pudo leer la suscripción ({}).", status.as_u16()));
    }
    let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).map_err(|e| e.to_string())?;
    let f = &v["fields"];
    let active = f["active"]["booleanValue"].as_bool().unwrap_or(false);
    if active {
        st.blocked.store(false, Ordering::SeqCst);
    }
    Ok(Billing {
        active,
        status: f["status"]["stringValue"].as_str().unwrap_or("").to_string(),
        ends_at: f["endsAt"]["integerValue"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
        portal: f["portal"]["stringValue"].as_str().unwrap_or("").to_string(),
    })
}

/// Enlace de pago de Lemon Squeezy con el uid de la cuenta (así el Worker sabe a quién activar). No se envía el correo.
#[tauri::command]
pub fn sync_checkout_url(st: tauri::State<SyncState>) -> Result<String, String> {
    let base = cfg().map(|c| c.checkout_url).filter(|u| !u.is_empty()).ok_or("El cobro no está configurado.")?;
    let uid = st.session.lock().map_err(|_| "Estado bloqueado")?.as_ref().map(|s| s.uid.clone()).filter(|u| !u.is_empty()).ok_or("Inicia sesión primero.")?;
    let sep = if base.contains('?') { '&' } else { '?' };
    Ok(format!("{base}{sep}checkout%5Bcustom%5D%5Buid%5D={uid}"))
}

/// Borra la cuenta: primero los datos de la nube y después el usuario de Firebase. Los datos locales no se tocan.
#[tauri::command]
pub async fn sync_delete_account(st: tauri::State<'_, SyncState>) -> Result<(), String> {
    let c = cfg().ok_or("Sincronización no configurada.")?;
    let (uid, tok) = valid_token(&st).await?;
    // Las colecciones de equipo creadas por esta cuenta se eliminan con ella.
    crate::team::delete_owned(&st, &uid, &tok).await?;
    for doc in ["sync/main", "billing/status"] {
        let url = format!(
            "https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/users/{uid}/{doc}",
            c.project_id
        );
        let res = st.client.delete(url).bearer_auth(&tok).send().await.map_err(|_| "Sin conexión con Firebase.".to_string())?;
        // 404 = no existía; 403 en billing se ignora (reglas antiguas).
        if !res.status().is_success() && res.status().as_u16() != 404 && !(doc == "billing/status" && res.status().as_u16() == 403) {
            return Err(format!("No se pudieron borrar los datos de la nube ({}).", res.status().as_u16()));
        }
    }
    let url = format!("https://identitytoolkit.googleapis.com/v1/accounts:delete?key={}", c.api_key);
    if let Err(e) = post_json(&st, &url, json!({ "idToken": tok })).await {
        return Err(if e.contains("CREDENTIAL_TOO_OLD") || e.contains("LOGIN_AGAIN") {
            "Por seguridad, cierra sesión, vuelve a entrar y repite el borrado.".to_string()
        } else {
            e
        });
    }
    clear_refresh();
    *st.session.lock().map_err(|_| "Estado bloqueado")? = None;
    st.dirty.store(false, Ordering::SeqCst);
    st.blocked.store(false, Ordering::SeqCst);
    *st.last_remote.lock().map_err(|_| "Estado bloqueado")? = 0;
    *st.last_sync.lock().map_err(|_| "Estado bloqueado")? = 0;
    set_error(&st, None);
    Ok(())
}

/// Cierra la sesión. Antes intenta subir lo pendiente (sin red o sin suscripción no bloquea el cierre) y después
/// borra el token del llavero y todo el estado de la cuenta. Los datos locales (`datos.json`) no se tocan.
#[tauri::command]
pub async fn sync_sign_out(app: AppHandle, st: tauri::State<'_, SyncState>) -> Result<(), String> {
    if st.dirty.load(Ordering::SeqCst) && !st.blocked.load(Ordering::SeqCst) {
        let _ = tokio::time::timeout(Duration::from_secs(8), push(&app, &st)).await;
    }
    clear_refresh();
    if let Ok(mut g) = st.session.lock() {
        *g = None;
    }
    st.dirty.store(false, Ordering::SeqCst);
    st.blocked.store(false, Ordering::SeqCst);
    if let Ok(mut g) = st.last_remote.lock() {
        *g = 0;
    }
    if let Ok(mut g) = st.last_sync.lock() {
        *g = 0;
    }
    set_error(&st, None);
    Ok(())
}

/// «Sincronizar ahora»: sube si hay cambios y baja los de otros equipos.
#[tauri::command]
pub async fn sync_now(app: AppHandle, st: tauri::State<'_, SyncState>) -> Result<(), String> {
    st.blocked.store(false, Ordering::SeqCst);
    if st.dirty.load(Ordering::SeqCst) {
        st.dirty.store(false, Ordering::SeqCst);
        if let Err(e) = push(&app, &st).await {
            st.dirty.store(true, Ordering::SeqCst);
            set_error(&st, Some(e.clone()));
            return Err(e);
        }
    }
    let r = pull(&app, &st).await;
    set_error(&st, r.clone().err());
    r
}
