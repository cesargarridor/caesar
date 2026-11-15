//! Enlaces `caesar://share?payload=…`: el sistema abre Caesar (o la ventana ya abierta) y la interfaz desempaqueta la petición.
//!
//! - macOS: el esquema se registra al empaquetar (Info.plist, desde `plugins.deep-link` de tauri.conf.json); en `tauri dev` no.
//! - Windows/Linux: el instalador lo registra; en desarrollo se registra en tiempo de ejecución con `register_all`.
//! - Windows/Linux abren una SEGUNDA instancia con el enlace como argumento: `tauri-plugin-single-instance` (con la función
//!   `deep-link`) lo reenvía a la ventana que ya está abierta.
//! Rust solo valida el prefijo y el tamaño y guarda el enlace hasta que la interfaz lo recoja (arranque en frío) o se lo avisa con el
//! evento `deep-link`. No interpreta el contenido: la interfaz lo desempaqueta y lo valida.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

const PREFIX: &str = "caesar://share?payload=";
const MAX_LEN: usize = 256 * 1024;

#[derive(Default)]
pub struct DeepLinks(Mutex<Vec<String>>);

/// ¿Es un enlace de Caesar aceptable? Función pura (con tests).
pub(crate) fn accept(url: &str) -> bool {
    url.len() <= MAX_LEN && url.starts_with(PREFIX) && url.len() > PREFIX.len()
}

/// Guarda y anuncia los enlaces válidos; los demás argumentos se ignoran. Enfoca la ventana principal.
pub(crate) fn handle<I: IntoIterator<Item = String>>(app: &AppHandle, urls: I) {
    let valid: Vec<String> = urls.into_iter().filter(|u| accept(u)).collect();
    if valid.is_empty() {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    for u in valid {
        if let Ok(mut g) = app.state::<DeepLinks>().0.lock() {
            g.push(u.clone());
            let n = g.len();
            if n > 5 {
                g.drain(..n - 5);
            }
        }
        let _ = app.emit("deep-link", u);
    }
}

/// La interfaz recoge los enlaces que llegaron antes de estar lista (la app se abrió desde un enlace).
#[tauri::command]
pub fn deeplink_take(state: tauri::State<'_, DeepLinks>) -> Vec<String> {
    state.0.lock().map(|mut g| std::mem::take(&mut *g)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_acepta_enlaces_de_caesar() {
        assert!(accept("caesar://share?payload=eyJ2IjoxfQ"));
        assert!(!accept("caesar://share?payload="));
        assert!(!accept("caesar://otra?payload=abc"));
        assert!(!accept("https://caesar://share?payload=abc"));
        assert!(!accept(&format!("{PREFIX}{}", "a".repeat(MAX_LEN))));
    }
}
