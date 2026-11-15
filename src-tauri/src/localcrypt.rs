//! Cifrado en reposo de `datos.json` (AES-256-GCM) con una clave local aleatoria guardada en el llavero (cuenta `local-data-key`).
//! Es independiente de la clave de sincronización (`vault`): un usuario sin cuenta Pro también tiene cifrado local.
//!
//! Formato: `CAESAR-ENC1\n` + nonce (12 bytes) + texto cifrado (con etiqueta GCM). Un archivo que no empieza así es JSON plano
//! (versiones anteriores) y se lee igual; se reescribe cifrado en el siguiente guardado (migración perezosa).
//!
//! Reglas de seguridad de los datos:
//! - Si el llavero no está disponible, NUNCA se pierden datos ni se fuerza el cifrado: se escribe JSON plano (0600) y se registra el motivo.
//! - Si el archivo ya está cifrado y falta la clave, se devuelve un error claro y el archivo NO se toca.
//! - Si el archivo está cifrado, la clave existe pero no descifra (estropeado), se aparta como `*.corrupt` (no se borra) antes de escribir.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};

use crate::vault::Key;

const MAGIC: &[u8] = b"CAESAR-ENC1\n";
const NONCE_LEN: usize = 12;
const SERVICE: &str = "Caesar";
const ACCOUNT: &str = "local-data-key";

/// Resultado de pedir la clave local.
pub(crate) enum KeyState {
    Ok(Key),
    /// El llavero funciona pero no hay clave guardada.
    Missing,
    /// El llavero falló (o la clave guardada es inválida).
    Unavailable(String),
}

pub(crate) fn is_encrypted(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

pub(crate) fn encrypt_bytes(key: &Key, plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ct = Aes256Gcm::new(key.as_slice().into())
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad: MAGIC })
        .map_err(|_| "No se pudo cifrar los datos locales.".to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub(crate) fn decrypt_bytes(key: &Key, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let body = bytes.strip_prefix(MAGIC).ok_or("El archivo no tiene el formato cifrado esperado.")?;
    if body.len() < NONCE_LEN + 16 {
        return Err("El archivo de datos cifrado está incompleto o estropeado.".into());
    }
    let (nonce, ct) = body.split_at(NONCE_LEN);
    Aes256Gcm::new(key.as_slice().into())
        .decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad: MAGIC })
        .map_err(|_| "No se pudo descifrar el archivo de datos (clave distinta o archivo estropeado).".to_string())
}

// ───────────────────────── clave en el llavero ─────────────────────────

static KEY_CACHE: Mutex<Option<[u8; 32]>> = Mutex::new(None);
static KEY_LOCK: Mutex<()> = Mutex::new(());

fn entry() -> Result<crate::secret::Entry, String> {
    crate::secret::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Llavero no disponible: {e}"))
}

fn to_key(b: &[u8]) -> Option<Key> {
    let a: [u8; 32] = b.try_into().ok()?;
    Some(zeroize::Zeroizing::new(a))
}

fn cached() -> Option<Key> {
    KEY_CACHE.lock().ok().and_then(|g| g.map(|a| zeroize::Zeroizing::new(a)))
}

fn remember(k: &Key) {
    if let Ok(mut g) = KEY_CACHE.lock() {
        *g = Some(**k);
    }
}

/// Lee la clave del llavero sin crearla.
pub(crate) fn existing_key() -> KeyState {
    if let Some(k) = cached() {
        return KeyState::Ok(k);
    }
    let e = match entry() {
        Ok(e) => e,
        Err(m) => return KeyState::Unavailable(m),
    };
    match e.get_secret() {
        Ok(b) => match to_key(&b) {
            Some(k) => {
                remember(&k);
                KeyState::Ok(k)
            }
            None => KeyState::Unavailable("La clave local del llavero tiene un formato inválido.".into()),
        },
        Err(keyring::Error::NoEntry) => KeyState::Missing,
        Err(err) => KeyState::Unavailable(format!("Llavero no disponible: {err}")),
    }
}

/// Lee la clave o, si no hay ninguna, crea una aleatoria de 256 bits y la guarda (comprobando que se pudo releer).
pub(crate) fn key_or_create() -> KeyState {
    let _g = KEY_LOCK.lock();
    match existing_key() {
        KeyState::Missing => {}
        other => return other,
    }
    let e = match entry() {
        Ok(e) => e,
        Err(m) => return KeyState::Unavailable(m),
    };
    let k = crate::vault::new_key();
    if let Err(err) = e.set_secret(&k[..]) {
        return KeyState::Unavailable(format!("No se pudo guardar la clave local en el llavero: {err}"));
    }
    // Un llavero que acepta pero no conserva la clave dejaría los datos cifrados sin clave: se verifica antes de usarla.
    match e.get_secret() {
        Ok(b) if b.as_slice() == &k[..] => {
            remember(&k);
            KeyState::Ok(k)
        }
        _ => KeyState::Unavailable("El llavero no conservó la clave local.".into()),
    }
}

// ───────────────────────── lectura / escritura ─────────────────────────

/// Lee `datos.json` (o su copia): plano tal cual, cifrado descifrado con la clave del llavero.
pub(crate) fn read_data(path: &Path) -> Result<Vec<u8>, String> {
    read_data_with(path, &existing_key)
}

pub(crate) fn read_data_with(path: &Path, existing: &dyn Fn() -> KeyState) -> Result<Vec<u8>, String> {
    let raw = std::fs::read(path).map_err(|e| format!("No se pudo leer {}: {e}", file_name(path)))?;
    if !is_encrypted(&raw) {
        return Ok(raw);
    }
    match existing() {
        KeyState::Ok(k) => decrypt_bytes(&k, &raw),
        KeyState::Missing => Err(missing_msg(path)),
        KeyState::Unavailable(m) => Err(format!("{} está cifrado y no se pudo leer la clave local ({m}). No se modificó el archivo.", file_name(path))),
    }
}

/// Guarda `plain` de forma atómica: cifrado si hay llavero; JSON plano (0600) si no. Nunca pierde datos.
pub(crate) fn write_data(path: &PathBuf, plain: &[u8]) -> Result<(), String> {
    write_data_with(path, plain, &existing_key, &key_or_create)
}

pub(crate) fn write_data_with(path: &PathBuf, plain: &[u8], existing: &dyn Fn() -> KeyState, create: &dyn Fn() -> KeyState) -> Result<(), String> {
    let current = std::fs::read(path).ok();
    let key = if current.as_deref().map(is_encrypted).unwrap_or(false) {
        // Ya cifrado: hace falta SU clave. Sin ella no se sobrescribe nada.
        match existing() {
            KeyState::Ok(k) => {
                if decrypt_bytes(&k, current.as_deref().unwrap_or_default()).is_err() {
                    // Estropeado o de otra clave: se aparta (no se borra) para poder recuperarlo.
                    let side = path.with_extension("json.corrupt");
                    std::fs::rename(path, &side).map_err(|e| format!("No se pudo apartar el archivo estropeado: {e}"))?;
                    eprintln!("[datos] {} no se pudo descifrar; apartado como {}", file_name(path), file_name(&side));
                }
                Some(k)
            }
            KeyState::Missing => return Err(missing_msg(path)),
            KeyState::Unavailable(m) => {
                return Err(format!("{} está cifrado y no se pudo leer la clave local ({m}). No se modificó el archivo.", file_name(path)))
            }
        }
    } else {
        match create() {
            KeyState::Ok(k) => Some(k),
            KeyState::Missing => None,
            KeyState::Unavailable(m) => {
                eprintln!("[datos] llavero no disponible, se guarda {} sin cifrar: {m}", file_name(path));
                None
            }
        }
    };
    let bytes = match key {
        Some(k) => match encrypt_bytes(&k, plain).and_then(|enc| decrypt_bytes(&k, &enc).map(|_| enc)) {
            Ok(enc) => enc,
            Err(m) => {
                eprintln!("[datos] fallo al cifrar, se guarda sin cifrar: {m}");
                plain.to_vec()
            }
        },
        None => plain.to_vec(),
    };
    crate::sync::write_atomic(path, &bytes)
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "datos.json".into())
}

fn missing_msg(path: &Path) -> String {
    format!(
        "{} está cifrado pero no se encontró la clave local en el llavero del sistema. No se modificó el archivo: restaura el llavero o recupera los datos desde la nube.",
        file_name(path)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);
    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("caesar-lc-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        std::fs::create_dir_all(&d).unwrap();
        d.join("datos.json")
    }
    fn key(b: u8) -> Key {
        zeroize::Zeroizing::new([b; 32])
    }
    fn ok(b: u8) -> impl Fn() -> KeyState {
        move || KeyState::Ok(key(b))
    }
    fn missing() -> KeyState {
        KeyState::Missing
    }
    fn broken() -> KeyState {
        KeyState::Unavailable("llavero roto".into())
    }

    #[test]
    fn roundtrip() {
        let enc = encrypt_bytes(&key(1), b"{\"a\":1}").unwrap();
        assert!(is_encrypted(&enc));
        assert!(!enc.windows(3).any(|w| w == b"\"a\""));
        assert_eq!(decrypt_bytes(&key(1), &enc).unwrap(), b"{\"a\":1}");
        assert!(decrypt_bytes(&key(2), &enc).is_err());
        // Dos cifrados del mismo texto difieren (nonce aleatorio).
        assert_ne!(enc, encrypt_bytes(&key(1), b"{\"a\":1}").unwrap());
    }

    #[test]
    fn migracion_plano_a_cifrado() {
        let p = tmp();
        std::fs::write(&p, b"{\"old\":true}").unwrap();
        // Lectura retrocompatible del plano.
        assert_eq!(read_data_with(&p, &missing).unwrap(), b"{\"old\":true}");
        write_data_with(&p, b"{\"new\":true}", &ok(7), &ok(7)).unwrap();
        let raw = std::fs::read(&p).unwrap();
        assert!(is_encrypted(&raw));
        assert_eq!(read_data_with(&p, &ok(7)).unwrap(), b"{\"new\":true}");
    }

    #[test]
    fn archivo_corrupto() {
        let p = tmp();
        let mut enc = encrypt_bytes(&key(3), b"{\"x\":1}").unwrap();
        let n = enc.len();
        enc[n - 1] ^= 0xFF;
        std::fs::write(&p, &enc).unwrap();
        assert!(read_data_with(&p, &ok(3)).is_err());
        // Al guardar, el corrupto se aparta (no se borra) y se escribe uno nuevo válido.
        write_data_with(&p, b"{\"y\":2}", &ok(3), &ok(3)).unwrap();
        assert_eq!(read_data_with(&p, &ok(3)).unwrap(), b"{\"y\":2}");
        assert_eq!(std::fs::read(p.with_extension("json.corrupt")).unwrap(), enc);
        // Truncado.
        std::fs::write(&p, &enc[..MAGIC.len() + 4]).unwrap();
        assert!(read_data_with(&p, &ok(3)).is_err());
    }

    #[test]
    fn clave_ausente_no_toca_el_archivo() {
        let p = tmp();
        let enc = encrypt_bytes(&key(4), b"{\"x\":1}").unwrap();
        std::fs::write(&p, &enc).unwrap();
        assert!(read_data_with(&p, &missing).unwrap_err().contains("clave local"));
        assert!(read_data_with(&p, &broken).is_err());
        assert!(write_data_with(&p, b"{\"z\":1}", &missing, &ok(4)).is_err());
        assert!(write_data_with(&p, b"{\"z\":1}", &broken, &ok(4)).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), enc, "el archivo cifrado no debe cambiar");
    }

    #[test]
    fn si_falla_el_llavero_se_conserva_el_plano() {
        let p = tmp();
        std::fs::write(&p, b"{\"old\":true}").unwrap();
        write_data_with(&p, b"{\"new\":true}", &missing, &broken).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"{\"new\":true}");
        // Archivo inexistente + llavero roto: también se guarda plano.
        let q = tmp();
        write_data_with(&q, b"{\"n\":1}", &missing, &broken).unwrap();
        assert_eq!(std::fs::read(&q).unwrap(), b"{\"n\":1}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&q).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }
}
