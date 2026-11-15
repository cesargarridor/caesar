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
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("No se pudo guardar el historial: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("No se pudo guardar el historial: {e}"))
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

/// Apunta una petición enviada. Una entrada no válida o demasiado grande se ignora sin error.
#[tauri::command]
pub fn history_add(app: AppHandle, entry: Value) -> Result<(), String> {
    if !valid(&entry) {
        return Ok(());
    }
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
}
