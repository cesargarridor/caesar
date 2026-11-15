//! WebSockets (ws:// y wss://). Rust hace toda la red; la interfaz solo recibe eventos.
//!
//! Comandos: `ws_connect` (handshake + tarea de lectura), `ws_send`, `ws_close`.
//! Eventos: `ws://event` con `{ id, type, ... }` (message | ping | pong | close | error).
//! Mismo stack TLS que reqwest (rustls + ring + webpki-roots).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest,
    http::{HeaderName, HeaderValue},
    protocol::{frame::coding::CloseCode, CloseFrame, WebSocketConfig},
    Message,
};
use tokio_tungstenite::{connect_async_tls_with_config, Connector};
use url::Url;

/// Tamaño máximo de un mensaje (entrante o saliente).
const MAX_MSG_BYTES: usize = 16 * 1024 * 1024;
/// Conexiones simultáneas máximas.
const MAX_CONNECTIONS: usize = 32;
const EVENT: &str = "ws://event";

enum Cmd {
    Send(Message),
    Close(Option<(u16, String)>),
}

struct Handle {
    tx: mpsc::UnboundedSender<Cmd>,
    /// Distingue una conexión de otra con el mismo id (reconexión) al limpiar el estado.
    gen: u64,
}

#[derive(Default)]
pub struct WsState {
    conns: Mutex<HashMap<String, Handle>>,
    next_gen: Mutex<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsSettings {
    #[serde(default)]
    handshake_timeout_secs: u64,
    #[serde(default = "yes")]
    verify_ssl: bool,
    #[serde(default)]
    ping_interval_secs: u64,
}
fn yes() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsConnectArgs {
    id: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    subprotocols: Vec<String>,
    settings: WsSettings,
}

#[derive(Debug, Serialize)]
pub struct WsOpened {
    status: u16,
    headers: Vec<(String, String)>,
    protocol: Option<String>,
}

/// Validación estática de la URL (misma política que validate_url, con ws/wss).
pub fn validate_ws_url(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("La URL está vacía".into());
    }
    let url = Url::parse(raw).map_err(|e| {
        format!("URL inválida ({e}). Si usa variables {{{{var}}}}, defínalas en el panel Variables.")
    })?;
    match url.scheme() {
        "ws" | "wss" => {}
        other => return Err(format!("Esquema no permitido: '{other}' (solo ws/wss)")),
    }
    if url.host_str().map_or(true, str::is_empty) {
        return Err("La URL no tiene host".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Las credenciales embebidas en la URL no están permitidas".into());
    }
    if crate::url_targets_metadata(&url) {
        return Err("Host de metadatos/link-local bloqueado (169.254.0.0/16, metadata.google.internal)".into());
    }
    Ok(url)
}

/// Verificador que acepta cualquier certificado (solo si el usuario desactiva «Verificar SSL»).
#[derive(Debug)]
struct NoVerify(Arc<rustls::crypto::CryptoProvider>);
impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &[rustls::pki_types::CertificateDer<'_>],
        _: &rustls::pki_types::ServerName<'_>,
        _: &[u8],
        _: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        m: &[u8],
        c: &rustls::pki_types::CertificateDer<'_>,
        d: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(
        &self,
        m: &[u8],
        c: &rustls::pki_types::CertificateDer<'_>,
        d: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn tls_connector(verify: bool) -> Result<Connector, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS: {e}"))?;
    let cfg = if verify {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        builder.with_root_certificates(roots).with_no_client_auth()
    } else {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoVerify(provider)))
            .with_no_client_auth()
    };
    Ok(Connector::Rustls(Arc::new(cfg)))
}

fn emit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str, mut payload: serde_json::Value) {
    payload["id"] = json!(id);
    let _ = app.emit(EVENT, payload);
}

/// Cabeceras que gestiona el propio protocolo: no se aceptan del usuario.
fn reserved(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with("sec-websocket-") || n == "upgrade" || n == "connection" || n == "content-length"
}

#[tauri::command]
pub async fn ws_connect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, WsState>,
    args: WsConnectArgs,
) -> Result<WsOpened, String> {
    let url = validate_ws_url(&args.url)?;
    {
        let g = state.conns.lock().map_err(|_| "Estado interno bloqueado")?;
        if g.contains_key(&args.id) {
            return Err("Ya hay una conexión abierta en esta pestaña".into());
        }
        if g.len() >= MAX_CONNECTIONS {
            return Err(format!("Demasiadas conexiones WebSocket abiertas (máximo {MAX_CONNECTIONS})"));
        }
    }
    let mut req = url.as_str().into_client_request().map_err(|e| format!("Petición inválida: {e}"))?;
    for (k, v) in args.headers.iter().filter(|(k, _)| !k.trim().is_empty()) {
        if reserved(k) {
            continue;
        }
        let name = HeaderName::from_bytes(k.trim().as_bytes()).map_err(|_| format!("Nombre de header inválido: '{k}'"))?;
        let value = HeaderValue::from_str(v.trim()).map_err(|_| format!("Valor de header inválido para '{k}'"))?;
        req.headers_mut().append(name, value);
    }
    let protos: Vec<&str> = args.subprotocols.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if !protos.is_empty() {
        let v = HeaderValue::from_str(&protos.join(", ")).map_err(|_| "Subprotocolo inválido".to_string())?;
        req.headers_mut().insert("Sec-WebSocket-Protocol", v);
    }

    let connector = if url.scheme() == "wss" { Some(tls_connector(args.settings.verify_ssl)?) } else { None };
    let cfg = WebSocketConfig::default()
        .max_message_size(Some(MAX_MSG_BYTES))
        .max_frame_size(Some(MAX_MSG_BYTES));
    let secs = if args.settings.handshake_timeout_secs == 0 { 30 } else { args.settings.handshake_timeout_secs.min(120) };
    let timeout = Duration::from_secs(secs);
    let (stream, resp) = tokio::time::timeout(timeout, connect_async_tls_with_config(req, Some(cfg), false, connector))
        .await
        .map_err(|_| format!("Tiempo de espera agotado en el handshake ({secs} s)"))?
        .map_err(|e| format!("No se pudo conectar: {e}"))?;

    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let protocol = resp
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let opened = WsOpened { status: resp.status().as_u16(), headers, protocol };

    let (tx, mut rx) = mpsc::unbounded_channel::<Cmd>();
    let gen = {
        let mut g = state.next_gen.lock().map_err(|_| "Estado interno bloqueado")?;
        *g += 1;
        *g
    };
    state
        .conns
        .lock()
        .map_err(|_| "Estado interno bloqueado")?
        .insert(args.id.clone(), Handle { tx, gen });

    let id = args.id.clone();
    let ping_secs = args.settings.ping_interval_secs;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let (mut sink, mut source) = stream.split();
        let mut ping = tokio::time::interval(Duration::from_secs(ping_secs.max(1)));
        ping.tick().await;
        let mut deadline: Option<tokio::time::Instant> = None;
        let (mut code, mut reason) = (1006u16, String::new());
        loop {
            tokio::select! {
                cmd = rx.recv() => match cmd {
                    None => break,
                    Some(Cmd::Send(m)) => {
                        if let Err(e) = sink.send(m).await {
                            emit(&app2, &id, json!({"type":"error","message": e.to_string()}));
                            break;
                        }
                    }
                    Some(Cmd::Close(c)) => {
                        let frame = c.map(|(c, r)| CloseFrame { code: CloseCode::from(c), reason: r.into() });
                        let _ = sink.send(Message::Close(frame)).await;
                        deadline = Some(tokio::time::Instant::now() + Duration::from_secs(3));
                    }
                },
                msg = source.next() => match msg {
                    None => break,
                    Some(Err(e)) => {
                        emit(&app2, &id, json!({"type":"error","message": e.to_string()}));
                        break;
                    }
                    Some(Ok(m)) => match m {
                        Message::Text(t) => emit(&app2, &id, json!({"type":"message","kind":"text","data": t.as_str(),"size": t.len()})),
                        Message::Binary(b) => emit(&app2, &id, json!({"type":"message","kind":"binary","data": B64.encode(&b),"size": b.len()})),
                        Message::Ping(b) => emit(&app2, &id, json!({"type":"ping","data": B64.encode(&b),"size": b.len()})),
                        Message::Pong(b) => emit(&app2, &id, json!({"type":"pong","data": B64.encode(&b),"size": b.len()})),
                        Message::Close(f) => {
                            if let Some(f) = f { code = u16::from(f.code); reason = f.reason.to_string(); } else { code = 1005; }
                            break;
                        }
                        Message::Frame(_) => {}
                    },
                },
                _ = ping.tick(), if ping_secs > 0 && deadline.is_none() => {
                    if sink.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
                },
                _ = async { match deadline { Some(d) => tokio::time::sleep_until(d).await, None => std::future::pending().await } } => {
                    code = 1000; // el servidor no contestó al cierre: se da por cerrado
                    break;
                }
            }
        }
        let _ = sink.close().await;
        if let Some(st) = app2.try_state::<WsState>() {
            if let Ok(mut g) = st.conns.lock() {
                if g.get(&id).map_or(false, |h| h.gen == gen) {
                    g.remove(&id);
                }
            }
        }
        emit(&app2, &id, json!({"type":"close","code": code,"reason": reason}));
    });
    Ok(opened)
}

#[tauri::command]
pub fn ws_send(state: tauri::State<'_, WsState>, id: String, kind: String, data: String) -> Result<usize, String> {
    if data.len() > MAX_MSG_BYTES + MAX_MSG_BYTES / 3 + 4 {
        return Err("El mensaje supera el límite de 16 MB".into());
    }
    let msg = match kind.as_str() {
        "text" => Message::Text(data.into()),
        "binary" => Message::Binary(B64.decode(data.trim()).map_err(|_| "Base64 inválido".to_string())?.into()),
        "ping" => Message::Ping(B64.decode(data.trim()).map_err(|_| "Base64 inválido".to_string())?.into()),
        other => return Err(format!("Tipo de mensaje no soportado: {other}")),
    };
    let size = match &msg {
        Message::Text(t) => t.len(),
        Message::Binary(b) | Message::Ping(b) => b.len(),
        _ => 0,
    };
    if size > MAX_MSG_BYTES {
        return Err("El mensaje supera el límite de 16 MB".into());
    }
    if kind == "ping" && size > 125 {
        return Err("Un ping admite como máximo 125 bytes".into());
    }
    let g = state.conns.lock().map_err(|_| "Estado interno bloqueado".to_string())?;
    let h = g.get(&id).ok_or("No hay conexión abierta")?;
    h.tx.send(Cmd::Send(msg)).map_err(|_| "La conexión se cerró".to_string())?;
    Ok(size)
}

#[tauri::command]
pub fn ws_close(state: tauri::State<'_, WsState>, id: String, code: Option<u16>, reason: Option<String>) -> Result<(), String> {
    if reason.as_ref().map_or(false, |r| r.len() > 123) {
        return Err("El motivo de cierre admite como máximo 123 bytes".into());
    }
    let g = state.conns.lock().map_err(|_| "Estado interno bloqueado".to_string())?;
    if let Some(h) = g.get(&id) {
        let c = match code {
            // Solo códigos que un cliente puede enviar (1000, 3000-4999)
            Some(c) if c == 1000 || (3000..=4999).contains(&c) => Some((c, reason.unwrap_or_default().chars().take(40).collect())),
            _ => Some((1000, String::new())),
        };
        let _ = h.tx.send(Cmd::Close(c));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_policy() {
        assert!(validate_ws_url("ws://localhost:8080/x").is_ok());
        assert!(validate_ws_url("wss://example.com").is_ok());
        assert!(validate_ws_url("http://example.com").is_err());
        assert!(validate_ws_url("wss://user:pw@example.com").is_err());
        assert!(validate_ws_url("").is_err());
    }

    #[test]
    fn tls_configs_build() {
        assert!(tls_connector(true).is_ok());
        assert!(tls_connector(false).is_ok());
    }

    /// Eco real: servidor tokio-tungstenite local + handshake con cabeceras/subprotocolo y ida y vuelta.
    #[tokio::test]
    async fn echo_roundtrip() {
        use tokio_tungstenite::{accept_hdr_async, tungstenite::handshake::server::{Request, Response}};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (s, _) = l.accept().await.unwrap();
            let mut ws = accept_hdr_async(s, |req: &Request, mut resp: Response| {
                assert_eq!(req.headers().get("x-test").unwrap(), "1");
                resp.headers_mut().insert("sec-websocket-protocol", "chat".parse().unwrap());
                Ok(resp)
            })
            .await
            .unwrap();
            while let Some(Ok(m)) = ws.next().await {
                if m.is_close() { break; }
                if m.is_text() || m.is_binary() { ws.send(m).await.unwrap(); }
            }
        });
        let mut req = format!("ws://127.0.0.1:{port}").into_client_request().unwrap();
        req.headers_mut().insert("x-test", "1".parse().unwrap());
        req.headers_mut().insert("Sec-WebSocket-Protocol", "chat, other".parse().unwrap());
        let (mut c, resp) = connect_async_tls_with_config(req, None, false, None).await.unwrap();
        assert_eq!(resp.status().as_u16(), 101);
        assert_eq!(resp.headers().get("sec-websocket-protocol").unwrap(), "chat");
        c.send(Message::Text("hola".into())).await.unwrap();
        assert_eq!(c.next().await.unwrap().unwrap().into_text().unwrap().as_str(), "hola");
        c.send(Message::Binary(vec![1, 2, 3].into())).await.unwrap();
        assert_eq!(c.next().await.unwrap().unwrap().into_data().as_ref(), &[1, 2, 3]);
        c.close(None).await.unwrap();
    }

    /// Comandos reales (ws_connect / ws_send / ws_close) contra un servidor eco local, con app Tauri simulada.
    #[tokio::test(flavor = "multi_thread")]
    async fn commands_end_to_end() {
        use tauri::Listener;
        use tokio_tungstenite::accept_async;
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (s, _) = l.accept().await.unwrap();
            let mut ws = accept_async(s).await.unwrap();
            while let Some(Ok(m)) = ws.next().await {
                if m.is_close() { break; }
                if m.is_text() || m.is_binary() { ws.send(m).await.unwrap(); }
            }
        });
        let app = tauri::test::mock_app();
        app.manage(WsState::default());
        let events = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let ev = events.clone();
        app.listen(EVENT, move |e| ev.lock().unwrap().push(serde_json::from_str(e.payload()).unwrap()));
        let args: WsConnectArgs = serde_json::from_value(json!({
            "id": "t1", "url": format!("ws://127.0.0.1:{port}/"), "headers": [["X-A", "b"]], "subprotocols": [],
            "settings": {"handshakeTimeoutSecs": 5, "verifySsl": true, "pingIntervalSecs": 0}
        })).unwrap();
        let opened = ws_connect(app.handle().clone(), app.state(), args).await.unwrap();
        assert_eq!(opened.status, 101);
        assert_eq!(ws_send(app.state(), "t1".into(), "text".into(), "hola".into()).unwrap(), 4);
        assert_eq!(ws_send(app.state(), "t1".into(), "binary".into(), "AQID".into()).unwrap(), 3);
        assert!(ws_send(app.state(), "t1".into(), "text".into(), "x".into()).is_ok());
        assert!(ws_send(app.state(), "nope".into(), "text".into(), "x".into()).is_err());
        tokio::time::sleep(Duration::from_millis(300)).await;
        ws_close(app.state(), "t1".into(), Some(1000), Some("bye".into())).unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        let evs = events.lock().unwrap().clone();
        let texts: Vec<_> = evs.iter().filter(|e| e["type"] == "message" && e["kind"] == "text").map(|e| e["data"].as_str().unwrap().to_string()).collect();
        assert_eq!(texts, vec!["hola", "x"]);
        assert!(evs.iter().any(|e| e["type"] == "message" && e["kind"] == "binary" && e["data"] == "AQID"));
        assert!(evs.iter().any(|e| e["type"] == "close"), "{evs:?}");
        assert!(ws_send(app.state(), "t1".into(), "text".into(), "x".into()).is_err(), "la conexión debe quedar limpia");
    }
}
