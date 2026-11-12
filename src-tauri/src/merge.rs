//! Fusión de dos instantáneas de datos (local y remota) con «gana la última edición» por elemento.
//!
//! Instantánea: `{ v: 2|3, workspaces: [{id,name,updatedAt?,collections,vars}], collections, vars, tombstones?: [{id,at}] }`.
//! Cada nodo (petición o carpeta) se identifica por `id` (carpetas: `uid`). Los nodos antiguos sin id reciben uno
//! DETERMINISTA (hash de ruta + nombre + método): dos equipos calculan el mismo id, así que no se duplican.
//! La función es conmutativa e idempotente para que dos equipos converjan sin rebotes de subidas.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// Las lápidas (borrados) se purgan pasados 90 días.
const TOMB_TTL_MS: i64 = 90 * 24 * 3600 * 1000;
const DEFAULT_WS: &str = "default";

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn upd(v: &Value) -> i64 {
    match v.get("updatedAt") {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0),
        _ => 0,
    }
}

fn str_of<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(|x| x.as_str()).filter(|s| !s.is_empty())
}

fn hash_id(parts: &[&str]) -> String {
    let h = Sha256::digest(parts.join("\u{1f}").as_bytes());
    let hex: String = h.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("h{hex}")
}

/// Id de cada nodo de una lista (explícito o calculado), único dentro de la lista.
fn ids_of(list: &[Value], path: &str) -> Vec<String> {
    let mut seen: HashMap<String, u32> = HashMap::new();
    list.iter()
        .map(|n| {
            let base = str_of(n, "id").or_else(|| str_of(n, "uid")).map(str::to_string).unwrap_or_else(|| {
                hash_id(&[path, str_of(n, "type").unwrap_or(""), str_of(n, "name").unwrap_or(""), str_of(n, "method").unwrap_or("")])
            });
            let c = seen.entry(base.clone()).or_insert(0);
            let id = if *c == 0 { base } else { format!("{base}~{c}") };
            *c += 1;
            id
        })
        .collect()
}

fn is_folder(v: &Value) -> bool {
    str_of(v, "type") == Some("folder")
}

/// Escribe el id en el nodo (carpetas: `uid`; peticiones: `id`).
fn stamp(node: &mut Value, id: &str) {
    if let Some(o) = node.as_object_mut() {
        if o.get("type").and_then(|t| t.as_str()) == Some("folder") {
            if o.get("uid").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).is_none() {
                o.insert("uid".into(), json!(id));
            }
        } else if o.get("id").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).is_none() {
            o.insert("id".into(), json!(id));
        }
    }
}

/// Elige ganador de forma simétrica: mayor `updatedAt`; si empatan, el de texto mayor (igual en ambos equipos).
fn local_wins(l: &Value, r: &Value) -> bool {
    let (a, b) = (upd(l), upd(r));
    if a != b {
        return a > b;
    }
    l.to_string() >= r.to_string()
}

type Tombs = HashMap<String, i64>;

fn dead(tombs: &Tombs, id: &str, node: &Value) -> bool {
    tombs.get(id).map(|at| *at >= upd(node)).unwrap_or(false)
}

fn merge_list(local: &[Value], remote: &[Value], path: &str, local_first: bool, tombs: &Tombs) -> Vec<Value> {
    let lids = ids_of(local, path);
    let rids = ids_of(remote, path);
    let rmap: HashMap<&str, usize> = rids.iter().enumerate().map(|(i, s)| (s.as_str(), i)).collect();
    let lmap: HashMap<&str, usize> = lids.iter().enumerate().map(|(i, s)| (s.as_str(), i)).collect();

    let (fids, sids) = if local_first { (&lids, &rids) } else { (&rids, &lids) };
    let mut out: Vec<Value> = Vec::new();
    let mut done: HashSet<&str> = HashSet::new();
    for id in fids.iter().chain(sids.iter()) {
        if !done.insert(id.as_str()) {
            continue;
        }
        let (l, r) = (lmap.get(id.as_str()).map(|&k| &local[k]), rmap.get(id.as_str()).map(|&k| &remote[k]));
        let mut node = match (l, r) {
            (Some(l), Some(r)) => merge_node(l, r, id, path, tombs),
            (Some(n), None) | (None, Some(n)) => {
                let mut n = n.clone();
                if is_folder(&n) {
                    // Normaliza también los hijos (ids estables).
                    let name = str_of(&n, "name").unwrap_or("").to_string();
                    let kids: Vec<Value> = n.get("children").and_then(|c| c.as_array()).cloned().unwrap_or_default();
                    let merged = merge_list(&kids, &[], &format!("{path}/{name}"), true, tombs);
                    if let Some(o) = n.as_object_mut() {
                        o.insert("children".into(), Value::Array(merged));
                    }
                }
                n
            }
            (None, None) => continue,
        };
        if dead(tombs, id, &node) {
            continue;
        }
        stamp(&mut node, id);
        out.push(node);
    }
    out
}

fn merge_node(l: &Value, r: &Value, _id: &str, path: &str, tombs: &Tombs) -> Value {
    let lw = local_wins(l, r);
    let mut win = if lw { l.clone() } else { r.clone() };
    if is_folder(l) && is_folder(r) {
        let name = str_of(&win, "name").unwrap_or("").to_string();
        let empty = Vec::new();
        let lc = l.get("children").and_then(|c| c.as_array()).unwrap_or(&empty);
        let rc = r.get("children").and_then(|c| c.as_array()).unwrap_or(&empty);
        let kids = merge_list(lc, rc, &format!("{path}/{name}"), lw, tombs);
        if let Some(o) = win.as_object_mut() {
            o.insert("children".into(), Value::Array(kids));
        }
    }
    win
}

fn tombstones(local: &Value, remote: &Value, now: i64) -> Tombs {
    let mut m = Tombs::new();
    for side in [local, remote] {
        for t in side.get("tombstones").and_then(|t| t.as_array()).into_iter().flatten() {
            if let (Some(id), Some(at)) = (str_of(t, "id"), t.get("at").and_then(|a| a.as_i64())) {
                let e = m.entry(id.to_string()).or_insert(at);
                *e = (*e).max(at);
            }
        }
    }
    m.retain(|_, at| *at >= now - TOMB_TTL_MS);
    m
}

/// Espacios de la instantánea; el formato antiguo (solo `collections`/`vars`) se trata como el espacio principal.
fn workspaces_of(s: &Value) -> Vec<Value> {
    match s.get("workspaces").and_then(|w| w.as_array()) {
        Some(a) if !a.is_empty() => a.iter().filter(|w| str_of(w, "id").is_some()).cloned().collect(),
        _ => vec![json!({
            "id": DEFAULT_WS,
            "name": "Personal",
            "collections": s.get("collections").cloned().unwrap_or_else(|| json!([])),
            "vars": s.get("vars").cloned().unwrap_or_else(|| json!([])),
        })],
    }
}

fn arr<'a>(v: &'a Value, k: &str) -> &'a [Value] {
    v.get(k).and_then(|c| c.as_array()).map(|a| a.as_slice()).unwrap_or(&[])
}

fn merge_ws(l: &Value, r: &Value, tombs: &Tombs) -> Value {
    let lw = local_wins(l, r);
    let mut win = if lw { l.clone() } else { r.clone() };
    let cols = merge_list(arr(l, "collections"), arr(r, "collections"), "", lw, tombs);
    if let Some(o) = win.as_object_mut() {
        o.insert("collections".into(), Value::Array(cols));
        if !o.contains_key("vars") {
            o.insert("vars".into(), json!([]));
        }
        let m = upd(l).max(upd(r));
        if m > 0 {
            o.insert("updatedAt".into(), json!(m));
        }
    }
    win
}

/// Fusiona `local` y `remote`. Si alguno no es un objeto válido devuelve el otro.
pub fn merge_snapshots(local: &Value, remote: &Value) -> Value {
    merge_snapshots_at(local, remote, now_ms())
}

pub fn merge_snapshots_at(local: &Value, remote: &Value, now: i64) -> Value {
    if !remote.is_object() {
        return local.clone();
    }
    if !local.is_object() {
        return remote.clone();
    }
    let tombs = tombstones(local, remote, now);
    let (lws, rws) = (workspaces_of(local), workspaces_of(remote));
    let lm: HashMap<&str, &Value> = lws.iter().filter_map(|w| str_of(w, "id").map(|i| (i, w))).collect();
    let rm: HashMap<&str, &Value> = rws.iter().filter_map(|w| str_of(w, "id").map(|i| (i, w))).collect();
    let mut ids: Vec<&str> = lm.keys().chain(rm.keys()).copied().collect::<HashSet<_>>().into_iter().collect();
    // Orden determinista (el mismo en todos los equipos): el principal primero, luego por id.
    ids.sort_by(|a, b| (*a != DEFAULT_WS, *a).cmp(&(*b != DEFAULT_WS, *b)));
    let mut workspaces: Vec<Value> = Vec::new();
    for id in ids {
        let w = match (lm.get(id), rm.get(id)) {
            (Some(l), Some(r)) => merge_ws(l, r, &tombs),
            (Some(w), None) | (None, Some(w)) => merge_ws(w, &json!({ "id": id, "collections": [], "vars": [] }), &tombs),
            _ => continue,
        };
        if tombs.get(id).map(|at| *at >= upd(&w)).unwrap_or(false) {
            continue;
        }
        workspaces.push(w);
    }

    let mut out: Map<String, Value> = Map::new();
    let (lo, ro) = (local.as_object().unwrap(), remote.as_object().unwrap());
    let first_local = local_wins(local, remote);
    let (a, b) = if first_local { (lo, ro) } else { (ro, lo) };
    for (k, v) in b.iter().chain(a.iter()) {
        out.insert(k.clone(), v.clone());
    }
    let v = lo.get("v").and_then(|x| x.as_i64()).unwrap_or(2).max(ro.get("v").and_then(|x| x.as_i64()).unwrap_or(2)).max(2);
    out.insert("v".into(), json!(v));
    let main = workspaces.iter().find(|w| str_of(w, "id") == Some(DEFAULT_WS)).or_else(|| workspaces.first());
    out.insert("collections".into(), main.and_then(|w| w.get("collections")).cloned().unwrap_or_else(|| json!([])));
    out.insert("vars".into(), main.and_then(|w| w.get("vars")).cloned().unwrap_or_else(|| json!([])));
    out.insert("workspaces".into(), Value::Array(workspaces));
    let mut tl: Vec<(&String, &i64)> = tombs.iter().collect();
    tl.sort();
    if tl.is_empty() {
        out.remove("tombstones");
    } else {
        out.insert("tombstones".into(), Value::Array(tl.into_iter().map(|(id, at)| json!({ "id": id, "at": at })).collect()));
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;

    fn req(name: &str, url: &str, at: i64) -> Value {
        let mut v = json!({ "type": "request", "name": name, "method": "GET", "url": url });
        if at > 0 {
            v["updatedAt"] = json!(at);
        }
        v
    }
    fn folder(name: &str, kids: Vec<Value>) -> Value {
        json!({ "type": "folder", "name": name, "children": kids })
    }
    fn snap(cols: Vec<Value>) -> Value {
        json!({ "v": 2, "workspaces": [{ "id": "default", "name": "Personal", "collections": cols, "vars": [] }], "collections": [], "vars": [] })
    }
    fn cols(s: &Value) -> Vec<Value> {
        s["workspaces"][0]["collections"].as_array().unwrap().clone()
    }
    fn merged(l: &Value, r: &Value) -> Value {
        merge_snapshots_at(l, r, NOW)
    }

    #[test]
    fn backfill_is_deterministic_no_duplicates() {
        let a = snap(vec![folder("C", vec![req("login", "/a", 0), req("logout", "/b", 0)])]);
        let b = snap(vec![folder("C", vec![req("login", "/a", 0), req("logout", "/b", 0)])]);
        let m = merged(&a, &b);
        let c = cols(&m);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0]["children"].as_array().unwrap().len(), 2);
        assert!(c[0]["children"][0]["id"].is_string());
        assert_eq!(m, merged(&b, &a));
    }

    #[test]
    fn same_name_siblings_kept_apart() {
        let a = snap(vec![folder("C", vec![req("x", "/1", 0), req("x", "/2", 0)])]);
        let m = merged(&a, &a);
        assert_eq!(cols(&m)[0]["children"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn lww_picks_newer_edit() {
        let mut l = req("r", "/old", 100);
        l["id"] = json!("r1");
        let mut r = req("r", "/new", 200);
        r["id"] = json!("r1");
        let m = merged(&snap(vec![l.clone()]), &snap(vec![r.clone()]));
        assert_eq!(cols(&m)[0]["url"], "/new");
        let m2 = merged(&snap(vec![r]), &snap(vec![l]));
        assert_eq!(cols(&m2)[0]["url"], "/new");
    }

    #[test]
    fn union_of_additions_and_recursion() {
        let mut a = req("a", "/a", 10);
        a["id"] = json!("a");
        let mut b = req("b", "/b", 10);
        b["id"] = json!("b");
        let mut fl = folder("F", vec![a]);
        fl["uid"] = json!("f");
        let mut fr = folder("F", vec![b]);
        fr["uid"] = json!("f");
        let m = merged(&snap(vec![fl]), &snap(vec![fr]));
        assert_eq!(cols(&m).len(), 1);
        assert_eq!(cols(&m)[0]["children"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn tombstone_beats_older_and_edit_revives() {
        let b = NOW - 1_000_000;
        let mut r = req("r", "/x", b + 100);
        r["id"] = json!("r1");
        let mut l = snap(vec![]);
        l["tombstones"] = json!([{ "id": "r1", "at": b + 150 }]);
        let m = merged(&l, &snap(vec![r.clone()]));
        assert!(cols(&m).is_empty());
        assert_eq!(m["tombstones"].as_array().unwrap().len(), 1);
        // edición posterior al borrado: revive
        let mut r2 = r;
        r2["updatedAt"] = json!(b + 200);
        let m = merged(&l, &snap(vec![r2]));
        assert_eq!(cols(&m).len(), 1);
    }

    #[test]
    fn old_tombstones_purged() {
        let mut l = snap(vec![]);
        l["tombstones"] = json!([{ "id": "x", "at": NOW - TOMB_TTL_MS - 1 }, { "id": "y", "at": NOW - 1000 }]);
        let m = merged(&l, &snap(vec![]));
        let t = m["tombstones"].as_array().unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0]["id"], "y");
    }

    #[test]
    fn workspaces_union() {
        let l = json!({ "v": 3, "workspaces": [{ "id": "default", "name": "P", "collections": [], "vars": [] }, { "id": "wA", "name": "A", "collections": [], "vars": [] }] });
        let r = json!({ "v": 3, "workspaces": [{ "id": "default", "name": "P", "collections": [], "vars": [] }, { "id": "wB", "name": "B", "collections": [], "vars": [] }] });
        let m = merged(&l, &r);
        let ids: Vec<&str> = m["workspaces"].as_array().unwrap().iter().map(|w| w["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["default", "wA", "wB"]);
        assert_eq!(m, merged(&r, &l));
        assert!(m["collections"].is_array() && m["vars"].is_array());
    }

    #[test]
    fn idempotent() {
        let a = snap(vec![folder("C", vec![req("a", "/a", 5)])]);
        let b = snap(vec![folder("C", vec![req("b", "/b", 6)])]);
        let m = merged(&a, &b);
        assert_eq!(merged(&m, &b), m);
        assert_eq!(merged(&m, &a), m);
    }

    #[test]
    fn legacy_snapshot_without_workspaces() {
        let l = json!({ "v": 1, "collections": [req("a", "/a", 0)], "vars": [] });
        let m = merged(&l, &snap(vec![]));
        assert_eq!(cols(&m).len(), 1);
    }
}
