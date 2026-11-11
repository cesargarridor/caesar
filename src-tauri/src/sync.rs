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

#[derive(Deserialize)]
struct Cfg {
    #[serde(rename = "projectId")]
    project_id: String,
    #[serde(rename = "apiKey")]
    api_key: String,
}

fn cfg() -> Option<Cfg> {
    let c: Cfg = serde_json::from_str(CONFIG).ok()?;
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
    /// Marca de tiempo (ms) del último documento remoto que ya conocemos.
    last_remote: Mutex<i64>,
    last_sync: Mutex<i64>,
    last_error: Mutex<Option<String>>,
    client: reqwest::Client,
}

impl Default for SyncState {
    fn default() -> Self {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap_or_default();
        Self {
            session: Mutex::new(None),
            dirty: AtomicBool::new(false),
            last_remote: Mutex::new(0),
            last_sync: Mutex::new(0),
            last_error: Mutex::new(None),
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
async fn valid_token(st: &SyncState) -> Result<(String, String), String> {
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
    if !res.status().is_success() {
        return Err(format!("Firebase rechazó la subida ({}).", res.status().as_u16()));
    }
    *st.last_remote.lock().map_err(|_| "Estado bloqueado")? = stamp;
    *st.last_sync.lock().map_err(|_| "Estado bloqueado")? = stamp;
    Ok(())
}

/// Baja el documento remoto; si es más nuevo y no hay cambios locales pendientes, lo aplica y avisa a la interfaz.
async fn pull(app: &AppHandle, st: &SyncState) -> Result<(), String> {
    let (uid, tok) = valid_token(st).await?;
    let res = st
        .client
        .get(doc_url(&uid).ok_or("Sincronización no configurada.")?)
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
    let plain = vault::decrypt(&key, &context(&uid), blob)?;
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
            let r = if st.dirty.load(Ordering::SeqCst) {
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
        // Sin red no se cierra la sesión; solo si el servidor la rechaza.
        if v["error"]["message"].is_string() {
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

#[tauri::command]
pub fn sync_sign_out(st: tauri::State<SyncState>) {
    clear_refresh();
    if let Ok(mut g) = st.session.lock() {
        *g = None;
    }
    st.dirty.store(false, Ordering::SeqCst);
    set_error(&st, None);
}

/// «Sincronizar ahora»: sube si hay cambios y baja los de otros equipos.
#[tauri::command]
pub async fn sync_now(app: AppHandle, st: tauri::State<'_, SyncState>) -> Result<(), String> {
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
