//! Estado de la cuenta: invitado, limbo (registrado sin pagar, en prueba) o Pro (de pago o en la lista blanca).
//!
//! - Sin sesión: `guest`.
//! - Lista blanca (`users/{uid}.isWhitelistMember == true`, solo editable a mano en Firestore) o suscripción activa: `pro`.
//! - Resto: `limbo` durante 7 días desde el alta; cero escritura en Firestore. El borrado de cuentas sin pago lo hace
//!   el Cron del Worker: aquí solo se detecta (Firebase dice que el usuario ya no existe) y se cierra la sesión local.

use serde::Serialize;
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

/// Lee `users/{uid}` con el token del usuario. 404/403 o cualquier respuesta no válida = no está en la lista. Solo la red da `Err`.
async fn fetch_whitelist(st: &SyncState, uid: &str, tok: &str) -> Result<bool, String> {
    let c = sync::cfg().ok_or("Sincronización no configurada.")?;
    let url = format!("https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents/users/{uid}", c.project_id);
    let res = st.client.get(url).bearer_auth(tok).send().await.map_err(|_| "Sin conexión con Firebase.".to_string())?;
    if !res.status().is_success() {
        return Ok(false);
    }
    let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).unwrap_or(Value::Null);
    Ok(parse_whitelist(&v))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AccountState {
    /// "guest" | "limbo" | "pro"
    pub mode: String,
    pub is_pro: bool,
    pub whitelisted: bool,
    /// Días que quedan de prueba (0 si ya pasó el plazo). Solo tiene sentido en `limbo`.
    pub days_left: i64,
    /// La cuenta se ha borrado en esta comprobación.
    pub deleted: bool,
    pub email: String,
}

fn guest(deleted: bool) -> AccountState {
    AccountState { mode: "guest".into(), is_pro: false, whitelisted: false, days_left: 0, deleted, email: String::new() }
}

fn store(st: &SyncState, a: &AccountState) {
    st.set_mode(&a.mode, a.is_pro);
    if let Ok(mut g) = st.account.lock() {
        *g = Some(a.clone());
    }
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
pub(crate) async fn evaluate(_app: &AppHandle, st: &SyncState, _allow_delete: bool) -> Result<AccountState, String> {
    if !st.has_session() {
        let g = guest(false);
        store(st, &g);
        return Ok(g);
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
    let pro = |wl: bool| AccountState { mode: "pro".into(), is_pro: true, whitelisted: wl, days_left: 0, deleted: false, email: email.clone() };

    if fetch_whitelist(st, &uid, &tok).await? {
        let a = pro(true);
        store(st, &a);
        return Ok(a);
    }
    if sync::billing_status(st).await?.active {
        let a = pro(false);
        store(st, &a);
        return Ok(a);
    }
    let limbo = AccountState { mode: "limbo".into(), is_pro: false, whitelisted: false, days_left: days_left(info.created_at_ms, now_ms()), deleted: false, email };
    store(st, &limbo);
    Ok(limbo)
}

/// Comprueba el plan de la cuenta (y que siga existiendo). Llamar al arrancar y tras iniciar sesión. Nunca borra la cuenta.
#[tauri::command]
pub async fn check_trial_and_whitelist(app: AppHandle, st: tauri::State<'_, SyncState>) -> Result<AccountState, String> {
    match evaluate(&app, &st, false).await {
        Ok(a) => Ok(a),
        // Sin conexión: se conserva el último estado conocido y no se cierra la sesión.
        Err(e) => st.account.lock().ok().and_then(|g| g.clone()).ok_or(e),
    }
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
        return AccountState { mode, is_pro: pro, whitelisted: false, days_left: 0, deleted: false, email: st.session_email() };
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
    fn trial_days() {
        let now = 100 * DAY_MS;
        assert_eq!(days_left(now, now), 7);
        assert_eq!(days_left(now - 6 * DAY_MS - 1, now), 1);
        assert_eq!(days_left(now - 7 * DAY_MS, now), 0);
        assert_eq!(days_left(0, now), 7);
    }
}
