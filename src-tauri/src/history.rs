//! Historial local: las últimas 50 peticiones enviadas que NO pertenecen a una colección (pestañas sueltas).
//! Cola FIFO en un archivo ligero (`history.json`, carpeta de datos de la app). Nada sale del equipo ni se sincroniza.
//! La interfaz guarda el estado de la petición tal cual (sin respuesta) y Rust solo valida, limita el tamaño y rota la cola.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager};

const MAX_ENTRIES: usize = 50;
/// Una entrada más grande (p. ej. un cuerpo de varios MB) no se guarda: el historial es ligero.
const MAX_ENTRY_BYTES: usize = 256 * 1024;
static LOCK: Mutex<()> = Mutex::new(());

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("Sin carpeta de datos: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta de datos: {e}"))?;
    Ok(dir.join("history.json"))
}

/// Lee la lista; un archivo ausente, vacío o estropeado da una lista vacía (nunca un fallo).
fn read(path: &PathBuf) -> Vec<Value> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok())
        .map(|l| l.into_iter().filter(Value::is_object).collect())
        .unwrap_or_default()
}

fn write(path: &PathBuf, list: &[Value]) -> Result<(), String> {
    let bytes = serde_json::to_vec(list).map_err(|e| e.to_string())?;
    crate::sync::write_atomic(path, &bytes).map_err(|e| e.replace("No se pudo guardar", "No se pudo guardar el historial"))
}

/// Misma petición = mismo método y misma URL: sube arriba en vez de duplicarse.
fn same(a: &Value, b: &Value) -> bool {
    a["method"] == b["method"] && a["url"] == b["url"] && a["req"]["body"] == b["req"]["body"]
}

/// Inserta `entry` al principio, quita la repetida y recorta a 50. Función pura (con tests).
pub(crate) fn push_entry(mut list: Vec<Value>, entry: Value) -> Vec<Value> {
    list.retain(|e| !same(e, &entry));
    list.insert(0, entry);
    list.truncate(MAX_ENTRIES);
    list
}

fn valid(entry: &Value) -> bool {
    entry.is_object()
        && entry["id"].is_string()
        && entry["method"].is_string()
        && entry["url"].is_string()
        && entry["req"].is_object()
        && serde_json::to_vec(entry).map(|b| b.len() <= MAX_ENTRY_BYTES).unwrap_or(false)
}

const MASK: &str = "••••";

/// Cabeceras / parámetros cuyo valor nunca se guarda en el historial (sin distinguir mayúsculas).
const SENSITIVE_NAMES: [&str; 6] = ["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key", "x-auth-token"];

/// Campos de `auth.extra` (OAuth, AWS, NTLM, WSSE, Akamai…) que contienen credenciales.
const SENSITIVE_EXTRA: [&str; 11] = [
    "accessToken", "refreshToken", "token", "clientSecret", "consumerSecret", "tokenSecret", "secretKey", "sessionToken", "password", "verifier", "clientToken",
];

/// Una referencia `{{variable}}` no es un secreto: se conserva para que re-enviar siga funcionando.
fn is_var_ref(s: &str) -> bool {
    let t = s.trim();
    t.starts_with("{{") && t.ends_with("}}") && t.matches("{{").count() == 1
}

fn mask_field(obj: &mut Value, field: &str) {
    if let Some(Value::String(s)) = obj.get_mut(field) {
        if !s.is_empty() && !is_var_ref(s) {
            *s = MASK.to_string();
        }
    }
}

fn redact_kv_list(list: &mut Value) {
    if let Some(items) = list.as_array_mut() {
        for it in items {
            let sensitive = it["key"].as_str().map(|k| SENSITIVE_NAMES.contains(&k.trim().to_ascii_lowercase().as_str())).unwrap_or(false);
            if sensitive {
                mask_field(it, "value");
            }
        }
    }
}

/// Quita las credenciales de la petición antes de guardarla (el historial queda en claro en disco).
/// La entrada sigue siendo válida: el usuario repone la credencial al re-enviar.
pub(crate) fn redact_entry(entry: &mut Value) {
    let Some(req) = entry.get_mut("req") else { return };
    redact_kv_list(&mut req["headers"]);
    redact_kv_list(&mut req["params"]);
    if let Some(auth) = req.get_mut("auth").filter(|a| a.is_object()) {
        for f in ["token", "password", "value"] {
            mask_field(auth, f);
        }
        if let Some(extra) = auth.get_mut("extra").and_then(Value::as_object_mut) {
            for f in SENSITIVE_EXTRA {
                if let Some(Value::String(s)) = extra.get_mut(f) {
                    if !s.is_empty() && !is_var_ref(s) {
                        *s = MASK.to_string();
                    }
                }
            }
        }
    }
}

/// Apunta una petición enviada. Una entrada no válida o demasiado grande se ignora sin error.
#[tauri::command]
pub fn history_add(app: AppHandle, mut entry: Value) -> Result<(), String> {
    if !valid(&entry) {
        return Ok(());
    }
    redact_entry(&mut entry);
    let _g = LOCK.lock().map_err(|_| "Historial ocupado.".to_string())?;
    let path = file(&app)?;
    write(&path, &push_entry(read(&path), entry))
}

/// Las últimas peticiones, de la más reciente a la más antigua.
#[tauri::command]
pub fn history_list(app: AppHandle) -> Result<Vec<Value>, String> {
    let _g = LOCK.lock().map_err(|_| "Historial ocupado.".to_string())?;
    Ok(read(&file(&app)?))
}

/// Quita una entrada (por id) o, con `id` vacío, todo el historial.
#[tauri::command]
pub fn history_clear(app: AppHandle, id: Option<String>) -> Result<(), String> {
    let _g = LOCK.lock().map_err(|_| "Historial ocupado.".to_string())?;
    let path = file(&app)?;
    match id.filter(|i| !i.is_empty()) {
        Some(id) => {
            let list: Vec<Value> = read(&path).into_iter().filter(|e| e["id"] != id.as_str()).collect();
            write(&path, &list)
        }
        None => write(&path, &[]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn e(id: &str, url: &str) -> Value {
        json!({ "id": id, "method": "GET", "url": url, "req": { "body": {} } })
    }

    #[test]
    fn fifo_de_50_y_sin_repetidas() {
        let mut l = vec![];
        for i in 0..60 {
            l = push_entry(l, e(&i.to_string(), &format!("https://x/{i}")));
        }
        assert_eq!(l.len(), 50);
        assert_eq!(l[0]["id"], "59");
        assert_eq!(l[49]["id"], "10");
        let l = push_entry(l, e("nuevo", "https://x/30")); // repetida: sube arriba
        assert_eq!(l.len(), 50);
        assert_eq!(l[0]["id"], "nuevo");
        assert_eq!(l.iter().filter(|x| x["url"] == "https://x/30").count(), 1);
    }

    #[test]
    fn valida_entradas() {
        assert!(valid(&e("1", "u")));
        assert!(!valid(&json!("texto")));
        assert!(!valid(&json!({ "id": "1" })));
        let grande = json!({ "id": "1", "method": "POST", "url": "u", "req": { "raw": "x".repeat(300_000) } });
        assert!(!valid(&grande));
    }

    #[test]
    fn redacta_credenciales_y_sigue_siendo_valida() {
        let mut ent = json!({
            "id": "1", "method": "GET", "url": "https://x/a", "req": {
                "headers": [
                    { "key": "authorization", "value": "Bearer abc", "enabled": true },
                    { "key": "X-API-KEY", "value": "k123", "enabled": true },
                    { "key": "Cookie", "value": "s=1", "enabled": true },
                    { "key": "Accept", "value": "json", "enabled": true },
                    { "key": "Proxy-Authorization", "value": "{{proxy}}", "enabled": true }
                ],
                "params": [ { "key": "X-Auth-Token", "value": "t", "enabled": true }, { "key": "q", "value": "1", "enabled": true } ],
                "auth": { "type": "oauth2", "token": "tok", "username": "u", "password": "pw", "key": "k", "value": "apikeyval",
                          "extra": { "accessToken": "at", "refreshToken": "rt", "clientSecret": "cs", "clientId": "id", "addTokenTo": "header" } },
                "body": { "mode": "raw", "raw": "{}" }
            }
        });
        redact_entry(&mut ent);
        let r = &ent["req"];
        assert_eq!(r["headers"][0]["value"], MASK);
        assert_eq!(r["headers"][1]["value"], MASK);
        assert_eq!(r["headers"][2]["value"], MASK);
        assert_eq!(r["headers"][3]["value"], "json");
        assert_eq!(r["headers"][4]["value"], "{{proxy}}");
        assert_eq!(r["params"][0]["value"], MASK);
        assert_eq!(r["params"][1]["value"], "1");
        assert_eq!(r["auth"]["token"], MASK);
        assert_eq!(r["auth"]["password"], MASK);
        assert_eq!(r["auth"]["value"], MASK);
        assert_eq!(r["auth"]["username"], "u");
        assert_eq!(r["auth"]["extra"]["accessToken"], MASK);
        assert_eq!(r["auth"]["extra"]["refreshToken"], MASK);
        assert_eq!(r["auth"]["extra"]["clientSecret"], MASK);
        assert_eq!(r["auth"]["extra"]["clientId"], "id");
        assert_eq!(r["auth"]["extra"]["addTokenTo"], "header");
        assert!(valid(&ent));
        assert!(!serde_json::to_string(&ent).unwrap().contains("Bearer abc"));
    }
}
