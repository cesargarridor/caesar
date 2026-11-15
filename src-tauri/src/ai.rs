//! Asistente de IA con tu propia clave (BYOK). La clave de OpenAI o Anthropic vive en el llavero del sistema; las llamadas las
//! hace Rust directamente al proveedor (la interfaz nunca ve la clave ni hace red). Nada pasa por servidores de Caesar y no hay
//! telemetría: solo se envía lo que el usuario pide enviar al pulsar una acción. Los destinos están fijos (no hay URL libre).

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

const SERVICE: &str = "Caesar";
const MAX_PROMPT: usize = 60_000;

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    let p = check_provider(provider)?;
    keyring::Entry::new(SERVICE, &format!("ai-key-{p}")).map_err(|e| format!("Llavero no disponible: {e}"))
}

fn check_provider(p: &str) -> Result<&'static str, String> {
    match p {
        "openai" => Ok("openai"),
        "anthropic" => Ok("anthropic"),
        _ => Err("Proveedor de IA no válido.".into()),
    }
}

fn check_model(m: &str) -> Result<(), String> {
    let ok = !m.is_empty() && m.len() <= 80 && m.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c));
    ok.then_some(()).ok_or_else(|| "Nombre de modelo no válido.".to_string())
}

#[derive(Serialize)]
pub struct AiStatus {
    openai: bool,
    anthropic: bool,
}

#[tauri::command]
pub fn ai_status() -> AiStatus {
    let has = |p: &str| entry(p).ok().and_then(|e| e.get_password().ok()).map(|k| !k.is_empty()).unwrap_or(false);
    AiStatus { openai: has("openai"), anthropic: has("anthropic") }
}

#[tauri::command]
pub fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.len() < 8 || key.len() > 400 || key.chars().any(char::is_whitespace) {
        return Err("La clave no parece válida. Cópiala entera, sin espacios.".into());
    }
    entry(&provider)?.set_password(&key).map_err(|e| format!("No se pudo guardar la clave en el llavero: {e}"))
}

#[tauri::command]
pub fn ai_clear_key(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("No se pudo borrar la clave: {e}")),
    }
}

/// Texto de la respuesta según el proveedor. Función pura (con tests).
pub(crate) fn extract_text(provider: &str, v: &Value) -> Option<String> {
    match provider {
        "openai" => v["choices"][0]["message"]["content"].as_str().map(str::to_string),
        _ => {
            let parts: Vec<&str> = v["content"].as_array()?.iter().filter_map(|c| c["text"].as_str()).collect();
            (!parts.is_empty()).then(|| parts.join(""))
        }
    }
}

fn friendly(status: u16, v: &Value) -> String {
    let detail = v["error"]["message"].as_str().unwrap_or("").chars().take(200).collect::<String>();
    match status {
        401 | 403 => "El proveedor rechazó tu clave. Revísala en Ajustes → IA.".into(),
        404 => format!("Modelo no encontrado. Revisa el nombre del modelo. {detail}"),
        429 => "Has superado el límite o el saldo de tu cuenta del proveedor. Inténtalo más tarde.".into(),
        s => format!("El proveedor devolvió un error ({s}). {detail}"),
    }
}

/// Envía `prompt` al proveedor con la clave guardada y devuelve el texto de la respuesta.
#[tauri::command]
pub async fn ai_chat(provider: String, model: String, system: String, prompt: String) -> Result<String, String> {
    let p = check_provider(&provider)?;
    check_model(&model)?;
    if prompt.trim().is_empty() {
        return Err("Escribe qué quieres pedirle a la IA.".into());
    }
    if prompt.len() > MAX_PROMPT {
        return Err("Lo que intentas enviar es demasiado grande (máximo ~60 KB).".into());
    }
    let key = entry(p)?.get_password().map_err(|_| "Aún no has guardado tu clave de este proveedor (Ajustes → IA).".to_string())?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
    let req = if p == "openai" {
        client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&key)
            .header("content-type", "application/json")
            .body(json!({ "model": model, "messages": [{ "role": "system", "content": system }, { "role": "user", "content": prompt }] }).to_string())
    } else {
        client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .body(json!({ "model": model, "max_tokens": 2048, "system": system, "messages": [{ "role": "user", "content": prompt }] }).to_string())
    };
    let res = req.send().await.map_err(|_| "Sin conexión con el proveedor de IA.".to_string())?;
    let status = res.status().as_u16();
    let v: Value = match res.bytes().await {
        Ok(b) => serde_json::from_slice(&b).unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    if !(200..300).contains(&status) {
        return Err(friendly(status, &v));
    }
    extract_text(p, &v).ok_or_else(|| "El proveedor respondió sin texto.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrae_texto_de_cada_proveedor() {
        let o = json!({ "choices": [{ "message": { "content": "hola" } }] });
        let a = json!({ "content": [{ "type": "text", "text": "ho" }, { "type": "text", "text": "la" }] });
        assert_eq!(extract_text("openai", &o).as_deref(), Some("hola"));
        assert_eq!(extract_text("anthropic", &a).as_deref(), Some("hola"));
        assert_eq!(extract_text("anthropic", &json!({})), None);
    }

    #[test]
    fn valida_proveedor_y_modelo() {
        assert!(check_provider("openai").is_ok() && check_provider("http://evil").is_err());
        assert!(check_model("gpt-4o-mini").is_ok() && check_model("a b").is_err() && check_model("").is_err());
    }
}
