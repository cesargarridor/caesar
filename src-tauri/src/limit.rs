//! Límite de llamadas a la nube: ventana deslizante por clave. Sirve para que ningún botón ni bucle dispare miles de peticiones.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

static HITS: Mutex<Option<HashMap<String, VecDeque<i64>>>> = Mutex::new(None);

/// `true` si aún cabe una llamada más de `key` (máximo `max` cada `window_ms`) y la anota; `false` si hay que descartarla.
pub fn allow(key: &str, max: usize, window_ms: i64) -> bool {
    allow_at(key, max, window_ms, crate::sync::now_ms())
}

fn allow_at(key: &str, max: usize, window_ms: i64, now: i64) -> bool {
    let Ok(mut g) = HITS.lock() else { return true };
    let q = g.get_or_insert_with(HashMap::new).entry(key.to_string()).or_default();
    while q.front().is_some_and(|t| now - t >= window_ms) {
        q.pop_front();
    }
    if q.len() >= max {
        return false;
    }
    q.push_back(now);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deja_pasar_el_maximo_y_corta_el_resto() {
        assert!(allow_at("t1", 2, 60_000, 0));
        assert!(allow_at("t1", 2, 60_000, 1_000));
        assert!(!allow_at("t1", 2, 60_000, 2_000));
        assert!(allow_at("t1", 2, 60_000, 61_000));
    }

    #[test]
    fn cada_clave_va_por_separado() {
        assert!(allow_at("a2", 1, 60_000, 0));
        assert!(allow_at("b2", 1, 60_000, 0));
        assert!(!allow_at("a2", 1, 60_000, 10));
    }
}
