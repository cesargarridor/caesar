//! Almacén de secretos local SIN llavero del sistema (cero diálogos del sistema operativo).
//!
//! Cada secreto (claves de IA, token de sync, clave E2E, id de dispositivo…) es un archivo `<datos>/secrets/<servicio>-<cuenta>.bin`
//! cifrado con AES-256-GCM. La clave se deriva del identificador de hardware de la máquina (`machine_key`): si alguien copia la
//! carpeta de datos a otro equipo, el identificador cambia y nada se puede descifrar.
//!
//! Límite honesto: el identificador de máquina no es secreto para otros procesos del MISMO equipo y usuario; esto protege los
//! datos copiados o robados del disco, no frente a malware que ya se ejecuta en esa cuenta.

use std::fmt;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub(crate) type Key = Zeroizing<[u8; 32]>;

const SALT: &[u8] = b"caesar_local_salt_v1";
const MAGIC: &[u8] = b"CAESAR-SEC1\n";
const NONCE_LEN: usize = 12;

#[derive(Debug)]
pub enum Error {
    /// No hay ningún secreto guardado con ese nombre.
    NoEntry,
    Other(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::NoEntry => write!(f, "no hay ningún secreto guardado"),
            Error::Other(m) => write!(f, "{m}"),
        }
    }
}

fn other(m: impl Into<String>) -> Error {
    Error::Other(m.into())
}

// ───────────────────────── clave de la máquina ─────────────────────────

static KEY_CACHE: Mutex<Option<[u8; 32]>> = Mutex::new(None);

/// SHA-256(salt ‖ identificador de hardware). Silenciosa: no abre ningún diálogo del sistema. Se calcula una vez por ejecución.
pub(crate) fn machine_key() -> Result<Key, String> {
    if let Some(a) = KEY_CACHE.lock().ok().and_then(|g| *g) {
        return Ok(Zeroizing::new(a));
    }
    let id = machine_uid::get().map_err(|e| format!("No se pudo obtener el identificador de la máquina: {e}"))?;
    if id.trim().is_empty() {
        return Err("El identificador de la máquina está vacío.".into());
    }
    let mut h = Sha256::new();
    h.update(SALT);
    h.update(b"\0");
    h.update(id.trim().as_bytes());
    let a: [u8; 32] = h.finalize().into();
    if let Ok(mut g) = KEY_CACHE.lock() {
        *g = Some(a);
    }
    Ok(Zeroizing::new(a))
}

// ───────────────────────── almacén de archivos ─────────────────────────

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Se llama una vez al arrancar con la carpeta de datos de la app.
pub fn init(dir: PathBuf) {
    let _ = DIR.set(dir.join("secrets"));
}

pub struct Entry {
    path: PathBuf,
    /// Se liga al texto cifrado (AAD): un secreto no se puede pasar por otro nombre.
    name: String,
}

impl Entry {
    pub fn new(service: &str, account: &str) -> Result<Self, Error> {
        let dir = DIR.get().ok_or_else(|| other("El almacén de secretos no está inicializado."))?;
        let name = format!("{service}-{account}");
        let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
        Ok(Self { path: dir.join(format!("{safe}.bin")), name })
    }

    pub fn get_secret(&self) -> Result<Vec<u8>, Error> {
        let raw = match std::fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(Error::NoEntry),
            Err(e) => return Err(other(format!("No se pudo leer el secreto: {e}"))),
        };
        let body = raw.strip_prefix(MAGIC).filter(|b| b.len() >= NONCE_LEN + 16).ok_or_else(|| other("El secreto guardado está dañado."))?;
        let (nonce, ct) = body.split_at(NONCE_LEN);
        let key = machine_key().map_err(Error::Other)?;
        Aes256Gcm::new(key.as_slice().into())
            .decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad: self.name.as_bytes() })
            .map_err(|_| other("No se pudo descifrar el secreto (¿se copió desde otro equipo?)."))
    }

    pub fn set_secret(&self, bytes: &[u8]) -> Result<(), Error> {
        let key = machine_key().map_err(Error::Other)?;
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);
        let ct = Aes256Gcm::new(key.as_slice().into())
            .encrypt(Nonce::from_slice(&nonce), Payload { msg: bytes, aad: self.name.as_bytes() })
            .map_err(|_| other("No se pudo cifrar el secreto."))?;
        let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ct.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| other(format!("No se pudo crear la carpeta de secretos: {e}")))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }
        crate::sync::write_atomic(&self.path, &out).map_err(Error::Other)
    }

    pub fn get_password(&self) -> Result<String, Error> {
        String::from_utf8(self.get_secret()?).map_err(|_| other("El secreto guardado no es texto válido."))
    }

    pub fn set_password(&self, p: &str) -> Result<(), Error> {
        self.set_secret(p.as_bytes())
    }

    pub fn delete_credential(&self) -> Result<(), Error> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::NoEntry),
            Err(e) => Err(other(format!("No se pudo borrar el secreto: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_y_aad() {
        let d = std::env::temp_dir().join(format!("caesar-sec-{}", std::process::id()));
        init(d.clone());
        let e = Entry::new("Caesar", "t-a").unwrap();
        assert!(matches!(e.get_secret(), Err(Error::NoEntry)));
        e.set_secret(b"hola").unwrap();
        assert_eq!(e.get_secret().unwrap(), b"hola");
        let raw = std::fs::read(&e.path).unwrap();
        assert!(!raw.windows(4).any(|w| w == b"hola"));
        // Un archivo copiado bajo otro nombre no descifra (AAD distinto).
        let f = Entry::new("Caesar", "t-b").unwrap();
        std::fs::copy(&e.path, &f.path).unwrap();
        assert!(f.get_secret().is_err());
        e.delete_credential().unwrap();
        assert!(matches!(e.delete_credential(), Err(Error::NoEntry)));
    }
}
