//! Bóveda local de Caesar: clave de datos, cifrado de extremo a extremo y vinculación de dispositivos.
//!
//! - Hay una **clave de datos** aleatoria de 256 bits. Vive solo en el llavero del sistema operativo
//!   (Credential Manager / Keychain / Secret Service) y nunca se escribe en disco ni se envía en claro.
//! - Todo lo que se sincroniza se cifra aquí con AES-256-GCM antes de salir del equipo.
//! - La **clave de recuperación** es esa misma clave escrita en texto con una suma de comprobación.
//! - Un ordenador nuevo recibe la clave de otro ya vinculado mediante un intercambio X25519 efímero
//!   (ver `pairing_*`): el servidor solo ve claves públicas y un bloque cifrado.
//!
//! La interfaz nunca ve la clave: solo pide cifrar/descifrar y, una vez, la clave de recuperación.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use hkdf::Hkdf;
use serde::Serialize;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

const SERVICE: &str = "Caesar";
const ACCOUNT: &str = "data-key";
const ENVELOPE_PREFIX: &str = "c1";
const LINK_INFO: &[u8] = b"caesar-link-v1";
const SAS_INFO: &[u8] = b"caesar-sas-v1";
/// Una vinculación que no se completa en este tiempo se descarta.
const PAIRING_TTL: Duration = Duration::from_secs(10 * 60);
/// Alfabeto de la clave de recuperación: 32 símbolos sin I, O, 0 ni 1 para evitar confusiones.
const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

pub type Key = Zeroizing<[u8; 32]>;

// ───────────────────────── cifrado ─────────────────────────

fn random_bytes<const N: usize>() -> [u8; N] {
    use aes_gcm::aead::rand_core::RngCore;
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

fn new_key() -> Key {
    Zeroizing::new(random_bytes::<32>())
}

/// Cifra `plaintext` ligándolo a `context` (p. ej. el id de la colección): un bloque cifrado
/// para una colección no se puede pasar por otra sin que falle el descifrado.
/// Formato: `c1.<nonce>.<cifrado>` en base64 URL-safe. Cada llamada usa un nonce nuevo.
pub fn encrypt(key: &Key, context: &str, plaintext: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(key.as_slice().into());
    let nonce_bytes = random_bytes::<12>();
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: plaintext, aad: context.as_bytes() })
        .map_err(|_| "No se pudo cifrar.".to_string())?;
    Ok(format!("{ENVELOPE_PREFIX}.{}.{}", B64.encode(nonce_bytes), B64.encode(ct)))
}

pub fn decrypt(key: &Key, context: &str, envelope: &str) -> Result<Vec<u8>, String> {
    let bad = || "Datos cifrados no válidos o clave incorrecta.".to_string();
    let mut parts = envelope.split('.');
    if parts.next() != Some(ENVELOPE_PREFIX) {
        return Err(bad());
    }
    let nonce = B64.decode(parts.next().ok_or_else(bad)?).map_err(|_| bad())?;
    let ct = B64.decode(parts.next().ok_or_else(bad)?).map_err(|_| bad())?;
    if parts.next().is_some() || nonce.len() != 12 {
        return Err(bad());
    }
    Aes256Gcm::new(key.as_slice().into())
        .decrypt(Nonce::from_slice(&nonce), Payload { msg: &ct, aad: context.as_bytes() })
        .map_err(|_| bad())
}

// ───────────────────────── clave de recuperación ─────────────────────────

fn checksum(key: &[u8]) -> [u8; 2] {
    let h = Sha256::digest([b"caesar-recovery-v1".as_slice(), key].concat());
    [h[0], h[1]]
}

/// `CSR-XXXXX-XXXXX-...`: 32 bytes de clave + 2 de comprobación, en base 32.
pub fn recovery_encode(key: &Key) -> String {
    let mut data = key.to_vec();
    data.extend_from_slice(&checksum(key.as_slice()));
    let mut bits: u32 = 0;
    let mut nbits = 0;
    let mut out = String::new();
    for byte in data {
        bits = (bits << 8) | byte as u32;
        nbits += 8;
        while nbits >= 5 {
            nbits -= 5;
            out.push(ALPHABET[((bits >> nbits) & 31) as usize] as char);
        }
    }
    if nbits > 0 {
        out.push(ALPHABET[((bits << (5 - nbits)) & 31) as usize] as char);
    }
    let groups: Vec<&str> = out.as_bytes().chunks(5).map(|c| std::str::from_utf8(c).unwrap()).collect();
    format!("CSR-{}", groups.join("-"))
}

pub fn recovery_decode(text: &str) -> Result<Key, String> {
    let bad = || "La clave de recuperación no es válida. Revisa que esté completa y sin errores.".to_string();
    let upper = text.trim().to_uppercase();
    let body = upper.strip_prefix("CSR").unwrap_or(&upper);
    let mut bits: u32 = 0;
    let mut nbits = 0;
    let mut data: Vec<u8> = Vec::with_capacity(34);
    for c in body.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'-') {
        let v = ALPHABET.iter().position(|a| *a == c).ok_or_else(bad)? as u32;
        bits = (bits << 5) | v;
        nbits += 5;
        if nbits >= 8 {
            nbits -= 8;
            data.push(((bits >> nbits) & 0xff) as u8);
        }
    }
    if data.len() != 34 {
        return Err(bad());
    }
    let (key, sum) = data.split_at(32);
    if checksum(key) != [sum[0], sum[1]] {
        return Err(bad());
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(key);
    Ok(Zeroizing::new(k))
}

// ───────────────────────── vinculación de dispositivos ─────────────────────────

fn pub_from_b64(s: &str) -> Result<PublicKey, String> {
    let bytes: [u8; 32] = B64
        .decode(s.trim())
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("Código de vinculación no válido.")?;
    Ok(PublicKey::from(bytes))
}

/// Clave de transporte: X25519 entre los dos extremos + HKDF ligado a ambas claves públicas.
fn link_key(secret: &StaticSecret, peer: &PublicKey, new_pub: &PublicKey, approver_pub: &PublicKey) -> Result<Key, String> {
    let shared = secret.diffie_hellman(peer);
    // Una clave pública de orden pequeño daría un secreto compartido de ceros: se rechaza.
    if !shared.was_contributory() {
        return Err("Código de vinculación no válido.".into());
    }
    let mut info = LINK_INFO.to_vec();
    info.extend_from_slice(new_pub.as_bytes());
    info.extend_from_slice(approver_pub.as_bytes());
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(None, shared.as_bytes()).expand(&info, &mut out).map_err(|_| "Error de derivación.")?;
    Ok(Zeroizing::new(out))
}

/// Código de 6 cifras que ven los dos equipos. Si no coinciden, alguien se ha interpuesto: se cancela.
fn verification_code(new_pub: &PublicKey, approver_pub: &PublicKey) -> String {
    let h = Sha256::digest([SAS_INFO, new_pub.as_bytes(), approver_pub.as_bytes()].concat());
    let n = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) % 1_000_000;
    format!("{:03} {:03}", n / 1000, n % 1000)
}

enum Pairing {
    /// Equipo nuevo: espera la clave pública del equipo que aprueba y luego el bloque cifrado.
    New { secret: StaticSecret, public: PublicKey, approver: Option<PublicKey>, started: Instant },
    /// Equipo ya vinculado: ha recibido el código del nuevo y espera la confirmación del usuario.
    Approver { secret: StaticSecret, public: PublicKey, new_pub: PublicKey, started: Instant },
}

#[derive(Default)]
pub struct VaultState(Mutex<Option<Pairing>>);

// ───────────────────────── llavero ─────────────────────────

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Llavero no disponible: {e}"))
}

fn load_key() -> Result<Option<Key>, String> {
    match entry()?.get_secret() {
        Ok(v) => {
            let arr: [u8; 32] = v.try_into().map_err(|_| "La clave guardada está dañada.".to_string())?;
            Ok(Some(Zeroizing::new(arr)))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("No se pudo leer el llavero: {e}")),
    }
}

fn store_key(key: &Key) -> Result<(), String> {
    entry()?.set_secret(key.as_slice()).map_err(|e| format!("No se pudo guardar en el llavero: {e}"))
}

fn require_key() -> Result<Key, String> {
    load_key()?.ok_or_else(|| "La sincronización cifrada no está activada en este equipo.".to_string())
}

// ───────────────────────── comandos ─────────────────────────

#[derive(Serialize)]
pub struct VaultStatus {
    has_key: bool,
}

#[tauri::command]
pub fn vault_status() -> Result<VaultStatus, String> {
    Ok(VaultStatus { has_key: load_key()?.is_some() })
}

/// Activa el cifrado en este equipo (primera vez). Devuelve la clave de recuperación, que se muestra una sola vez.
#[tauri::command]
pub fn vault_create() -> Result<String, String> {
    if load_key()?.is_some() {
        return Err("Este equipo ya tiene una clave. Elimínala antes de crear otra.".into());
    }
    let key = new_key();
    store_key(&key)?;
    Ok(recovery_encode(&key))
}

/// Restaura la clave en un equipo nuevo a partir de la clave de recuperación.
#[tauri::command]
pub fn vault_restore(recovery: String) -> Result<(), String> {
    if load_key()?.is_some() {
        return Err("Este equipo ya tiene una clave.".into());
    }
    store_key(&recovery_decode(&recovery)?)
}

/// Borra la clave de este equipo. Sin copia en otro equipo ni clave de recuperación, los datos cifrados no se pueden recuperar.
#[tauri::command]
pub fn vault_forget() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("No se pudo borrar la clave: {e}")),
    }
}

#[tauri::command]
pub fn vault_encrypt(context: String, plaintext: String) -> Result<String, String> {
    encrypt(&require_key()?, &context, plaintext.as_bytes())
}

#[tauri::command]
pub fn vault_decrypt(context: String, envelope: String) -> Result<String, String> {
    let bytes = decrypt(&require_key()?, &context, &envelope)?;
    String::from_utf8(bytes).map_err(|_| "Los datos descifrados no son texto válido.".to_string())
}

// ── Vinculación: equipo NUEVO ──

/// 1. El equipo nuevo genera un par de claves efímero y devuelve su clave pública (va en el QR/enlace).
#[tauri::command]
pub fn pairing_begin(state: tauri::State<VaultState>) -> Result<String, String> {
    if load_key()?.is_some() {
        return Err("Este equipo ya tiene una clave.".into());
    }
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    *state.0.lock().unwrap() = Some(Pairing::New { secret, public, approver: None, started: Instant::now() });
    Ok(B64.encode(public.as_bytes()))
}

/// 3. El equipo nuevo recibe la clave pública del que aprueba y muestra el código de verificación.
#[tauri::command]
pub fn pairing_code(state: tauri::State<VaultState>, approver_pub: String) -> Result<String, String> {
    let approver = pub_from_b64(&approver_pub)?;
    let mut guard = state.0.lock().unwrap();
    match guard.as_mut() {
        Some(Pairing::New { public, approver: slot, started, .. }) if started.elapsed() < PAIRING_TTL => {
            *slot = Some(approver);
            Ok(verification_code(public, &approver))
        }
        _ => Err("La vinculación ha caducado. Empieza de nuevo.".into()),
    }
}

/// 5. El equipo nuevo recibe el bloque cifrado, obtiene la clave de datos y la guarda en el llavero.
#[tauri::command]
pub fn pairing_finish(state: tauri::State<VaultState>, blob: String) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    let key = match guard.as_ref() {
        Some(Pairing::New { secret, public, approver: Some(approver), started }) if started.elapsed() < PAIRING_TTL => {
            let lk = link_key(secret, approver, public, approver)?;
            let bytes = decrypt(&lk, "link", &blob)?;
            let arr: [u8; 32] = bytes.try_into().map_err(|_| "Clave recibida no válida.".to_string())?;
            Zeroizing::new(arr)
        }
        _ => return Err("La vinculación ha caducado o no está lista.".into()),
    };
    store_key(&key)?;
    *guard = None;
    Ok(())
}

// ── Vinculación: equipo YA VINCULADO ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproverStart {
    my_pub: String,
    code: String,
}

/// 2. El equipo vinculado lee el código del nuevo, genera su par efímero y muestra el código de verificación.
///    Aún NO envía nada: espera a que el usuario compare los códigos.
#[tauri::command]
pub fn pairing_approve_start(state: tauri::State<VaultState>, new_pub: String) -> Result<ApproverStart, String> {
    require_key()?;
    let new_pub = pub_from_b64(&new_pub)?;
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    let code = verification_code(&new_pub, &public);
    *state.0.lock().unwrap() = Some(Pairing::Approver { secret, public, new_pub, started: Instant::now() });
    Ok(ApproverStart { my_pub: B64.encode(public.as_bytes()), code })
}

/// 4. El usuario confirma que los códigos coinciden: se cifra la clave de datos para el equipo nuevo.
#[tauri::command]
pub fn pairing_approve_confirm(state: tauri::State<VaultState>) -> Result<String, String> {
    let mut guard = state.0.lock().unwrap();
    let blob = match guard.as_ref() {
        Some(Pairing::Approver { secret, public, new_pub, started }) if started.elapsed() < PAIRING_TTL => {
            let lk = link_key(secret, new_pub, new_pub, public)?;
            encrypt(&lk, "link", require_key()?.as_slice())?
        }
        _ => return Err("La vinculación ha caducado. Empieza de nuevo.".into()),
    };
    *guard = None;
    Ok(blob)
}

#[tauri::command]
pub fn pairing_cancel(state: tauri::State<VaultState>) {
    *state.0.lock().unwrap() = None;
}

// ───────────────────────── tests ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_roundtrip_and_context_binding() {
        let key = new_key();
        let env = encrypt(&key, "col-1", b"Bearer secreto").unwrap();
        assert!(env.starts_with("c1."));
        assert!(!env.contains("secreto"));
        assert_eq!(decrypt(&key, "col-1", &env).unwrap(), b"Bearer secreto");
        // otro contexto, otra clave o datos alterados deben fallar
        assert!(decrypt(&key, "col-2", &env).is_err());
        assert!(decrypt(&new_key(), "col-1", &env).is_err());
        let mut tampered = env.clone();
        tampered.pop();
        tampered.push(if env.ends_with('A') { 'B' } else { 'A' });
        assert!(decrypt(&key, "col-1", &tampered).is_err());
        assert!(decrypt(&key, "col-1", "basura").is_err());
    }

    #[test]
    fn nonce_is_never_reused() {
        let key = new_key();
        assert_ne!(encrypt(&key, "x", b"a").unwrap(), encrypt(&key, "x", b"a").unwrap());
    }

    #[test]
    fn recovery_key_roundtrip_and_typo_detection() {
        let key = new_key();
        let text = recovery_encode(&key);
        assert!(text.starts_with("CSR-"));
        assert_eq!(*recovery_decode(&text).unwrap(), *key);
        // tolerante a minúsculas y espacios en lugar de guiones
        assert_eq!(*recovery_decode(&text.to_lowercase().replace('-', " ")).unwrap(), *key);
        // un carácter cambiado se detecta por la suma de comprobación
        let mut chars: Vec<char> = text.chars().collect();
        let i = 6;
        chars[i] = if chars[i] == 'A' { 'B' } else { 'A' };
        assert!(recovery_decode(&chars.into_iter().collect::<String>()).is_err());
        assert!(recovery_decode("CSR-AAAA").is_err());
    }

    #[test]
    fn pairing_transfers_key_and_codes_match() {
        let data_key = new_key();
        // equipo nuevo
        let n_secret = StaticSecret::random_from_rng(OsRng);
        let n_pub = PublicKey::from(&n_secret);
        // equipo vinculado
        let a_secret = StaticSecret::random_from_rng(OsRng);
        let a_pub = PublicKey::from(&a_secret);
        assert_eq!(verification_code(&n_pub, &a_pub), verification_code(&n_pub, &a_pub));
        let blob = encrypt(&link_key(&a_secret, &n_pub, &n_pub, &a_pub).unwrap(), "link", data_key.as_slice()).unwrap();
        let got = decrypt(&link_key(&n_secret, &a_pub, &n_pub, &a_pub).unwrap(), "link", &blob).unwrap();
        assert_eq!(got, data_key.to_vec());
        // un intruso con otro par de claves no puede abrir el bloque
        let m_secret = StaticSecret::random_from_rng(OsRng);
        assert!(decrypt(&link_key(&m_secret, &a_pub, &n_pub, &a_pub).unwrap(), "link", &blob).is_err());
        // y su código de verificación no coincide
        let m_pub = PublicKey::from(&m_secret);
        assert_ne!(verification_code(&n_pub, &a_pub), verification_code(&n_pub, &m_pub));
    }

    #[test]
    fn rejects_low_order_public_key() {
        let s = StaticSecret::random_from_rng(OsRng);
        let zero = PublicKey::from([0u8; 32]);
        assert!(link_key(&s, &zero, &zero, &zero).is_err());
        assert!(pub_from_b64("no es base64 !!").is_err());
        assert!(pub_from_b64(&B64.encode([1u8; 5])).is_err());
    }
}
