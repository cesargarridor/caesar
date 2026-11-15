//! Almacén de secretos: el llavero del sistema, con un único respaldo en archivo SOLO dentro de un Snap.
//!
//! En un Snap con confinamiento estricto, AppArmor bloquea el acceso al llavero (`org.freedesktop.secrets`) hasta que el usuario
//! ejecuta `snap connect caesar:password-manager-service`, y la tienda no lo conecta sola. Para que la app funcione sin ese paso,
//! si estamos en un Snap y el llavero falla, el secreto se guarda en un archivo con permisos 0600 en `$SNAP_USER_COMMON`.
//! Es menos seguro (la clave queda junto a los datos), por eso fuera de Snap (.deb, AppImage, macOS, Windows) NUNCA se usa.
//! Si luego el llavero funciona, el secreto vuelve a él y el archivo se borra.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

/// Tras el primer fallo del llavero en un Snap no se vuelve a intentar en esta ejecución.
static KEYRING_BROKEN: AtomicBool = AtomicBool::new(false);

pub struct Entry {
    inner: Result<keyring::Entry, keyring::Error>,
    account: String,
}

fn in_snap() -> bool {
    std::env::var_os("SNAP").is_some()
}

fn file_for(account: &str) -> Option<PathBuf> {
    let base = std::env::var_os("SNAP_USER_COMMON")
        .or_else(|| std::env::var_os("SNAP_USER_DATA"))
        .map(PathBuf::from)?;
    let safe: String = account.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    Some(base.join("secrets").join(safe))
}

fn io_err(e: std::io::Error) -> keyring::Error {
    keyring::Error::PlatformFailure(Box::new(e))
}

fn write_file(account: &str, bytes: &[u8]) -> Result<(), keyring::Error> {
    let path = file_for(account).ok_or(keyring::Error::NoEntry)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io_err)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    let tmp = path.with_extension("tmp");
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).map_err(io_err)?;
        f.write_all(bytes).map_err(io_err)?;
        f.sync_all().map_err(io_err)?;
    }
    std::fs::rename(&tmp, &path).map_err(io_err)
}

fn read_file(account: &str) -> Result<Vec<u8>, keyring::Error> {
    let path = file_for(account).ok_or(keyring::Error::NoEntry)?;
    match std::fs::read(path) {
        Ok(b) => Ok(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(keyring::Error::NoEntry),
        Err(e) => Err(io_err(e)),
    }
}

fn remove_file(account: &str) {
    if let Some(p) = file_for(account) {
        let _ = std::fs::remove_file(p);
    }
}

impl Entry {
    pub fn new(service: &str, account: &str) -> Result<Self, keyring::Error> {
        Ok(Self { inner: keyring::Entry::new(service, account), account: account.to_string() })
    }

    fn use_file(&self) -> bool {
        in_snap() && KEYRING_BROKEN.load(Ordering::Relaxed)
    }

    pub fn get_secret(&self) -> Result<Vec<u8>, keyring::Error> {
        if !self.use_file() {
            let res = match &self.inner {
                Ok(e) => e.get_secret(),
                Err(_) => Err(keyring::Error::NoEntry),
            };
            match res {
                Ok(v) => return Ok(v),
                Err(keyring::Error::NoEntry) if !in_snap() => return Err(keyring::Error::NoEntry),
                Err(keyring::Error::NoEntry) => {} // en Snap puede estar en el archivo de una sesión anterior
                Err(e) => {
                    if !in_snap() {
                        return Err(e);
                    }
                    KEYRING_BROKEN.store(true, Ordering::Relaxed);
                }
            }
        }
        read_file(&self.account)
    }

    pub fn set_secret(&self, bytes: &[u8]) -> Result<(), keyring::Error> {
        if !self.use_file() {
            let res = match &self.inner {
                Ok(e) => e.set_secret(bytes),
                Err(_) => Err(keyring::Error::NoEntry),
            };
            match res {
                Ok(()) => {
                    if in_snap() {
                        remove_file(&self.account);
                    }
                    return Ok(());
                }
                Err(e) if !in_snap() => return Err(e),
                Err(_) => KEYRING_BROKEN.store(true, Ordering::Relaxed),
            }
        }
        write_file(&self.account, bytes)
    }

    pub fn get_password(&self) -> Result<String, keyring::Error> {
        let b = self.get_secret()?;
        String::from_utf8(b).map_err(|e| keyring::Error::BadEncoding(e.into_bytes()))
    }

    pub fn set_password(&self, p: &str) -> Result<(), keyring::Error> {
        self.set_secret(p.as_bytes())
    }

    pub fn delete_credential(&self) -> Result<(), keyring::Error> {
        let res = match &self.inner {
            Ok(e) if !self.use_file() => e.delete_credential(),
            _ => Err(keyring::Error::NoEntry),
        };
        if in_snap() {
            // Snap: se borra también el archivo de respaldo; si el llavero no responde, no es un error.
            remove_file(&self.account);
            return Ok(());
        }
        res
    }
}
