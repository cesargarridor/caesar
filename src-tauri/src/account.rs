//! Estado de la cuenta: invitado, limbo (registrado sin pagar, en prueba) o Pro (de pago o en la lista blanca).
//!
//! - Sin sesión: `guest`.
//! - Lista blanca (`users/{uid}.isWhitelistMember == true`, solo editable a mano en Firestore), Pro para siempre por código
//!   canjeado (`users/{uid}.proForever == true`, lo escribe solo el Worker) o suscripción activa: `pro`.
//! - Resto: `limbo` durante 7 días desde el alta; cero escritura en Firestore. El borrado de cuentas sin pago lo hace
//!   el Cron del Worker: aquí solo se detecta (Firebase dice que el usuario ya no existe) y se cierra la sesión local.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use serde_json::Value;
use tauri::AppHandle;

use crate::sync::{self, Lookup, SyncState};

const DAY_MS: i64 = 24 * 3600 * 1000;
/// Duración de la prueba.
const TRIAL_MS: i64 = 7 * DAY_MS;

/// Interpreta el documento Firestore `users/{uid}`: `isWhitelistMember` booleano verdadero.
fn parse_whitelist(doc: &Value) -> bool {
    doc["fields"]["isWhitelistMember"]["booleanValue"].as_bool().unwrap_or(false)
}

/// Interpreta el documento Firestore `users/{uid}`: `proForever` booleano verdadero (plan «Compas», por código).
fn parse_forever(doc: &Value) -> bool {
    doc["fields"]["proForever"]["booleanValue"].as_bool().unwrap_or(false)
}

/// Interpreta `users/{uid}`: plan Empresas (clave de licencia de Polar canjeada). Solo cuenta junto a `proForever`, que es lo que
/// escribe el Worker y lo que protegen las reglas: un `proEmpresa` suelto no cambia nada.
fn parse_empresa(doc: &Value) -> bool {
    parse_forever(doc) && doc["fields"]["proEmpresa"]["booleanValue"].as_bool().unwrap_or(false)
}

/// Lee `users/{uid}` con el token del usuario → (lista blanca, Pro para siempre, Empresa). 404/403 o respuesta no válida = todo false. Solo la red da `Err`.
async fn fetch_user_flags(st: &SyncState, uid: &str, tok: &str) -> Result<(bool, bool, bool), String> {
    let c = sync::cfg().ok_or("Sincronización no configurada.")?;
    let url = format!("https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/users/{uid}", c.project_id);
    let res = st.client.get(url).bearer_auth(tok).send().await.map_err(|_| "Sin conexión con Firebase.".to_string())?;
    if !res.status().is_success() {
        return Ok((false, false, false));
    }
    let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).unwrap_or(Value::Null);
    Ok((parse_whitelist(&v), parse_forever(&v), parse_empresa(&v)))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct AccountState {
    /// "guest" | "limbo" | "pro"
    pub mode: String,
    pub is_pro: bool,
    pub whitelisted: bool,
    /// Pro para siempre (plan «Compas»): se desbloqueó con un código canjeado.
    pub forever: bool,
    /// Plan Empresas: se desbloqueó con una clave de licencia de Polar (también cuenta como `forever` mientras la clave siga activa).
    pub empresa: bool,
    /// Días que quedan de prueba (0 si ya pasó el plazo). Solo tiene sentido en `limbo`.
    pub days_left: i64,
    /// La cuenta se ha borrado en esta comprobación.
    pub deleted: bool,
    pub email: String,
}

fn guest(deleted: bool) -> AccountState {
    AccountState { mode: "guest".into(), is_pro: false, whitelisted: false, forever: false, empresa: false, days_left: 0, deleted, email: String::new() }
}

/// Dónde se guarda el último estado conocido de la cuenta (se fija al arrancar).
static CACHE_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Guarda el último estado de la cuenta en disco para que la próxima vez que se abra la app se sepa al instante si es Pro.
/// Solo sirve para pintar la interfaz sin esperar a la red: lo que de verdad manda (reglas de Firestore) lo decide el servidor.
fn persist(a: &AccountState) {
    let Some(p) = CACHE_PATH.get() else { return };
    if a.mode == "guest" {
        let _ = std::fs::remove_file(p);
    } else if let Ok(json) = serde_json::to_vec(a) {
        let _ = std::fs::write(p, json);
    }
}

/// Al arrancar, ANTES de que la interfaz pregunte: si hay una sesión guardada y un estado guardado, se usa ese estado ya.
/// La comprobación real contra la red llega después y lo corrige si ha cambiado (pago, baja, lista blanca, código).
pub fn load_cached(app: &AppHandle, st: &SyncState, has_saved_session: bool) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else { return };
    let path = dir.join("account.json");
    let _ = CACHE_PATH.set(path.clone());
    if !has_saved_session {
        let _ = std::fs::remove_file(&path);
        return;
    }
    let Some(a) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<AccountState>(&b).ok()) else { return };
    if a.mode != "limbo" && a.mode != "pro" || a.deleted {
        return;
    }
    st.set_mode(&a.mode, a.is_pro);
    if !a.email.is_empty() {
        st.set_email(&a.email);
    }
    if let Ok(mut g) = st.account.lock() {
        *g = Some(a);
    }
}

/// Borra el estado guardado en disco (al borrar la cuenta o cerrar sesión).
pub(crate) fn forget_cached() {
    if let Some(p) = CACHE_PATH.get() {
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(p.with_file_name("account.check"));
    }
}

/// Mínimo entre dos arranques para que el segundo vuelva a ir a la red: si se abre la app más a menudo, usa el último estado
/// conocido (el de `account.json`) y no hace ninguna llamada a Firebase al arrancar.
const STARTUP_GAP_MS: i64 = 2 * 60 * 1000;
/// Hay un arranque «sin red» pendiente de consumir por la primera comprobación de la interfaz.
static SKIP_FIRST_CHECK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn check_path() -> Option<PathBuf> {
    CACHE_PATH.get().map(|p| p.with_file_name("account.check"))
}

/// Anota cuándo se comprobó la cuenta por última vez contra la red (y de qué usuario), para el siguiente arranque.
fn mark_checked(st: &SyncState) {
    let Some(p) = check_path() else { return };
    let uid = st.session.lock().ok().and_then(|g| g.as_ref().map(|s| s.uid.clone())).unwrap_or_default();
    if uid.is_empty() {
        return;
    }
    let _ = std::fs::write(p, format!("{}\n{uid}", now_ms()));
}

/// Interpreta `account.check`: (momento, uid). Solo vale si el momento está dentro de la ventana y no es del futuro.
fn parse_check(raw: &str, now: i64) -> Option<(i64, String)> {
    let mut it = raw.lines();
    let at: i64 = it.next()?.trim().parse().ok()?;
    let uid = it.next()?.trim().to_string();
    let age = now - at;
    if uid.is_empty() || !(0..STARTUP_GAP_MS).contains(&age) {
        return None;
    }
    Some((at, uid))
}

/// Al arrancar con sesión guardada: si la última comprobación real fue hace menos de 2 minutos y hay un estado guardado, se
/// salta la red (renovar token, consultar cuenta y plan, bajar datos) y se usa ese estado. El token se renueva solo cuando
/// haga falta de verdad. Devuelve `true` si se ha saltado.
pub(crate) fn try_skip_startup(st: &SyncState) -> bool {
    let Some(p) = check_path() else { return false };
    let Some((at, uid)) = std::fs::read_to_string(p).ok().and_then(|raw| parse_check(&raw, now_ms())) else { return false };
    let Some(email) = st.account.lock().ok().and_then(|g| g.as_ref().map(|a| a.email.clone())) else { return false };
    if let Ok(mut g) = st.session.lock() {
        if let Some(s) = g.as_mut() {
            s.uid = uid;
            s.email = email;
        }
    }
    // Para que el primer «volver a la ventana» no fuerce la comprobación que acabamos de ahorrar.
    sync::LAST_EVAL.store(at, std::sync::atomic::Ordering::SeqCst);
    SKIP_FIRST_CHECK.store(true, std::sync::atomic::Ordering::SeqCst);
    true
}

fn store(st: &SyncState, a: &AccountState) {
    st.set_mode(&a.mode, a.is_pro);
    if let Ok(mut g) = st.account.lock() {
        *g = Some(a.clone());
    }
    persist(a);
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn days_left(created_ms: i64, now: i64) -> i64 {
    if created_ms <= 0 {
        return 7;
    }
    let left = TRIAL_MS - (now - created_ms);
    if left <= 0 {
        0
    } else {
        (left + DAY_MS - 1) / DAY_MS
    }
}

/// Calcula (y guarda) el estado de la cuenta. Sin red devuelve `Err` y se conserva el estado anterior.
/// Si Firebase dice que la cuenta ya no existe (la borró el Worker) se limpia la sesión y la clave locales y se devuelve invitado con `deleted`.
pub(crate) async fn evaluate(app: &AppHandle, st: &SyncState, allow_delete: bool) -> Result<AccountState, String> {
    use tauri::Emitter;
    let before = st.account.lock().ok().and_then(|g| g.as_ref().map(|a| (a.mode.clone(), a.is_pro)));
    let r = evaluate_inner(app, st, allow_delete).await;
    if r.is_ok() {
        sync::LAST_EVAL.store(sync::now_ms(), std::sync::atomic::Ordering::SeqCst);
        mark_checked(st);
    }
    if let Ok(a) = &r {
        // Aviso a la interfaz solo si el plan ha cambiado (pago, baja, cuenta borrada…): así no hace falta preguntar nada por intervalos.
        if before.as_ref().map(|(m, p)| (m.as_str(), *p)) != Some((a.mode.as_str(), a.is_pro)) {
            let _ = app.emit("account-changed", ());
        }
    }
    r
}

async fn evaluate_inner(_app: &AppHandle, st: &SyncState, _allow_delete: bool) -> Result<AccountState, String> {
    if !st.has_session() {
        let g = guest(false);
        store(st, &g);
        return Ok(g);
    }
    if !crate::limit::allow("account_eval", 8, 60_000) {
        if let Some(a) = st.account.lock().ok().and_then(|g| g.clone()) {
            return Ok(a);
        }
    }
    let c = sync::cfg().ok_or("Sincronización no configurada.")?;
    let gone = || {
        sync::drop_local_session(st);
        let g = guest(true);
        store(st, &g);
        g
    };
    let (uid, tok) = match sync::valid_token(st).await {
        Ok(t) => t,
        Err(e) if e == sync::SESSION_GONE => return Ok(gone()),
        Err(e) => return Err(e),
    };
    let info = match sync::lookup_checked(st, &c.api_key, &tok).await {
        Lookup::Ok(i) => i,
        Lookup::Gone => return Ok(gone()),
        Lookup::Unknown => return Err("No se pudo consultar la cuenta.".into()),
    };
    if !info.email.is_empty() {
        st.set_email(&info.email);
    }
    let email = if info.email.is_empty() { st.session_email() } else { info.email.clone() };
    let pro = |wl: bool, forever: bool, empresa: bool| AccountState { mode: "pro".into(), is_pro: true, whitelisted: wl, forever, empresa, days_left: 0, deleted: false, email: email.clone() };

    let (wl, forever, empresa) = fetch_user_flags(st, &uid, &tok).await?;
    if forever || wl {
        let a = pro(wl && !forever, forever, empresa);
        store(st, &a);
        return Ok(a);
    }
    if sync::billing_status(st).await?.active {
        let a = pro(false, false, false);
        store(st, &a);
        return Ok(a);
    }
    let limbo = AccountState { mode: "limbo".into(), is_pro: false, whitelisted: false, forever: false, empresa: false, days_left: days_left(info.created_at_ms, now_ms()), deleted: false, email };
    store(st, &limbo);
    Ok(limbo)
}

/// Comprueba el plan de la cuenta (y que siga existiendo). Llamar al arrancar y tras iniciar sesión. Nunca borra la cuenta.
#[tauri::command]
pub async fn check_trial_and_whitelist(app: AppHandle, st: tauri::State<'_, SyncState>) -> Result<AccountState, String> {
    // Arranque dentro de los 2 minutos de la última comprobación: la primera consulta de la interfaz usa el estado guardado.
    if SKIP_FIRST_CHECK.swap(false, std::sync::atomic::Ordering::SeqCst) {
        if let Some(a) = st.account.lock().ok().and_then(|g| g.clone()) {
            return Ok(a);
        }
    }
    if !crate::limit::allow("check_trial", 6, 60_000) {
        if let Some(a) = st.account.lock().ok().and_then(|g| g.clone()) {
            return Ok(a);
        }
    }
    match evaluate(&app, &st, false).await {
        Ok(a) => Ok(a),
        // Sin conexión: se conserva el último estado conocido y no se cierra la sesión.
        Err(e) => st.account.lock().ok().and_then(|g| g.clone()).ok_or(e),
    }
}

/// Canjea un código de Pro para siempre. Lo valida el Worker de Cloudflare (transacción en Firestore); aquí solo se envía el token
/// del usuario y el código, y después se reevalúa el plan. Devuelve el estado nuevo.
#[tauri::command]
pub async fn redeem_code(app: AppHandle, st: tauri::State<'_, SyncState>, code: String) -> Result<AccountState, String> {
    let c = sync::cfg().ok_or("Sincronización no configurada.")?;
    if c.worker_url.is_empty() {
        return Err("Canjear códigos no está disponible en esta versión.".into());
    }
    let code = code.trim().to_string();
    if code.is_empty() {
        return Err("Escribe el código.".into());
    }
    if !crate::limit::allow("redeem_code", 4, 60_000) {
        return Err("Demasiados intentos seguidos. Espera un minuto.".into());
    }
    let (_uid, tok) = sync::valid_token(&st).await?;
    let url = format!("{}/redeem", c.worker_url.trim_end_matches('/'));
    let body = serde_json::to_vec(&serde_json::json!({ "idToken": tok, "code": code })).map_err(|e| e.to_string())?;
    let res = st.client.post(url).header("content-type", "application/json").body(body).send().await.map_err(|_| "Sin conexión.".to_string())?;
    match res.status().as_u16() {
        200 => {}
        400 => return Err("El código no es válido. Revisa que lo hayas copiado entero.".into()),
        404 => return Err("Ese código no existe.".into()),
        410 => return Err("Ese código ya se ha usado el máximo de veces.".into()),
        429 => {
            // Límite de intentos del Worker (3 a la hora, 7 al día): dice cuánto falta en `retryAfter` (segundos).
            let secs = res.bytes().await.ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| v["retryAfter"].as_u64()).unwrap_or(0);
            let mins = secs.div_ceil(60);
            return Err(if mins >= 120 {
                format!("Demasiados intentos. Inténtalo de nuevo en unas {} horas.", mins.div_ceil(60))
            } else if mins > 0 {
                format!("Demasiados intentos. Inténtalo de nuevo en {mins} min.")
            } else {
                "Demasiados intentos. Inténtalo más tarde.".to_string()
            });
        }
        401 => return Err("Vuelve a iniciar sesión e inténtalo de nuevo.".into()),
        n => return Err(format!("No se pudo canjear el código ({n}). Inténtalo más tarde.")),
    }
    evaluate(&app, &st, false).await
}

/// Registra en el servidor (Worker `/account/terms`) que esta cuenta aceptó los términos `version` y confirmó tener 14 años o más.
/// Sin sesión o sin Worker no hace nada. La app lo llama tras iniciar sesión y reintenta si falla.
#[tauri::command]
pub async fn record_terms(st: tauri::State<'_, SyncState>, version: String) -> Result<(), String> {
    let c = sync::cfg().ok_or("Sincronización no configurada.")?;
    if c.worker_url.is_empty() || !st.has_session() || !crate::limit::allow("record_terms", 3, 60_000) {
        return Ok(());
    }
    let (_uid, tok) = sync::valid_token(&st).await?;
    let body = serde_json::to_vec(&serde_json::json!({ "idToken": tok, "version": version })).map_err(|e| e.to_string())?;
    let res = st.client.post(format!("{}/account/terms", c.worker_url.trim_end_matches('/'))).header("content-type", "application/json").body(body).send().await.map_err(|_| "Sin conexión.".to_string())?;
    if res.status().is_success() { Ok(()) } else { Err(format!("No se pudo registrar la aceptación ({}).", res.status().as_u16())) }
}

/// Último estado conocido, sin red.
#[tauri::command]
pub fn account_state(st: tauri::State<SyncState>) -> AccountState {
    if let Some(a) = st.account.lock().ok().and_then(|g| g.clone()) {
        return a;
    }
    if st.has_session() {
        let mode = st.mode.lock().map(|g| g.clone()).unwrap_or_else(|_| "limbo".into());
        let pro = st.is_pro.load(std::sync::atomic::Ordering::SeqCst);
        return AccountState { mode, is_pro: pro, whitelisted: false, forever: false, empresa: false, days_left: 0, deleted: false, email: st.session_email() };
    }
    guest(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitelist_parse() {
        let yes: Value = serde_json::from_str(r#"{"fields":{"isWhitelistMember":{"booleanValue":true}}}"#).unwrap();
        let no: Value = serde_json::from_str(r#"{"fields":{"isWhitelistMember":{"booleanValue":false}}}"#).unwrap();
        let other: Value = serde_json::from_str(r#"{"fields":{"x":{"stringValue":"a"}}}"#).unwrap();
        let wrong_type: Value = serde_json::from_str(r#"{"fields":{"isWhitelistMember":{"stringValue":"true"}}}"#).unwrap();
        assert!(parse_whitelist(&yes));
        assert!(!parse_whitelist(&no));
        assert!(!parse_whitelist(&other));
        assert!(!parse_whitelist(&wrong_type));
        assert!(!parse_whitelist(&Value::Null));
    }

    #[test]
    fn arranque_sin_red_solo_dentro_de_la_ventana() {
        let now = 10_000_000;
        assert_eq!(parse_check(&format!("{}\nabc", now - 60_000), now), Some((now - 60_000, "abc".to_string())));
        assert_eq!(parse_check(&format!("{}\nabc", now - STARTUP_GAP_MS), now), None); // justo 2 min: ya toca red
        assert_eq!(parse_check(&format!("{}\nabc", now - 3_600_000), now), None);
        assert_eq!(parse_check(&format!("{}\nabc", now + 5_000), now), None); // reloj en el futuro
        assert_eq!(parse_check(&format!("{}\n", now - 1_000), now), None); // sin uid
        assert_eq!(parse_check("basura", now), None);
        assert_eq!(parse_check("", now), None);
    }

    #[test]
    fn empresa_parse() {
        let yes: Value = serde_json::from_str(r#"{"fields":{"proForever":{"booleanValue":true},"proEmpresa":{"booleanValue":true}}}"#).unwrap();
        let solo_empresa: Value = serde_json::from_str(r#"{"fields":{"proEmpresa":{"booleanValue":true}}}"#).unwrap();
        let solo_forever: Value = serde_json::from_str(r#"{"fields":{"proForever":{"booleanValue":true}}}"#).unwrap();
        assert!(parse_empresa(&yes));
        assert!(!parse_empresa(&solo_empresa));
        assert!(!parse_empresa(&solo_forever));
        assert!(!parse_empresa(&Value::Null));
    }

    #[test]
    fn forever_parse() {
        let yes: Value = serde_json::from_str(r#"{"fields":{"proForever":{"booleanValue":true}}}"#).unwrap();
        let wrong_type: Value = serde_json::from_str(r#"{"fields":{"proForever":{"stringValue":"true"}}}"#).unwrap();
        let wl_only: Value = serde_json::from_str(r#"{"fields":{"isWhitelistMember":{"booleanValue":true}}}"#).unwrap();
        assert!(parse_forever(&yes));
        assert!(!parse_forever(&wrong_type));
        assert!(!parse_forever(&wl_only));
        assert!(!parse_forever(&Value::Null));
    }

    #[test]
    fn trial_days() {
        let now = 100 * DAY_MS;
        assert_eq!(days_left(now, now), 7);
        assert_eq!(days_left(now - 6 * DAY_MS - 1, now), 1);
        assert_eq!(days_left(now - 7 * DAY_MS, now), 0);
        assert_eq!(days_left(0, now), 7);
    }
}
