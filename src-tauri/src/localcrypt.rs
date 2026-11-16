//! Cifrado en reposo de `datos.json` (AES-256-GCM) con una clave derivada del identificador de hardware de la máquina
//! (SHA-256 de un salt estático + el id; ver `secret::machine_key`). No usa el llavero del sistema: cero diálogos de contraseña.
//! Un `datos.json` copiado a otro equipo no se puede descifrar porque allí el identificador es otro.
//! Es independiente de la clave de sincronización (`vault`): un usuario sin cuenta Pro también tiene cifrado local.
//!
//! Formato: `CAESAR-ENC1\n` + nonce (12 bytes) + texto cifrado (con etiqueta GCM). Un archivo que no empieza así es JSON plano
//! (versiones anteriores) y se lee igual; se reescribe cifrado en el siguiente guardado (migración perezosa).
//!
//! Reglas de seguridad de los datos:
//! - Si no hay identificador de máquina, NUNCA se pierden datos ni se fuerza el cifrado: se escribe JSON plano (0600) y se registra el motivo.
//! - Un archivo cifrado con la clave antigua del llavero (versiones previas) o de otro equipo no descifra: se aparta como `*.corrupt`
//!   (no se borra) y se empieza de cero.

use std::path::{Path, PathBuf};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};

use crate::vault::Key;

const MAGIC: &[u8] = b"CAESAR-ENC1\n";
const NONCE_LEN: usize = 12;

/// Resultado de pedir la clave local.
pub(crate) enum KeyState {
    Ok(Key),
    /// No hay clave (solo se usa en tests).
    Missing,
    /// No se pudo obtener el identificador de la máquina.
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

// ───────────────────────── clave derivada del hardware ─────────────────────────

/// La clave es SHA-256(salt ‖ id de hardware) (ver `secret::machine_key`): determinista, silenciosa y sin diálogos del sistema.
/// Nunca falta (`Missing` ya no ocurre en producción); solo falla si el sistema no da identificador de máquina.
pub(crate) fn existing_key() -> KeyState {
    match crate::secret::machine_key() {
        Ok(k) => KeyState::Ok(k),
        Err(m) => KeyState::Unavailable(m),
    }
}

pub(crate) fn key_or_create() -> KeyState {
    existing_key()
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
        KeyState::Ok(k) => decrypt_bytes(&k, &raw).map_err(|e| {
            // Cifrado con la clave del llavero antigua o copiado de otro equipo: se aparta (no se borra) para no bloquear el arranque.
            let side = path.with_extension("json.corrupt");
            if std::fs::rename(path, &side).is_ok() {
                eprintln!("[datos] {} no se pudo descifrar; apartado como {}", file_name(path), file_name(&side));
            }
            e
        }),
        KeyState::Missing => Err(missing_msg(path)),
        KeyState::Unavailable(m) => Err(format!("{} está cifrado y no se pudo leer la clave local ({m}). No se modificó el archivo.", file_name(path))),
    }
}

/// Guarda `plain` de forma atómica: cifrado si hay identificador de máquina; JSON plano (0600) si no. Nunca pierde datos.
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
                eprintln!("[datos] clave local no disponible, se guarda {} sin cifrar: {m}", file_name(path));
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
        "{} está cifrado pero no se encontró la clave local. No se modificó el archivo: recupera los datos desde la nube.",
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
