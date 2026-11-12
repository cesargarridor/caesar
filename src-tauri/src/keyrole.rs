//! Roles de la clave de cifrado entre equipos de la misma cuenta.
//!
//! Cada equipo tiene un `device_id` (UUID en el llavero). En `users/{uid}/sync/meta` la nube guarda qué equipo es el
//! Master (`masterDeviceId`) y una comprobación de la clave (`keyCheck` = un texto fijo cifrado con la clave), que permite
//! saber si la clave de un equipo es la vigente sin ver la clave. La clave nunca sale del llavero salvo para mostrarla al Master.

use std::sync::atomic::Ordering;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::sync::{self, require_pro, SyncState};
use crate::vault::{self, Key};

const SERVICE: &str = "Caesar";
const ACCOUNT: &str = "device-id";
const CHECK_PLAIN: &[u8] = b"caesar";

#[derive(Serialize, Clone, Debug)]
pub struct SyncRole {
    /// "none" | "master" | "member" | "needs_key" | "revoked"
    pub role: String,
    pub device_id: String,
    pub master_device_id: Option<String>,
    pub has_key: bool,
}

struct Meta {
    master: String,
    key_check: String,
}

fn device_id() -> Result<String, String> {
    let e = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Llavero no disponible: {e}"))?;
    if let Ok(id) = e.get_password() {
        if !id.is_empty() {
            return Ok(id);
        }
    }
    use aes_gcm::aead::{rand_core::RngCore, OsRng};
    let mut b = [0u8; 16];
    OsRng.fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40; // UUID v4
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let id = format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]);
    e.set_password(&id).map_err(|e| format!("No se pudo guardar en el llavero: {e}"))?;
    Ok(id)
}

fn key_check_for(key: &Key, uid: &str) -> Result<String, String> {
    vault::encrypt(key, &format!("keycheck:{uid}"), CHECK_PLAIN)
}

fn key_matches(key: &Key, uid: &str, check: &str) -> bool {
    vault::decrypt(key, &format!("keycheck:{uid}"), check).map(|p| p == CHECK_PLAIN).unwrap_or(false)
}

async fn get_meta(st: &SyncState, uid: &str, tok: &str) -> Result<Option<Meta>, String> {
    let url = sync::sync_doc_url(uid, "meta").ok_or("Sincronización no configurada.")?;
    let res = st.client.get(url).bearer_auth(tok).send().await.map_err(|_| "Sin conexión con Firebase.".to_string())?;
    let status = res.status();
    if status.as_u16() == 404 {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("No se pudo leer la configuración de claves ({}).", status.as_u16()));
    }
    let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).map_err(|e| e.to_string())?;
    let f = &v["fields"];
    Ok(Some(Meta {
        master: f["masterDeviceId"]["stringValue"].as_str().unwrap_or("").to_string(),
        key_check: f["keyCheck"]["stringValue"].as_str().unwrap_or("").to_string(),
    }))
}

async fn put_meta(st: &SyncState, uid: &str, tok: &str, master: &str, key_check: &str) -> Result<(), String> {
    let url = sync::sync_doc_url(uid, "meta").ok_or("Sincronización no configurada.")?;
    let body = json!({ "fields": {
        "masterDeviceId": { "stringValue": master },
        "keyCheck": { "stringValue": key_check },
        "updatedAt": { "integerValue": now_ms().to_string() },
    }});
    let res = st
        .client
        .patch(url)
        .bearer_auth(tok)
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&body).map_err(|e| e.to_string())?)
        .send()
        .await
        .map_err(|_| "Sin conexión con Firebase.".to_string())?;
    if !res.status().is_success() {
        return Err(format!("Firebase rechazó guardar la configuración de claves ({}).", res.status().as_u16()));
    }
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn role_of(uid: &str, dev: &str, meta: &Option<Meta>) -> Result<SyncRole, String> {
    let key = vault::load_key()?;
    let has_key = key.is_some();
    let Some(m) = meta else {
        return Ok(SyncRole { role: "none".into(), device_id: dev.into(), master_device_id: None, has_key });
    };
    let valid = match &key {
        // Sin comprobación guardada no se puede invalidar la clave: se acepta.
        Some(k) => m.key_check.is_empty() || key_matches(k, uid, &m.key_check),
        None => false,
    };
    let role = if !has_key {
        "needs_key"
    } else if !valid {
        "revoked"
    } else if m.master == dev {
        "master"
    } else {
        "member"
    };
    Ok(SyncRole { role: role.into(), device_id: dev.into(), master_device_id: (!m.master.is_empty()).then(|| m.master.clone()), has_key })
}

async fn current(st: &SyncState) -> Result<(String, String, Option<Meta>, String), String> {
    let (uid, tok) = sync::valid_token(st).await?;
    let meta = get_meta(st, &uid, &tok).await?;
    let dev = device_id()?;
    Ok((uid, tok, meta, dev))
}

/// Rol de este equipo. Sin cuenta Pro o sin configuración de claves en la nube: "none".
#[tauri::command]
pub async fn sync_role(st: tauri::State<'_, SyncState>) -> Result<SyncRole, String> {
    let dev = device_id()?;
    if !st.has_session() || !st.is_pro.load(Ordering::SeqCst) {
        return Ok(SyncRole { role: "none".into(), device_id: dev, master_device_id: None, has_key: vault::load_key().map(|k| k.is_some()).unwrap_or(false) });
    }
    let (uid, _tok, meta, dev) = current(&st).await?;
    role_of(&uid, &dev, &meta)
}

/// Activa la sincronización cifrada. Sin configuración en la nube: este equipo crea la clave y pasa a ser Master.
/// Con configuración: este equipo debe introducir la clave (`needs_key`) o, si ya la tiene vigente, queda como miembro.
#[tauri::command]
pub async fn sync_activate(st: tauri::State<'_, SyncState>) -> Result<SyncRole, String> {
    require_pro(&st)?;
    let (uid, tok, meta, dev) = current(&st).await?;
    if meta.is_none() {
        let key = match vault::load_key()? {
            Some(k) => k,
            None => {
                let k = vault::new_key();
                vault::store_key(&k)?;
                k
            }
        };
        put_meta(&st, &uid, &tok, &dev, &key_check_for(&key, &uid)?).await?;
        st.mark_dirty();
        return role_of(&uid, &dev, &Some(Meta { master: dev.clone(), key_check: key_check_for(&key, &uid)? }));
    }
    role_of(&uid, &dev, &meta)
}

/// Muestra la clave de recuperación (solo el Master).
#[tauri::command]
pub async fn sync_show_key(st: tauri::State<'_, SyncState>) -> Result<String, String> {
    require_pro(&st)?;
    let (uid, _tok, meta, dev) = current(&st).await?;
    if role_of(&uid, &dev, &meta)?.role != "master" {
        return Err("Solo el equipo Master puede ver la clave.".into());
    }
    Ok(vault::recovery_encode(&vault::load_key()?.ok_or("Falta la clave en este equipo.")?))
}

/// Genera una clave nueva (solo el Master), re-sube todo cifrado con ella y actualiza la comprobación en la nube.
/// Los demás equipos pasan a `revoked` hasta que introduzcan la clave nueva. Devuelve la clave nueva.
#[tauri::command]
pub async fn sync_regenerate_key(st: tauri::State<'_, SyncState>) -> Result<String, String> {
    require_pro(&st)?;
    let (uid, tok, meta, dev) = current(&st).await?;
    if role_of(&uid, &dev, &meta)?.role != "master" {
        return Err("Solo el equipo Master puede regenerar la clave.".into());
    }
    let old = vault::load_key()?.ok_or("Falta la clave en este equipo.")?;
    let new = rotate(&st, &uid, &tok, &dev, &old).await?;
    Ok(vault::recovery_encode(&new))
}

/// Introduce la clave de recuperación en este equipo. Se valida con `keyCheck` o, si no existe, descifrando `sync/main`.
#[tauri::command]
pub async fn sync_enter_key(app: AppHandle, st: tauri::State<'_, SyncState>, key: String) -> Result<SyncRole, String> {
    require_pro(&st)?;
    let k = vault::recovery_decode(&key)?;
    let (uid, tok, meta, dev) = current(&st).await?;
    let ok = match &meta {
        Some(m) if !m.key_check.is_empty() => key_matches(&k, &uid, &m.key_check),
        _ => {
            let url = sync::sync_doc_url(&uid, "main").ok_or("Sincronización no configurada.")?;
            let res = st.client.get(url).bearer_auth(&tok).send().await.map_err(|_| "Sin conexión con Firebase.".to_string())?;
            if !res.status().is_success() {
                return Err("No hay datos en la nube con los que comprobar la clave.".into());
            }
            let v: Value = serde_json::from_slice(&res.bytes().await.map_err(|_| "Respuesta incompleta.".to_string())?).unwrap_or(Value::Null);
            v["fields"]["blob"]["stringValue"].as_str().map(|b| vault::decrypt(&k, &sync::context(&uid), b).is_ok()).unwrap_or(false)
        }
    };
    if !ok {
        return Err("KEY_INVALID".into());
    }
    vault::switch_key(k)?;
    // Con la clave buena se baja lo de la nube.
    if let Ok(mut g) = st.last_remote.lock() {
        *g = 0;
    }
    let _ = sync::pull(&app, &st).await;
    role_of(&uid, &dev, &meta)
}

/// Descifra `blob_b64` con `old` y lo vuelve a cifrar con `new` (mismo contexto). Función pura.
pub(crate) fn reencrypt_blob(old: &Key, new: &Key, blob_b64: &str, ctx: &str) -> Result<String, String> {
    let plain = vault::decrypt(old, ctx, blob_b64).map_err(|_| "No se pudieron descifrar los datos de la nube con la clave de este equipo.".to_string())?;
    vault::encrypt(new, ctx, &plain)
}

/// ¿La clave local es la vigente según `sync/meta`? Sin meta o sin `keyCheck` se acepta. Lo usa `push` para que
/// un equipo con la clave revocada no pise la nube.
pub(crate) async fn key_is_current(st: &SyncState, uid: &str, tok: &str, key: &Key) -> Result<bool, String> {
    Ok(match get_meta(st, uid, tok).await? {
        Some(m) if !m.key_check.is_empty() => key_matches(key, uid, &m.key_check),
        _ => true,
    })
}

/// Rotación de clave: genera una nueva, re-cifra `sync/main` con ella y actualiza `sync/meta`; solo entonces cambia el llavero.
/// Si algo falla antes de subir el blob, la clave local vieja queda intacta. Si el blob sube y falla `meta`, la clave nueva
/// ya está en el llavero (si no, los datos de la nube serían ilegibles) y se marca dirty para reintentar.
async fn rotate(st: &SyncState, uid: &str, tok: &str, dev: &str, old: &Key) -> Result<Key, String> {
    let new = vault::new_key();
    let ctx = sync::context(uid);
    let check = key_check_for(&new, uid)?;
    match sync::get_main(st, uid, tok).await? {
        Some((blob, ms)) => {
            let new_blob = reencrypt_blob(old, &new, &blob, &ctx)?;
            let stamp = now_ms().max(ms + 1);
            sync::put_main(st, uid, tok, &new_blob, stamp).await?;
            if let Err(e) = vault::switch_key(zeroize::Zeroizing::new(*new)) {
                // No se pudo guardar la clave nueva: se deshace la subida para no dejar la nube ilegible.
                let _ = sync::put_main(st, uid, tok, &blob, now_ms().max(stamp + 1)).await;
                return Err(e);
            }
            if let Ok(mut g) = st.last_remote.lock() {
                *g = stamp;
            }
        }
        None => vault::switch_key(zeroize::Zeroizing::new(*new))?,
    }
    let mut r = put_meta(st, uid, tok, dev, &check).await;
    if r.is_err() {
        r = put_meta(st, uid, tok, dev, &check).await;
    }
    if let Err(e) = r {
        st.mark_dirty();
        return Err(format!("Los datos ya se re-cifraron con la clave nueva, pero no se pudo actualizar la comprobación de claves ({e}). Pulsa «Hacer Master» otra vez para terminar."));
    }
    st.mark_dirty();
    Ok(new)
}

/// Este equipo pasa a ser el Master y ROTA la clave: se genera una clave nueva, se re-cifra la nube y el resto de equipos
/// (incluido el Master anterior) pasan a `revoked`/`needs_key` hasta introducir la clave nueva, que el Master ve con `sync_show_key`.
/// Requiere la clave vigente en este equipo. No devuelve la clave.
#[tauri::command]
pub async fn sync_make_master(st: tauri::State<'_, SyncState>) -> Result<SyncRole, String> {
    require_pro(&st)?;
    let (uid, tok, meta, dev) = current(&st).await?;
    let m = meta.ok_or("Primero activa la sincronización.")?;
    let key = vault::load_key()?.ok_or("Introduce primero la clave.")?;
    if !m.key_check.is_empty() && !key_matches(&key, &uid, &m.key_check) {
        // Recuperación de una rotación a medias (blob ya con la clave local, meta sin actualizar).
        let main_ok = match sync::get_main(&st, &uid, &tok).await? {
            Some((blob, _)) => vault::decrypt(&key, &sync::context(&uid), &blob).is_ok(),
            None => false,
        };
        if !main_ok {
            return Err("KEY_INVALID".into());
        }
        let check = key_check_for(&key, &uid)?;
        put_meta(&st, &uid, &tok, &dev, &check).await?;
        return role_of(&uid, &dev, &Some(Meta { master: dev.clone(), key_check: check }));
    }
    let new = rotate(&st, &uid, &tok, &dev, &key).await?;
    let check = key_check_for(&new, &uid)?;
    role_of(&uid, &dev, &Some(Meta { master: dev.clone(), key_check: check }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reencrypt_roundtrip() {
        let old = vault::new_key();
        let new = vault::new_key();
        let ctx = "sync:uid1";
        let data = br#"{"collections":[1,2,3]}"#;
        let blob = vault::encrypt(&old, ctx, data).unwrap();
        let re = reencrypt_blob(&old, &new, &blob, ctx).unwrap();
        assert_eq!(vault::decrypt(&new, ctx, &re).unwrap(), data);
        assert!(vault::decrypt(&old, ctx, &re).is_err());
        assert!(reencrypt_blob(&new, &old, &blob, ctx).is_err()); // clave equivocada
        assert!(reencrypt_blob(&old, &new, &blob, "sync:otro").is_err()); // contexto distinto
    }

    #[test]
    fn key_check_follows_key() {
        let a = vault::new_key();
        let b = vault::new_key();
        let c = key_check_for(&a, "u").unwrap();
        assert!(key_matches(&a, "u", &c));
        assert!(!key_matches(&b, "u", &c));
    }
}
