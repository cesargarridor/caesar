//! Servidor Mock local (gratis e ilimitado): sirve las rutas que defines con la respuesta que quieras, sin nube y sin latencia.
//! Es un servidor HTTP/1.1 mínimo sobre `tokio` que solo escucha en 127.0.0.1 (nadie de la red puede entrar). Cada conexión tiene
//! tiempo y tamaño máximos y se cierra tras responder; una petición rara o mal formada recibe un 400, nunca un panic.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const MAX_HEAD: usize = 64 * 1024;
const MAX_BODY: usize = 1024 * 1024;
const MAX_ROUTES: usize = 500;
const MAX_HITS: usize = 100;

#[derive(Debug, Deserialize, Clone)]
pub struct MockRoute {
    pub method: String,
    pub path: String,
    pub status: u16,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: String,
    #[serde(default, rename = "delayMs")]
    pub delay_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct Hit {
    at: i64,
    method: String,
    path: String,
    status: u16,
}

struct Running {
    port: u16,
    stop: tokio::sync::oneshot::Sender<()>,
}

#[derive(Default)]
pub struct MockState {
    running: Mutex<Option<Running>>,
    hits: Arc<Mutex<VecDeque<Hit>>>,
}

#[derive(Serialize)]
pub struct MockStatus {
    running: bool,
    port: u16,
    hits: Vec<Hit>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Segmentos de una ruta sin query ni barra final.
fn segments(path: &str) -> Vec<&str> {
    path.split('?').next().unwrap_or("").split('/').filter(|s| !s.is_empty()).collect()
}

/// Un segmento `{{id}}`, `{id}` o `:id` encaja con cualquier valor.
fn is_param(seg: &str) -> bool {
    (seg.starts_with("{{") && seg.ends_with("}}")) || (seg.starts_with('{') && seg.ends_with('}')) || (seg.starts_with(':') && seg.len() > 1)
}

/// Primera ruta que encaja con el método y el camino pedidos. Función pura (con tests).
pub(crate) fn find_route<'a>(routes: &'a [MockRoute], method: &str, path: &str) -> Option<&'a MockRoute> {
    let want = segments(path);
    routes.iter().find(|r| {
        if !r.method.eq_ignore_ascii_case(method) {
            return false;
        }
        let have = segments(&r.path);
        have.len() == want.len() && have.iter().zip(&want).all(|(h, w)| is_param(h) || h == w)
    })
}

fn clean_header(s: &str) -> bool {
    !s.is_empty() && s.len() <= 200 && !s.contains(['\r', '\n', '\0'])
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

/// Construye la respuesta HTTP completa. Función pura (con tests).
pub(crate) fn build_response(status: u16, headers: &[(String, String)], body: &str, head_only: bool) -> Vec<u8> {
    let status = if (100..600).contains(&status) { status } else { 200 };
    let mut out = format!("HTTP/1.1 {status} {}\r\n", reason(status));
    let has = |n: &str| headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(n));
    for (k, v) in headers {
        if clean_header(k) && clean_header(v) && !k.eq_ignore_ascii_case("content-length") && !k.eq_ignore_ascii_case("connection") {
            out.push_str(&format!("{k}: {v}\r\n"));
        }
    }
    if !has("content-type") {
        let t = body.trim_start();
        out.push_str(if t.starts_with('{') || t.starts_with('[') { "Content-Type: application/json\r\n" } else { "Content-Type: text/plain; charset=utf-8\r\n" });
    }
    if !has("access-control-allow-origin") {
        out.push_str("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Methods: *\r\n");
    }
    out.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()));
    let mut bytes = out.into_bytes();
    if !head_only && status != 204 {
        bytes.extend_from_slice(body.as_bytes());
    }
    bytes
}

/// Lee la cabecera (y descarta el cuerpo). → (método, camino) o None si no es una petición HTTP válida.
async fn read_request(s: &mut TcpStream) -> Option<(String, String)> {
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 4096];
    let end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p + 4;
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
        let n = s.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..end]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next()?.split_whitespace();
    let (method, path) = (first.next()?.to_uppercase(), first.next()?.to_string());
    let len: usize = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse().ok())
        .unwrap_or(0);
    let mut have = buf.len() - end;
    while have < len.min(MAX_BODY) {
        let n = s.read(&mut tmp).await.ok()?;
        if n == 0 {
            break;
        }
        have += n;
    }
    Some((method, path))
}

async fn handle(mut s: TcpStream, routes: Arc<Vec<MockRoute>>, hits: Arc<Mutex<VecDeque<Hit>>>, app: AppHandle) {
    let work = async {
        let Some((method, path)) = read_request(&mut s).await else {
            let _ = s.write_all(&build_response(400, &[], "{\"error\":\"petición no válida\"}", false)).await;
            return;
        };
        let head_only = method == "HEAD";
        let (status, bytes) = if method == "OPTIONS" && find_route(&routes, "OPTIONS", &path).is_none() {
            (204, build_response(204, &[], "", true)) // preflight de CORS
        } else {
            let lookup = if head_only { "GET" } else { method.as_str() };
            match find_route(&routes, lookup, &path) {
                Some(r) => {
                    if r.delay_ms > 0 {
                        tokio::time::sleep(Duration::from_millis(r.delay_ms.min(10_000))).await;
                    }
                    (r.status, build_response(r.status, &r.headers, &r.body, head_only))
                }
                None => (404, build_response(404, &[], &format!("{{\"error\":\"Sin ruta para {method} {}\"}}", path.replace(['"', '\\'], "")), head_only)),
            }
        };
        let _ = s.write_all(&bytes).await;
        let _ = s.shutdown().await;
        let hit = Hit { at: now_ms(), method, path: path.chars().take(300).collect(), status };
        if let Ok(mut g) = hits.lock() {
            g.push_front(hit.clone());
            g.truncate(MAX_HITS);
        }
        let _ = app.emit("mock-hit", hit);
    };
    let _ = tokio::time::timeout(Duration::from_secs(15), work).await;
}

/// Arranca el servidor en 127.0.0.1:`port` (0 = uno libre). Devuelve el puerto real. Si ya había uno, lo reemplaza.
#[tauri::command]
pub async fn mock_start(app: AppHandle, state: tauri::State<'_, MockState>, port: u16, routes: Vec<MockRoute>) -> Result<u16, String> {
    if port != 0 && port < 1024 {
        return Err("Elige un puerto entre 1024 y 65535.".into());
    }
    if routes.is_empty() {
        return Err("No hay rutas que servir: la carpeta no tiene peticiones.".into());
    }
    if routes.len() > MAX_ROUTES {
        return Err(format!("Demasiadas rutas (máximo {MAX_ROUTES})."));
    }
    mock_stop(state.clone());
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::AddrInUse { "Ese puerto ya está en uso. Prueba con otro.".to_string() } else { format!("No se pudo abrir el puerto: {e}") })?;
    let real = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    let routes = Arc::new(routes);
    let hits = state.hits.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => break,
                acc = listener.accept() => {
                    if let Ok((s, _)) = acc {
                        tokio::spawn(handle(s, routes.clone(), hits.clone(), app.clone()));
                    }
                }
            }
        }
    });
    if let Ok(mut g) = state.running.lock() {
        *g = Some(Running { port: real, stop: tx });
    }
    Ok(real)
}

#[tauri::command]
pub fn mock_stop(state: tauri::State<'_, MockState>) {
    if let Ok(mut g) = state.running.lock() {
        if let Some(r) = g.take() {
            let _ = r.stop.send(());
        }
    }
}

#[tauri::command]
pub fn mock_status(state: tauri::State<'_, MockState>) -> MockStatus {
    let port = state.running.lock().ok().and_then(|g| g.as_ref().map(|r| r.port));
    MockStatus { running: port.is_some(), port: port.unwrap_or(0), hits: state.hits.lock().map(|g| g.iter().cloned().collect()).unwrap_or_default() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(m: &str, p: &str, s: u16) -> MockRoute {
        MockRoute { method: m.into(), path: p.into(), status: s, headers: vec![], body: String::new(), delay_ms: 0 }
    }

    #[test]
    fn encaja_rutas_con_parametros() {
        let routes = vec![r("GET", "/items/{{id}}", 200), r("POST", "/items", 201), r("GET", "/users/:id/posts", 200)];
        assert_eq!(find_route(&routes, "get", "/items/42?x=1").map(|x| x.status), Some(200));
        assert_eq!(find_route(&routes, "POST", "/items/").map(|x| x.status), Some(201));
        assert!(find_route(&routes, "GET", "/items").is_none());
        assert!(find_route(&routes, "GET", "/items/1/2").is_none());
        assert!(find_route(&routes, "GET", "/users/7/posts").is_some());
    }

    #[test]
    fn respuesta_bien_formada_y_segura() {
        let h = vec![("X-Ok".to_string(), "1".to_string()), ("Bad".to_string(), "a\r\nInjected: 1".to_string())];
        let out = String::from_utf8(build_response(201, &h, "{\"a\":1}", false)).unwrap();
        assert!(out.starts_with("HTTP/1.1 201 Created\r\n"));
        assert!(out.contains("X-Ok: 1") && !out.contains("Injected"));
        assert!(out.contains("Content-Type: application/json") && out.contains("Content-Length: 7"));
        assert!(out.ends_with("{\"a\":1}"));
        let head = String::from_utf8(build_response(200, &[], "hola", true)).unwrap();
        assert!(head.contains("Content-Length: 4") && !head.ends_with("hola"));
    }

    #[tokio::test]
    async fn sirve_de_verdad_por_tcp() {
        // Servidor mínimo con la misma lógica de lectura/respuesta, sin Tauri.
        let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        let routes = Arc::new(vec![r("GET", "/ping", 200)]);
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let (m, p) = read_request(&mut s).await.unwrap();
            let st = find_route(&routes, &m, &p).map(|x| x.status).unwrap_or(404);
            s.write_all(&build_response(st, &[], "pong", false)).await.unwrap();
        });
        let mut c = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        c.write_all(b"GET /ping HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
        let mut got = String::new();
        c.read_to_string(&mut got).await.unwrap();
        assert!(got.starts_with("HTTP/1.1 200 OK") && got.ends_with("pong"));
    }
}
