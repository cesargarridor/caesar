//! Importador OpenAPI 3.x / Swagger 2.0 → colección de Caesar.
//! Recibe el texto JSON (la interfaz convierte antes un YAML a JSON) y construye carpetas por etiqueta (`tags`) con una petición
//! por operación: URL con `{{baseUrl}}` y las variables de ruta como `{{id}}`, cabeceras, cuerpo de ejemplo generado desde el
//! esquema (con `$ref` locales resueltos y profundidad limitada) y la autenticación declarada. Nada aquí hace `unwrap` sobre datos
//! del archivo: lo que falta o viene raro se salta o se rellena con un valor neutro, y un documento que no es OpenAPI da un error claro.

use serde_json::{Map, Value};

use crate::{AuthData, BodyData, ImportedCollection, Kv, TreeNode};

const MAX_OPERATIONS: usize = 5000;
const MAX_DEPTH: usize = 6;
const METHODS: [&str; 8] = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

fn kv(key: &str, value: &str) -> Kv {
    Kv { key: key.into(), value: value.into(), enabled: true, kind: String::new(), path: String::new(), content_type: String::new() }
}

/// Sigue `$ref` locales (`#/components/...`) hasta 8 saltos; una referencia rota o externa deja el valor tal cual.
fn resolve<'a>(root: &'a Value, mut v: &'a Value) -> &'a Value {
    for _ in 0..8 {
        match v.get("$ref").and_then(Value::as_str) {
            Some(r) if r.starts_with("#/") => match root.pointer(&r[1..]) {
                Some(t) => v = t,
                None => return v,
            },
            _ => return v,
        }
    }
    v
}

/// Valor de ejemplo para un esquema (usa `example`/`default`/`enum` si existen).
fn example(root: &Value, schema: &Value, depth: usize) -> Value {
    if depth > MAX_DEPTH {
        return Value::Null;
    }
    let s = resolve(root, schema);
    for k in ["example", "default"] {
        if let Some(v) = s.get(k) {
            return v.clone();
        }
    }
    if let Some(first) = s.get("enum").and_then(Value::as_array).and_then(|a| a.first()) {
        return first.clone();
    }
    if let Some(all) = s.get("allOf").and_then(Value::as_array) {
        let mut out = Map::new();
        for part in all {
            if let Value::Object(m) = example(root, part, depth + 1) {
                out.extend(m);
            }
        }
        return Value::Object(out);
    }
    for k in ["oneOf", "anyOf"] {
        if let Some(first) = s.get(k).and_then(Value::as_array).and_then(|a| a.first()) {
            return example(root, first, depth + 1);
        }
    }
    let ty = s.get("type").and_then(Value::as_str).unwrap_or(if s.get("properties").is_some() { "object" } else { "" });
    match ty {
        "object" => {
            let mut out = Map::new();
            if let Some(props) = s.get("properties").and_then(Value::as_object) {
                for (k, v) in props.iter().take(60) {
                    out.insert(k.clone(), example(root, v, depth + 1));
                }
            }
            Value::Object(out)
        }
        "array" => match s.get("items") {
            Some(items) => Value::Array(vec![example(root, items, depth + 1)]),
            None => Value::Array(vec![]),
        },
        "integer" | "number" => Value::from(0),
        "boolean" => Value::Bool(false),
        "string" => match s.get("format").and_then(Value::as_str) {
            Some("date-time") => Value::from("2024-01-01T00:00:00Z"),
            Some("date") => Value::from("2024-01-01"),
            Some("uuid") => Value::from("00000000-0000-0000-0000-000000000000"),
            Some("email") => Value::from("user@example.com"),
            _ => Value::from("string"),
        },
        _ => Value::Null,
    }
}

/// Texto para un parámetro de ruta/consulta/cabecera: su ejemplo si lo hay, si no vacío.
fn param_text(root: &Value, p: &Value) -> String {
    let src = p.get("schema").unwrap_or(p);
    let v = p.get("example").cloned().unwrap_or_else(|| example(root, src, 0));
    match v {
        Value::String(s) if s != "string" => s,
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn base_url(root: &Value) -> String {
    if let Some(u) = root.pointer("/servers/0/url").and_then(Value::as_str) {
        let mut url = u.to_string();
        if let Some(vars) = root.pointer("/servers/0/variables").and_then(Value::as_object) {
            for (k, v) in vars {
                if let Some(d) = v.get("default").and_then(Value::as_str) {
                    url = url.replace(&format!("{{{k}}}"), d);
                }
            }
        }
        return url.trim_end_matches('/').to_string();
    }
    if let Some(host) = root.get("host").and_then(Value::as_str) {
        let scheme = root.pointer("/schemes/0").and_then(Value::as_str).unwrap_or("https");
        let bp = root.get("basePath").and_then(Value::as_str).unwrap_or("");
        return format!("{scheme}://{host}{}", bp.trim_end_matches('/'));
    }
    "http://localhost".into()
}

/// `/pets/{id}` → `/pets/{{id}}` (formato de variables de Caesar).
fn path_to_vars(path: &str) -> (String, Vec<String>) {
    let mut out = String::new();
    let mut names = Vec::new();
    let mut cur: Option<String> = None;
    for c in path.chars() {
        match (c, cur.as_mut()) {
            ('{', None) => cur = Some(String::new()),
            ('}', Some(_)) => {
                let n = cur.take().unwrap_or_default();
                out.push_str(&format!("{{{{{n}}}}}"));
                names.push(n);
            }
            (_, Some(n)) => n.push(c),
            _ => out.push(c),
        }
    }
    if let Some(n) = cur {
        out.push('{');
        out.push_str(&n); // llave sin cerrar: se deja como estaba
    }
    (out, names)
}

fn none_auth() -> AuthData {
    AuthData { kind: "none".into(), location: "header".into(), ..Default::default() }
}

/// Autenticación de una operación a partir de `security` y de los esquemas declarados. Añade las variables que usa.
fn auth_for(root: &Value, op: &Value, vars: &mut Vec<Kv>) -> AuthData {
    let req = op.get("security").or_else(|| root.get("security")).and_then(Value::as_array).and_then(|a| a.first());
    let Some(name) = req.and_then(Value::as_object).and_then(|o| o.keys().next()) else { return none_auth() };
    let scheme = root
        .pointer(&format!("/components/securitySchemes/{name}"))
        .or_else(|| root.pointer(&format!("/securityDefinitions/{name}")))
        .map(|s| resolve(root, s));
    let Some(s) = scheme else { return none_auth() };
    let ty = s.get("type").and_then(Value::as_str).unwrap_or("");
    let sch = s.get("scheme").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let mut add = |k: &str| {
        if !vars.iter().any(|v| v.key == k) {
            vars.push(kv(k, ""));
        }
    };
    match (ty, sch.as_str()) {
        ("http", "bearer") | ("oauth2", _) | ("openIdConnect", _) => {
            add("token");
            AuthData { kind: "bearer".into(), token: "{{token}}".into(), location: "header".into(), ..Default::default() }
        }
        ("http", "basic") | ("basic", _) => {
            add("username");
            add("password");
            AuthData { kind: "basic".into(), username: "{{username}}".into(), password: "{{password}}".into(), location: "header".into(), ..Default::default() }
        }
        ("apiKey", _) => {
            add("apiKey");
            let loc = if s.get("in").and_then(Value::as_str) == Some("query") { "query" } else { "header" };
            AuthData { kind: "apikey".into(), key: s.get("name").and_then(Value::as_str).unwrap_or("X-API-Key").into(), value: "{{apiKey}}".into(), location: loc.into(), ..Default::default() }
        }
        _ => none_auth(),
    }
}

fn body_for(root: &Value, op: &Value, params: &[Value]) -> BodyData {
    // OpenAPI 3: requestBody.content
    if let Some(content) = op.get("requestBody").map(|b| resolve(root, b)).and_then(|b| b.get("content")).and_then(Value::as_object) {
        let pick = content
            .iter()
            .find(|(k, _)| k.contains("json"))
            .or_else(|| content.iter().find(|(k, _)| k.contains("x-www-form-urlencoded")))
            .or_else(|| content.iter().find(|(k, _)| k.contains("multipart")))
            .or_else(|| content.iter().next());
        if let Some((mime, media)) = pick {
            let schema = media.get("schema").cloned().unwrap_or(Value::Null);
            let ex = media.get("example").cloned().unwrap_or_else(|| example(root, &schema, 0));
            if mime.contains("json") {
                return BodyData { mode: "json".into(), raw: serde_json::to_string_pretty(&ex).unwrap_or_default(), ..Default::default() };
            }
            if mime.contains("x-www-form-urlencoded") || mime.contains("multipart") {
                let fields = form_fields(&ex);
                return if mime.contains("multipart") {
                    BodyData { mode: "formdata".into(), formdata: fields, ..Default::default() }
                } else {
                    BodyData { mode: "urlencoded".into(), urlencoded: fields, ..Default::default() }
                };
            }
            let text = match ex {
                Value::String(s) => s,
                Value::Null => String::new(),
                other => other.to_string(),
            };
            return BodyData { mode: "text".into(), raw: text, ..Default::default() };
        }
    }
    // Swagger 2: parámetros `in: body` / `in: formData`
    if let Some(p) = params.iter().find(|p| p.get("in").and_then(Value::as_str) == Some("body")) {
        let ex = example(root, p.get("schema").unwrap_or(&Value::Null), 0);
        return BodyData { mode: "json".into(), raw: serde_json::to_string_pretty(&ex).unwrap_or_default(), ..Default::default() };
    }
    let form: Vec<Kv> = params
        .iter()
        .filter(|p| p.get("in").and_then(Value::as_str) == Some("formData"))
        .map(|p| kv(p.get("name").and_then(Value::as_str).unwrap_or(""), &param_text(root, p)))
        .collect();
    if !form.is_empty() {
        return BodyData { mode: "urlencoded".into(), urlencoded: form, ..Default::default() };
    }
    BodyData { mode: "none".into(), ..Default::default() }
}

fn form_fields(ex: &Value) -> Vec<Kv> {
    ex.as_object()
        .map(|o| {
            o.iter()
                .map(|(k, v)| {
                    let t = match v {
                        Value::String(s) => s.clone(),
                        Value::Null | Value::Object(_) | Value::Array(_) => String::new(),
                        other => other.to_string(),
                    };
                    kv(k, &t)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parámetros efectivos: los de la ruta, y los de la operación pisan a los de la ruta con el mismo nombre y ubicación.
fn merged_params(root: &Value, item: &Value, op: &Value) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for list in [item.get("parameters"), op.get("parameters")].into_iter().flatten().filter_map(Value::as_array) {
        for p in list {
            let p = resolve(root, p).clone();
            let (n, i) = (p.get("name").cloned(), p.get("in").cloned());
            out.retain(|q| q.get("name").cloned() != n || q.get("in").cloned() != i);
            out.push(p);
        }
    }
    out
}

pub(crate) fn convert(content: &str) -> Result<ImportedCollection, String> {
    let root: Value = serde_json::from_str(content).map_err(|e| format!("El archivo no es un JSON válido: {e}"))?;
    let is3 = root.get("openapi").and_then(Value::as_str).map(|v| v.starts_with('3')).unwrap_or(false);
    let is2 = root.get("swagger").and_then(Value::as_str).map(|v| v.starts_with('2')).unwrap_or(false);
    if !is3 && !is2 {
        return Err("El archivo no parece un OpenAPI/Swagger: falta «openapi» (3.x) o «swagger» (2.0).".into());
    }
    let paths = root.get("paths").and_then(Value::as_object).ok_or("El documento OpenAPI no tiene «paths».")?;

    let mut vars: Vec<Kv> = vec![kv("baseUrl", &base_url(&root))];
    let mut groups: Vec<(String, Vec<TreeNode>)> = Vec::new();
    let mut any_tag = false;
    let mut count = 0usize;

    'outer: for (path, item) in paths {
        let item = resolve(&root, item);
        if !item.is_object() {
            continue;
        }
        for m in METHODS {
            let Some(op) = item.get(m).filter(|o| o.is_object()) else { continue };
            count += 1;
            if count > MAX_OPERATIONS {
                break 'outer;
            }
            let params = merged_params(&root, item, op);
            let (url_path, names) = path_to_vars(path);
            for n in names {
                if !n.is_empty() && !vars.iter().any(|v| v.key == n) {
                    let sample = params.iter().find(|p| p.get("name").and_then(Value::as_str) == Some(n.as_str())).map(|p| param_text(&root, p)).unwrap_or_default();
                    vars.push(kv(&n, &sample));
                }
            }
            let mut url = format!("{{{{baseUrl}}}}{url_path}");
            let query: Vec<String> = params
                .iter()
                .filter(|p| p.get("in").and_then(Value::as_str) == Some("query") && p.get("required").and_then(Value::as_bool) == Some(true))
                .filter_map(|p| p.get("name").and_then(Value::as_str).map(|n| format!("{n}={}", param_text(&root, p))))
                .collect();
            if !query.is_empty() {
                url.push('?');
                url.push_str(&query.join("&"));
            }
            let headers: Vec<Kv> = params
                .iter()
                .filter(|p| p.get("in").and_then(Value::as_str) == Some("header"))
                .filter_map(|p| p.get("name").and_then(Value::as_str).map(|n| (n, param_text(&root, p))))
                .filter(|(n, _)| !["authorization", "content-type", "accept"].contains(&n.to_lowercase().as_str()))
                .map(|(n, v)| kv(n, &v))
                .collect();
            let name: String = op
                .get("summary")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .or_else(|| op.get("operationId").and_then(Value::as_str))
                .map(str::to_string)
                .unwrap_or_else(|| format!("{} {path}", m.to_uppercase()))
                .chars()
                .take(120)
                .collect();
            let node = TreeNode::Request {
                name,
                method: m.to_uppercase(),
                url,
                headers,
                body: body_for(&root, op, &params),
                auth: auth_for(&root, op, &mut vars),
                tests: String::new(),
            };
            let tag = op.get("tags").and_then(Value::as_array).and_then(|t| t.first()).and_then(Value::as_str).map(str::to_string);
            any_tag |= tag.is_some();
            let tag = tag.unwrap_or_else(|| "Sin etiqueta".into());
            match groups.iter_mut().find(|(t, _)| *t == tag) {
                Some((_, v)) => v.push(node),
                None => groups.push((tag, vec![node])),
            }
        }
    }
    if count == 0 {
        return Err("El documento OpenAPI no tiene ninguna operación (get, post…) en «paths».".into());
    }
    let children: Vec<TreeNode> = if any_tag {
        groups.into_iter().map(|(name, children)| TreeNode::Folder { name, children }).collect()
    } else {
        groups.into_iter().flat_map(|(_, v)| v).collect()
    };
    let title = root.pointer("/info/title").and_then(Value::as_str).filter(|t| !t.trim().is_empty()).unwrap_or("API OpenAPI");
    Ok(ImportedCollection { root: TreeNode::Folder { name: title.chars().take(120).collect(), children }, variables: vars })
}

/// Convierte el texto de un OpenAPI/Swagger (JSON) en una colección. Errores en español, nunca un panic.
#[tauri::command]
pub(crate) fn import_openapi(content: String) -> Result<ImportedCollection, String> {
    if content.len() > 50 * 1024 * 1024 {
        return Err("El archivo supera el límite de 50 MB.".into());
    }
    convert(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: &str = r##"{
      "openapi": "3.0.0", "info": { "title": "Tienda" },
      "servers": [{ "url": "https://api.tienda.com/v1/" }],
      "security": [{ "bearer": [] }],
      "components": {
        "securitySchemes": { "bearer": { "type": "http", "scheme": "bearer" } },
        "schemas": { "Item": { "type": "object", "properties": { "id": { "type": "integer" }, "name": { "type": "string" }, "padre": { "$ref": "#/components/schemas/Item" } } } }
      },
      "paths": {
        "/items/{id}": {
          "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } }],
          "get": { "tags": ["items"], "summary": "Ver item", "parameters": [{ "name": "q", "in": "query", "required": true, "schema": { "type": "string" } }] },
          "put": { "tags": ["items"], "operationId": "putItem", "security": [],
                   "requestBody": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Item" } } } } }
        }
      }
    }"##;

    #[test]
    fn convierte_carpetas_urls_cuerpo_y_auth() {
        let c = convert(SPEC).unwrap();
        let TreeNode::Folder { name, children } = &c.root else { panic!("raíz") };
        assert_eq!(name, "Tienda");
        let TreeNode::Folder { name: tag, children: reqs } = &children[0] else { panic!("carpeta") };
        assert_eq!(tag, "items");
        let TreeNode::Request { url, auth, method, .. } = &reqs[0] else { panic!("req") };
        assert_eq!(method, "GET");
        assert_eq!(url, "{{baseUrl}}/items/{{id}}?q=");
        assert_eq!(auth.kind, "bearer");
        let TreeNode::Request { name, body, auth, .. } = &reqs[1] else { panic!("req") };
        assert_eq!(name, "putItem");
        assert_eq!(auth.kind, "none");
        assert_eq!(body.mode, "json");
        assert!(body.raw.contains("\"id\": 0")); // $ref recursivo cortado sin colgarse
        assert_eq!(c.variables[0].value, "https://api.tienda.com/v1");
        assert!(c.variables.iter().any(|v| v.key == "id") && c.variables.iter().any(|v| v.key == "token"));
    }

    #[test]
    fn swagger2() {
        let s = r#"{"swagger":"2.0","info":{"title":"Vieja"},"host":"x.com","basePath":"/api","schemes":["http"],
          "paths":{"/a":{"post":{"parameters":[{"in":"body","name":"b","schema":{"type":"object","properties":{"n":{"type":"string"}}}}]}}}}"#;
        let c = convert(s).unwrap();
        assert_eq!(c.variables[0].value, "http://x.com/api");
        let TreeNode::Folder { children, .. } = &c.root else { panic!() };
        let TreeNode::Request { body, name, .. } = &children[0] else { panic!() };
        assert_eq!(name, "POST /a");
        assert!(body.raw.contains("\"n\""));
    }

    #[test]
    fn errores_claros_sin_panic() {
        assert!(convert("no es json").is_err());
        assert!(convert("{\"foo\":1}").unwrap_err().contains("OpenAPI"));
        assert!(convert("{\"openapi\":\"3.0.0\"}").is_err());
        assert!(convert("{\"openapi\":\"3.0.0\",\"paths\":{}}").is_err());
        assert!(convert("{\"openapi\":\"3.0.0\",\"paths\":{\"/a\":5,\"/b\":{\"get\":7}}}").is_err());
        assert!(convert("{\"openapi\":\"3.0.0\",\"paths\":{\"/a/{x\":{\"get\":{}}}}").is_ok());
    }

    /// Documento tipo «petstore» con las rarezas habituales: parámetros por `$ref`, allOf/oneOf, multipart, apiKey en query, sin etiquetas.
    #[test]
    fn documento_realista_con_rarezas() {
        let spec = r##"{
          "openapi": "3.0.3", "info": { "title": "Pet Store" },
          "servers": [{ "url": "https://{env}.pets.io/v2", "variables": { "env": { "default": "api" } } }],
          "components": {
            "securitySchemes": { "key": { "type": "apiKey", "in": "query", "name": "api_key" } },
            "parameters": { "Limit": { "name": "limit", "in": "query", "required": true, "schema": { "type": "integer", "default": 20 } } },
            "schemas": {
              "Base": { "type": "object", "properties": { "id": { "type": "string", "format": "uuid" } } },
              "Pet": { "allOf": [ { "$ref": "#/components/schemas/Base" }, { "type": "object", "properties": { "name": { "type": "string" }, "kind": { "oneOf": [ { "type": "string", "enum": ["dog", "cat"] }, { "type": "integer" } ] }, "born": { "type": "string", "format": "date" } } } ] }
            }
          },
          "security": [ { "key": [] } ],
          "paths": {
            "/pets": {
              "get": { "operationId": "listPets", "parameters": [ { "$ref": "#/components/parameters/Limit" }, { "name": "X-Trace", "in": "header", "schema": { "type": "string" } }, { "name": "Authorization", "in": "header", "schema": { "type": "string" } } ] },
              "post": { "summary": "Crear", "requestBody": { "required": true, "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Pet" } } } } }
            },
            "/pets/{petId}/photo": {
              "post": { "requestBody": { "content": { "multipart/form-data": { "schema": { "type": "object", "properties": { "file": { "type": "string", "format": "binary" }, "caption": { "type": "string", "example": "hola" } } } } } } }
            },
            "/login": { "post": { "requestBody": { "content": { "application/x-www-form-urlencoded": { "schema": { "type": "object", "properties": { "user": { "type": "string" } } } } } } } }
          }
        }"##;
        let c = convert(spec).unwrap();
        assert_eq!(c.variables[0].value, "https://api.pets.io/v2");
        let TreeNode::Folder { children, .. } = &c.root else { panic!() };
        assert_eq!(children.len(), 4, "sin etiquetas: peticiones directas en la raíz");
        let req = |i: usize| match &children[i] {
            TreeNode::Request { name, method, url, headers, body, auth, .. } => (name.clone(), method.clone(), url.clone(), headers.len(), body.clone(), auth.kind.clone(), auth.location.clone()),
            _ => panic!("no es petición"),
        };
        let (n, m, url, h, _, auth, loc) = req(0);
        assert_eq!((n.as_str(), m.as_str(), url.as_str()), ("listPets", "GET", "{{baseUrl}}/pets?limit=20"));
        assert_eq!(h, 1, "Authorization se omite, X-Trace se queda");
        assert_eq!((auth.as_str(), loc.as_str()), ("apikey", "query"));
        let (n, _, _, _, body, ..) = req(1);
        assert_eq!(n, "Crear");
        let v: serde_json::Value = serde_json::from_str(&body.raw).unwrap();
        assert!(v["id"].is_string() && v["name"] == "string" && v["kind"] == "dog" && v["born"] == "2024-01-01", "allOf + oneOf + enum: {v}");
        let (_, _, url, _, body, ..) = req(2);
        assert_eq!(url, "{{baseUrl}}/pets/{{petId}}/photo");
        assert_eq!(body.mode, "formdata");
        assert!(body.formdata.iter().any(|k| k.key == "caption" && k.value == "hola"));
        assert_eq!(req(3).4.mode, "urlencoded");
        assert!(c.variables.iter().any(|v| v.key == "petId") && c.variables.iter().any(|v| v.key == "apiKey"));
    }
}
