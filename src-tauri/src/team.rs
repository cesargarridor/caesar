//! Colecciones de equipo: una colección compartida por código.
//!
//! - Al compartir, Rust genera un código aleatorio (`TEAM-XXXX-XXXX-XXXX`, 60 bits) y crea el documento
//!   `/teams/{id}` en Firestore. El `id` es un hash del código y la clave de cifrado se deriva (HKDF) del código:
//!   el servidor solo ve un bloque cifrado y no puede leerlo ni saber el código.
//! - Quien conoce el código puede leer y escribir ese documento (las reglas exigen iniciar sesión; el código es el secreto).
//! - Conflictos: gana la última escritura (colección entera). `owner` es quien la creó: si borra su cuenta, se borra la colección.
//! - Toda la red va por Rust; la interfaz solo llama a estos comandos con el JSON de la colección.

use hkdf::Hkdf;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::sync::{cfg, valid_token, SyncState};
use crate::vault::{self, Key};

const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/// Misma cota que la sincronización personal (las reglas exigen < 900 000 caracteres).
const MAX_BLOB: usize = 880_000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Quita separadores y pasa a mayúsculas: "team-ab12 cd34..." → "TEAMAB12CD34..."
fn normalize(code: &str) -> Result<String, String> {
    let raw: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_uppercase();
    let body = raw.strip_prefix("TEAM").ok_or("El código debe empezar por TEAM-.")?;
    if body.len() != 12 || !body.bytes().all(|b| ALPHABET.contains(&b)) {
        return Err("El código no es válido. Tiene la forma TEAM-XXXX-XXXX-XXXX.".into());
    }
    Ok(format!("TEAM{body}"))
}

fn pretty(norm: &str) -> String {
    let b = &norm[4..];
    format!("TEAM-{}-{}-{}", &b[0..4], &b[4..8], &b[8..12])
}

fn new_code() -> String {
    use aes_gcm::aead::{rand_core::RngCore, OsRng};
    let mut b = [0u8; 12];
    OsRng.fill_bytes(&mut b);
    let body: String = b.iter().map(|x| ALPHABET[(*x & 31) as usize] as char).collect();
    pretty(&format!("TEAM{body}"))
}

/// (id del documento, clave de cifrado) derivados del código.
fn derive(norm: &str) -> (String, Key) {
    let id: String = Sha256::digest(format!("caesar-team-id:{norm}").as_bytes()).iter().take(16).map(|b| format!("{b:02x}")).collect();
    let mut key = [0u8; 32];
    // expand solo falla si se piden más de 255 bloques; aquí son 32 bytes.
    let _ = Hkdf::<Sha256>::new(Some(b"caesar-team-v1"), norm.as_bytes()).expand(b"data-key", &mut key);
    (id, zeroize::Zeroizing::new(key))
}

fn base(project: &str) -> String {
    format!("https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/teams")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamDoc {
    /// JSON de la colección (nodo carpeta raíz con sus variables).
    pub json: String,
    pub updated_at: i64,
    /// true = la creó esta cuenta.
    pub owner: bool,
}

fn read_doc(v: &Value, key: &Key, id: &str, uid: &str) -> Result<TeamDoc, String> {
    let blob = v["fields"]["blob"]["stringValue"].as_str().ok_or("El documento del equipo no tiene datos.")?;
    let plain = vault::decrypt(key, &format!("team:{id}"), blob).map_err(|_| "No se pudo descifrar la colección con ese código.".to_string())?;
    let plain = crate::pack::unpack(plain)?;
    Ok(TeamDoc {
        json: String::from_utf8(plain).map_err(|_| "La colección del equipo no es texto válido.".to_string())?,
        updated_at: v["fields"]["updatedAt"]["integerValue"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
        owner: v["fields"]["owner"]["stringValue"].as_str() == Some(uid),
    })
}

async fn send(st: &SyncState, req: reqwest::RequestBuilder) -> Result<(u16, Value), String> {
    let res = req.send().await.map_err(|_| "Sin conexión con Firebase.".to_string())?;
    let code = res.status().as_u16();
    let v = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).unwrap_or(Value::Null);
    let _ = st;
    Ok((code, v))
}

/// Convierte un fallo HTTP en un mensaje útil (403 = reglas sin desplegar o sin sesión).
fn http_err(code: u16, what: &str) -> String {
    match code {
        401 => "La sesión caducó. Vuelve a iniciar sesión.".into(),
        403 => format!("Firebase no permite {what}. Si eres quien administra Caesar, despliega las reglas de firebase/firestore.rules (incluyen /teams)."),
        _ => format!("Firebase rechazó la operación ({code})."),
    }
}

/// Crea la colección compartida y devuelve el código para invitar al resto.
#[tauri::command]
pub async fn team_publish(st: tauri::State<'_, SyncState>, json: String) -> Result<String, String> {
    crate::sync::require_pro(&st)?;
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let (uid, tok) = valid_token(&st).await?;
    let code = new_code();
    let norm = normalize(&code)?;
    let (id, key) = derive(&norm);
    let blob = vault::encrypt(&key, &format!("team:{id}"), &crate::pack::pack(json.as_bytes())?)?;
    if blob.len() > MAX_BLOB {
        return Err("La colección supera el límite de la nube gratuita (~650 KB).".into());
    }
    let body = json!({ "fields": {
        "blob": { "stringValue": blob },
        "updatedAt": { "integerValue": now_ms().to_string() },
        "owner": { "stringValue": uid },
    }});
    // exists=false: si por casualidad el código ya existiera, no se pisa.
    let url = format!("{}/{id}?currentDocument.exists=false", base(&c.project_id));
    let (status, _) = send(&st, st.client.patch(url).bearer_auth(tok).header("content-type", "application/json").body(serde_json::to_vec(&body).map_err(|e| e.to_string())?)).await?;
    if status != 200 {
        return Err(http_err(status, "crear la colección de equipo"));
    }
    Ok(code)
}

/// Descarga una colección de equipo con su código.
#[tauri::command]
pub async fn team_join(st: tauri::State<'_, SyncState>, code: String) -> Result<TeamDoc, String> {
    crate::sync::require_pro(&st)?;
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let (uid, tok) = valid_token(&st).await?;
    let norm = normalize(&code)?;
    let (id, key) = derive(&norm);
    let (status, v) = send(&st, st.client.get(format!("{}/{id}", base(&c.project_id))).bearer_auth(tok)).await?;
    match status {
        200 => read_doc(&v, &key, &id, &uid),
        404 => Err("No existe ninguna colección de equipo con ese código (o su dueño la eliminó).".into()),
        s => Err(http_err(s, "leer la colección de equipo")),
    }
}

/// Sube los cambios locales de una colección de equipo. Devuelve la marca de tiempo escrita.
#[tauri::command]
pub async fn team_push(st: tauri::State<'_, SyncState>, code: String, json: String) -> Result<i64, String> {
    crate::sync::require_pro(&st)?;
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let (_uid, tok) = valid_token(&st).await?;
    let norm = normalize(&code)?;
    let (id, key) = derive(&norm);
    let blob = vault::encrypt(&key, &format!("team:{id}"), &crate::pack::pack(json.as_bytes())?)?;
    if blob.len() > MAX_BLOB {
        return Err("La colección supera el límite de la nube gratuita (~650 KB).".into());
    }
    let stamp = now_ms();
    let body = json!({ "fields": { "blob": { "stringValue": blob }, "updatedAt": { "integerValue": stamp.to_string() } } });
    // La máscara deja intacto el campo owner.
    let url = format!(
        "{}/{id}?updateMask.fieldPaths=blob&updateMask.fieldPaths=updatedAt&currentDocument.exists=true",
        base(&c.project_id)
    );
    let (status, _) = send(&st, st.client.patch(url).bearer_auth(tok).header("content-type", "application/json").body(serde_json::to_vec(&body).map_err(|e| e.to_string())?)).await?;
    match status {
        200 => Ok(stamp),
        404 | 400 => Err("NOT_FOUND".into()),
        s => Err(http_err(s, "guardar en la colección de equipo")),
    }
}

/// Consulta si hay cambios más nuevos que `since`. `None` = nada nuevo. Error "NOT_FOUND" = el dueño la eliminó.
#[tauri::command]
pub async fn team_pull(st: tauri::State<'_, SyncState>, code: String, since: i64) -> Result<Option<TeamDoc>, String> {
    crate::sync::require_pro(&st)?;
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let (uid, tok) = valid_token(&st).await?;
    let norm = normalize(&code)?;
    let (id, key) = derive(&norm);
    // 1) Solo la fecha: si no hay nada más nuevo no se descarga (ni se descifra) la colección.
    let (hs, hv) = send(&st, st.client.get(format!("{}/{id}?mask.fieldPaths=updatedAt", base(&c.project_id))).bearer_auth(&tok)).await?;
    match hs {
        200 => {
            let ms: i64 = hv["fields"]["updatedAt"]["integerValue"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
            if ms <= since {
                return Ok(None);
            }
        }
        404 => return Err("NOT_FOUND".into()),
        s => return Err(http_err(s, "leer la colección de equipo")),
    }
    // 2) Hay algo más nuevo: ahora sí el documento completo.
    let (status, v) = send(&st, st.client.get(format!("{}/{id}", base(&c.project_id))).bearer_auth(tok)).await?;
    match status {
        200 => {
            let doc = read_doc(&v, &key, &id, &uid)?;
            Ok((doc.updated_at > since).then_some(doc))
        }
        404 => Err("NOT_FOUND".into()),
        s => Err(http_err(s, "leer la colección de equipo")),
    }
}

/// El dueño deja de compartir: se borra la colección de la nube (las copias locales de cada miembro se quedan).
#[tauri::command]
pub async fn team_unshare(st: tauri::State<'_, SyncState>, code: String) -> Result<(), String> {
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let (_uid, tok) = valid_token(&st).await?;
    let (id, _key) = derive(&normalize(&code)?);
    let (status, _) = send(&st, st.client.delete(format!("{}/{id}", base(&c.project_id))).bearer_auth(tok)).await?;
    match status {
        200 | 404 => Ok(()),
        s => Err(http_err(s, "dejar de compartir la colección")),
    }
}

/// Borra todas las colecciones de equipo creadas por `uid` (se llama al eliminar la cuenta).
pub async fn delete_owned(st: &SyncState, uid: &str, tok: &str) -> Result<(), String> {
    let c = cfg().ok_or("La sincronización no está configurada en esta versión.")?;
    let q = json!({ "structuredQuery": {
        "from": [{ "collectionId": "teams" }],
        "where": { "fieldFilter": { "field": { "fieldPath": "owner" }, "op": "EQUAL", "value": { "stringValue": uid } } },
        "select": { "fields": [{ "fieldPath": "owner" }] },
        "limit": 200,
    }});
    let url = format!("https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents:runQuery", c.project_id);
    let (status, v) = send(st, st.client.post(url).bearer_auth(tok).header("content-type", "application/json").body(serde_json::to_vec(&q).map_err(|e| e.to_string())?)).await?;
    if status == 403 {
        return Ok(()); // reglas antiguas sin /teams: no hay nada que borrar
    }
    if status != 200 {
        return Err(format!("No se pudieron buscar tus colecciones de equipo ({status})."));
    }
    for item in v.as_array().cloned().unwrap_or_default() {
        if let Some(name) = item["document"]["name"].as_str() {
            let url = format!("https://firestore.googleapis.com/v1/{name}");
            let (s, _) = send(st, st.client.delete(url).bearer_auth(tok)).await?;
            if s != 200 && s != 404 {
                return Err(format!("No se pudo eliminar una colección de equipo ({s})."));
            }
        }
    }
    Ok(())
}
