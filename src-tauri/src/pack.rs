//! Compresión de lo que se sube a la nube: JSON → (gzip si es grande) → cifrado → Base64.
//!
//! - Al subir, `pack` comprime con gzip solo si los datos pasan de `COMPRESS_OVER`. Así las cuentas pequeñas siguen subiendo
//!   exactamente lo mismo que antes y las versiones anteriores de Caesar siguen pudiendo leerlas; la compresión solo entra
//!   cuando de otro modo se acercaría al límite de 1 MB por documento de Firestore.
//! - Al bajar, `unpack` detecta por los bytes mágicos de gzip (1F 8B) si hay que descomprimir. Un JSON nunca empieza por 0x1F,
//!   así que los datos antiguos (cifrados pero sin comprimir) se leen igual que siempre.
//! - En el estado que se sincroniza solo hay definiciones de peticiones, variables y marcas de borrado: las respuestas y el
//!   historial no se guardan en `datos.json`, por lo que no hay nada pesado que filtrar antes de comprimir.

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{Read, Write};

/// A partir de este tamaño (bytes de JSON) se comprime al subir.
pub const COMPRESS_OVER: usize = 256 * 1024;
/// Tope al descomprimir (protege de datos corruptos o maliciosos que se expandan sin fin).
const MAX_UNPACKED: u64 = 64 * 1024 * 1024;

/// ¿Empiezan los bytes con la cabecera de gzip?
pub fn is_gzip(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

/// Comprime con gzip si los datos son grandes y la compresión de verdad ocupa menos; si no, los devuelve tal cual.
pub fn pack(plain: &[u8]) -> Result<Vec<u8>, String> {
    if plain.len() <= COMPRESS_OVER {
        return Ok(plain.to_vec());
    }
    let mut enc = GzEncoder::new(Vec::with_capacity(plain.len() / 4), Compression::best());
    enc.write_all(plain).map_err(|e| format!("No se pudo comprimir: {e}"))?;
    let packed = enc.finish().map_err(|e| format!("No se pudo comprimir: {e}"))?;
    Ok(if packed.len() < plain.len() { packed } else { plain.to_vec() })
}

/// Inverso de `pack`: descomprime si hace falta; los datos sin comprimir (los de siempre) se devuelven igual.
pub fn unpack(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    if !is_gzip(&bytes) {
        return Ok(bytes);
    }
    let mut out = Vec::with_capacity(bytes.len() * 4);
    GzDecoder::new(bytes.as_slice())
        .take(MAX_UNPACKED + 1)
        .read_to_end(&mut out)
        .map_err(|_| "Los datos de la nube están comprimidos pero dañados.".to_string())?;
    if out.len() as u64 > MAX_UNPACKED {
        return Err("Los datos de la nube descomprimidos son demasiado grandes.".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn big_json(n: usize) -> Vec<u8> {
        let item = r#"{"type":"request","id":"abc","name":"GET /users","method":"GET","url":"https://api.example.com/v1/users","headers":[{"key":"Authorization","value":"Bearer {{token}}","enabled":true}]}"#;
        let body = vec![item; n].join(",");
        format!(r#"{{"v":3,"workspaces":[{{"id":"default","collections":[{body}]}}]}}"#).into_bytes()
    }

    #[test]
    fn small_data_is_left_alone() {
        let small = br#"{"v":3,"workspaces":[]}"#.to_vec();
        assert_eq!(pack(&small).unwrap(), small);
    }

    #[test]
    fn big_data_roundtrips_and_shrinks() {
        let plain = big_json(3000); // ~500 KB
        assert!(plain.len() > COMPRESS_OVER);
        let packed = pack(&plain).unwrap();
        assert!(is_gzip(&packed));
        assert!(packed.len() * 5 < plain.len(), "debería comprimir al menos 5x, fue {} → {}", plain.len(), packed.len());
        assert_eq!(unpack(packed).unwrap(), plain);
    }

    #[test]
    fn old_uncompressed_data_still_reads() {
        // Datos antiguos: JSON cifrado sin comprimir (empieza por '{' o '['), de cualquier tamaño.
        let old = big_json(3000);
        assert_eq!(unpack(old.clone()).unwrap(), old);
        let tiny = b"{}".to_vec();
        assert_eq!(unpack(tiny.clone()).unwrap(), tiny);
        assert_eq!(unpack(Vec::new()).unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn corrupt_gzip_is_an_error_not_a_panic() {
        let mut packed = pack(&big_json(3000)).unwrap();
        let n = packed.len();
        packed.truncate(n / 2);
        assert!(unpack(packed).is_err());
        assert!(unpack(vec![0x1f, 0x8b, 0, 1, 2]).is_err());
    }

    #[test]
    fn incompressible_data_is_not_inflated() {
        // Bytes pseudoaleatorios: gzip no ayuda, se deja igual.
        let mut x: u32 = 12345;
        let noise: Vec<u8> = (0..COMPRESS_OVER + 1000)
            .map(|_| {
                x = x.wrapping_mul(1664525).wrapping_add(1013904223);
                (x >> 24) as u8 | 0x80 // nunca empieza por 0x1F
            })
            .collect();
        let p = pack(&noise).unwrap();
        assert!(p.len() <= noise.len());
        assert_eq!(unpack(p).unwrap(), noise);
    }
}
