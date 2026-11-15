//! OAuth 2.0 en una ventana WebView embebida: sin navegador externo y sin servidor local.
//!
//! `oauth_authorize` abre una ventana hija con la URL de autorización. Cuando el proveedor redirige a la `redirect_uri`, el
//! interceptor de navegación del WebView (`on_navigation`) lo detecta ANTES de cargar la página, cancela la navegación, cierra la
//! ventana y devuelve el `code` (flujo de código con PKCE) o el `access_token` (flujo implícito). Funciona igual en Windows
//! (WebView2), macOS (WKWebView) y Linux (WebKitGTK) porque usa la API de Tauri/WRY, no sockets. La ventana externa no recibe ningún
//! permiso de Caesar (la capacidad solo cubre la ventana `main`), así que la web del proveedor no puede invocar comandos.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use url::Url;

static COUNTER: AtomicU32 = AtomicU32::new(0);
const TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Serialize, Default, Clone, PartialEq)]
pub struct OAuthResult {
    pub code: Option<String>,
    pub state: Option<String>,
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub expires_in: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

/// Las URL de autorización deben ser https (o http solo hacia localhost, para pruebas).
pub(crate) fn check_url(raw: &str, what: &str) -> Result<Url, String> {
    let u = Url::parse(raw.trim()).map_err(|_| format!("{what} no es una URL válida."))?;
    let local = matches!(u.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"));
    match u.scheme() {
        "https" => Ok(u),
        "http" if local => Ok(u),
        _ => Err(format!("{what} debe empezar por https:// (http:// solo con localhost).")),
    }
}

/// ¿Esta navegación es la redirección final? Mismo origen y la ruta empieza por la de `redirect`.
pub(crate) fn is_redirect(nav: &Url, redirect: &Url) -> bool {
    nav.scheme() == redirect.scheme()
        && nav.host_str() == redirect.host_str()
        && nav.port_or_known_default() == redirect.port_or_known_default()
        && nav.path().starts_with(redirect.path().trim_end_matches('/'))
}

/// Saca los parámetros de la redirección (query y fragmento). Función pura (con tests).
pub(crate) fn parse_redirect(nav: &Url) -> OAuthResult {
    let mut r = OAuthResult::default();
    let frag = nav.fragment().unwrap_or("");
    let pairs = nav.query_pairs().chain(url::form_urlencoded::parse(frag.as_bytes()));
    for (k, v) in pairs {
        let v = v.into_owned();
        match k.as_ref() {
            "code" => r.code = Some(v),
            "state" => r.state = Some(v),
            "access_token" => r.access_token = Some(v),
            "token_type" => r.token_type = Some(v),
            "expires_in" => r.expires_in = Some(v),
            "error" => r.error = Some(v),
            "error_description" => r.error_description = Some(v),
            _ => {}
        }
    }
    r
}

/// Abre la ventana de inicio de sesión y espera la redirección. Cancelar (cerrar la ventana) o pasar 5 min da un error claro.
#[tauri::command]
pub async fn oauth_authorize(app: AppHandle, url: String, redirect_uri: String) -> Result<OAuthResult, String> {
    let auth = check_url(&url, "La URL de autorización")?;
    let redirect = Url::parse(redirect_uri.trim()).map_err(|_| "La Redirect URI no es una URL válida.".to_string())?;
    if !matches!(redirect.scheme(), "http" | "https") {
        return Err("La Redirect URI debe ser http:// o https://.".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<OAuthResult, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let send = {
        let tx = tx.clone();
        move |r: Result<OAuthResult, String>| {
            if let Some(t) = tx.lock().ok().and_then(|mut g| g.take()) {
                let _ = t.send(r);
            }
        }
    };
    let label = format!("oauth-{}", COUNTER.fetch_add(1, Ordering::SeqCst));
    let nav_send = send.clone();
    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(auth))
        .title("Caesar · Iniciar sesión")
        .inner_size(520.0, 720.0)
        .center()
        .on_navigation(move |nav| {
            if is_redirect(nav, &redirect) {
                nav_send(Ok(parse_redirect(nav)));
                return false; // no se carga la página de destino: ya tenemos lo que hacía falta
            }
            true
        })
        .build()
        .map_err(|e| format!("No se pudo abrir la ventana de inicio de sesión: {e}"))?;
    let close_send = send.clone();
    win.on_window_event(move |e| {
        if matches!(e, WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
            close_send(Err("Has cerrado la ventana de inicio de sesión.".into()));
        }
    });
    let res = tokio::time::timeout(TIMEOUT, rx).await;
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
    }
    match res {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("Se canceló el inicio de sesión.".into()),
        Err(_) => Err("Se agotó el tiempo (5 min) sin completar el inicio de sesión.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn valida_urls() {
        assert!(check_url("https://idp.com/auth?x=1", "a").is_ok());
        assert!(check_url("http://localhost:3000/auth", "a").is_ok());
        assert!(check_url("http://idp.com/auth", "a").is_err());
        assert!(check_url("javascript:alert(1)", "a").is_err());
        assert!(check_url("file:///etc/passwd", "a").is_err());
        assert!(check_url("no es url", "a").is_err());
    }

    #[test]
    fn detecta_la_redireccion() {
        let r = u("http://localhost/callback");
        assert!(is_redirect(&u("http://localhost/callback?code=1"), &r));
        assert!(is_redirect(&u("http://localhost/callback#access_token=x"), &r));
        assert!(!is_redirect(&u("http://localhost/otra"), &r));
        assert!(!is_redirect(&u("https://localhost/callback"), &r));
        assert!(!is_redirect(&u("http://evil.com/callback"), &r));
        assert!(!is_redirect(&u("http://localhost:8080/callback"), &r));
    }

    #[test]
    fn lee_codigo_token_y_errores() {
        let c = parse_redirect(&u("http://localhost/callback?code=abc&state=xyz"));
        assert_eq!((c.code.as_deref(), c.state.as_deref()), (Some("abc"), Some("xyz")));
        let t = parse_redirect(&u("http://localhost/callback#access_token=tok&token_type=bearer&expires_in=3600"));
        assert_eq!((t.access_token.as_deref(), t.expires_in.as_deref()), (Some("tok"), Some("3600")));
        let e = parse_redirect(&u("http://localhost/callback?error=access_denied&error_description=No%20quiero"));
        assert_eq!((e.error.as_deref(), e.error_description.as_deref()), (Some("access_denied"), Some("No quiero")));
    }
}
