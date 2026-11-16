/* Simulador de Caesar para la landing: corre entero en tu navegador (sin red). Réplica de funciones reales de la app. */
(function () {
  var root = document.getElementById("demo"); if (!root) return;
  var fallbackHTML = root.innerHTML; // imagen de respaldo (sin JS o si algo falla)
  var en = (document.documentElement.lang || "es").slice(0, 2) !== "es"; // es o inglés (el resto de idiomas usa el inglés)
  var T = en ? {
    col: "Cafe API", f1: "Auth", f2: "Orders", f3: "Other", send: "Send", sending: "Sending…", params: "Params", headers: "Headers", body: "Body", timeline: "Timeline",
    noBody: "This request has no body.", noParams: "No query parameters. Add ?key=value to the URL.", empty: "Press Send to see the response.", nobody: "(no body)",
    hint: "Everything runs in your browser: no network, no data leaves this page. Try it: click any JSON value to copy it, filter with JSONPath, or paste a cURL into the URL bar.",
    copied: "Copied", copyAll: "Copy", fold: "Collapse all", unfold: "Expand all", pretty: "Pretty", raw: "Raw", filter: "Filter: $.data[*].customer  ·  or text",
    beautify: "Beautify", badJson: "Invalid JSON: ", profile: "Profile", local: "Local", prod: "Production", curlIn: "cURL imported: method, URL, headers and body filled in.",
    curlBtn: "Paste a sample cURL", curlBox: "Paste cURL", curlPh: "Paste a cURL command here (Ctrl+V) and it fills the request for you…", curlGo: "Import", code: "Code", noMatch: "No matches for that filter.", clickCopy: "Click to copy the value", pathCopy: "Click to copy the path",
    login: "Log in", me: "Who am I", list: "List orders", one: "Get order", create: "Create order", del: "Delete order", echo: "Echo", missing: "Order that does not exist",
    resolved: "Resolved URL", dns: "DNS", conn: "Connection (TLS)", wait: "Waiting", dl: "Download", total: "Total", saved: "Saved", sample: "Sample from the clipboard", invalid: "Invalid URL", checkUrl: "Check the URL"
  } : {
    col: "API cafetería", f1: "Auth", f2: "Pedidos", f3: "Otros", send: "Enviar", sending: "Enviando…", params: "Parámetros", headers: "Cabeceras", body: "Cuerpo", timeline: "Tiempos",
    noBody: "Esta petición no lleva cuerpo.", noParams: "Sin parámetros. Añade ?clave=valor a la URL.", empty: "Pulsa Enviar para ver la respuesta.", nobody: "(sin cuerpo)",
    hint: "Todo corre en tu navegador: sin red, no sale ningún dato de esta página. Pruébalo: haz clic en cualquier valor del JSON para copiarlo, filtra con JSONPath o pega un cURL en la barra de URL.",
    copied: "Copiado", copyAll: "Copiar", fold: "Plegar todo", unfold: "Expandir todo", pretty: "Bonito", raw: "Crudo", filter: "Filtro: $.data[*].cliente  ·  o texto",
    beautify: "Embellecer", badJson: "JSON no válido: ", profile: "Perfil", local: "Local", prod: "Producción", curlIn: "cURL importado: método, URL, cabeceras y cuerpo rellenados.",
    curlBtn: "Pegar un cURL de ejemplo", curlBox: "Pegar cURL", curlPh: "Pega aquí un comando cURL (Ctrl+V) y rellena la petición solo…", curlGo: "Importar", code: "Código", noMatch: "Ningún resultado para ese filtro.", clickCopy: "Clic para copiar el valor", pathCopy: "Clic para copiar la ruta",
    login: "Iniciar sesión", me: "Quién soy", list: "Listar pedidos", one: "Ver pedido", create: "Crear pedido", del: "Borrar pedido", echo: "Eco", missing: "Pedido que no existe",
    resolved: "URL resuelta", dns: "DNS", conn: "Conexión (TLS)", wait: "Espera", dl: "Descarga", total: "Total", saved: "Guardado", sample: "Ejemplo del portapapeles", invalid: "URL no válida", checkUrl: "Revisa la URL"
  };
  var BASES = { local: "http://localhost:8030", prod: "https://api.cafeteria-luna.dev" };
  var profile = "local";
  var K = en ? { c: "customer", t: "table", s: "status", it: "items", n: "name", q: "qty", p: "price", tot: "total", cur: "currency", at: "created_at", d: "data", prep: "preparing", ready: "ready", paid: "paid" }
             : { c: "cliente", t: "mesa", s: "estado", it: "items", n: "nombre", q: "cantidad", p: "precio", tot: "total", cur: "moneda", at: "creado", d: "data", prep: "preparando", ready: "listo", paid: "pagado" };
  function order(id, cust, table, st, items) {
    var o = {}; o.id = id; o[K.c] = cust; o[K.t] = table; o[K.s] = st;
    o[K.it] = items.map(function (x) { var r = { sku: x[0] }; r[K.n] = x[1]; r[K.q] = x[2]; r[K.p] = x[3]; return r; });
    o[K.tot] = Math.round(items.reduce(function (a, x) { return a + x[2] * x[3]; }, 0) * 100) / 100; o[K.cur] = "EUR"; o[K.at] = "2026-11-15T10:4" + (id.slice(-1)) + ":07Z"; return o;
  }
  var ORDERS = [
    order("PED-20418", "Marta Ruiz", 7, K.prep, [["CAF-LATTE", en ? "Large latte" : "Latte grande", 2, 3.2], ["TOS-AGUACATE", en ? "Avocado toast" : "Tostada de aguacate", 1, 5]]),
    order("PED-20419", "Luis Vega", 3, K.ready, [["CAF-CORTADO", en ? "Cortado" : "Cortado", 1, 1.8], ["BOL-CROISSANT", "Croissant", 2, 2.4]]),
    order("PED-20420", "Ana Soto", 12, K.paid, [["TE-MATCHA", "Matcha latte", 1, 4.1]])
  ];
  var DEFAULT_H = "Accept: application/json\nUser-Agent: Caesar";
  var REQS = [
    { id: "login", f: 1, n: T.login, m: "POST", u: "{{base}}/auth/login", h: DEFAULT_H + "\nContent-Type: application/json", b: '{\n  "email": "marta@cafeterialuna.dev",\n  "password": "demo1234"\n}' },
    { id: "me", f: 1, n: T.me, m: "GET", u: "{{base}}/auth/me", h: DEFAULT_H + "\nAuthorization: Bearer demo_token_9f2c", b: "" },
    { id: "list", f: 2, n: T.list, m: "GET", u: "{{base}}/orders?page=1", h: DEFAULT_H, b: "" },
    { id: "one", f: 2, n: T.one, m: "GET", u: "{{base}}/orders/PED-20418", h: DEFAULT_H, b: "" },
    { id: "create", f: 2, n: T.create, m: "POST", u: "{{base}}/orders", h: DEFAULT_H + "\nContent-Type: application/json", b: '{\n  "' + K.c + '": "Marta Ruiz",\n  "' + K.t + '": 7,\n  "' + K.it + '": [\n    { "sku": "CAF-LATTE", "' + K.q + '": 2 }\n  ]\n}' },
    { id: "del", f: 2, n: T.del, m: "DELETE", u: "{{base}}/orders/PED-20419", h: DEFAULT_H, b: "" },
    { id: "missing", f: 2, n: T.missing, m: "GET", u: "{{base}}/orders/PED-99999", h: DEFAULT_H, b: "" },
    { id: "echo", f: 3, n: T.echo, m: "POST", u: "{{base}}/echo", h: DEFAULT_H + "\nContent-Type: application/json", b: '{\n  "ping": true\n}' }
  ];
  var state = {}; REQS.forEach(function (r) { state[r.id] = { m: r.m, u: r.u, h: r.h, b: r.b, res: null, rt: r.b ? "body" : "params", pt: "body", filter: "", raw: false, folded: {}, code: false, lang: "curl", err: "", curl: false }; });
  var active = "list";

  /* ---------- utilidades ---------- */
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function resolve(u) { return u.replace(/\{\{\s*base\s*\}\}/g, BASES[profile]); }
  function parseHeaders(t) { return t.split("\n").map(function (l) { var i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; }).filter(Boolean); }
  function copy(text) {
    function done() { toast(T.copied + ": " + (text.length > 48 ? text.slice(0, 48) + "…" : text)); }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fb); return; } } catch (e) { /* sigue */ }
    fb();
    function fb() { var a = document.createElement("textarea"); a.value = text; a.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (e) { /* nada */ } a.remove(); done(); }
  }
  var toastT; function toast(msg) {
    var t = root.querySelector(".sx-toast"); if (!t) return; t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 1600);
  }

  /* ---------- servidor simulado ---------- */
  function mock(m, url, headers, body) {
    var u; try { u = new URL(url); } catch (e) { return { s: 0, st: T.invalid, j: { error: T.checkUrl } }; }
    var path = u.pathname.replace(/\/+$/, "") || "/", p = path.split("/").filter(Boolean), d = null, hd = {};
    headers.forEach(function (h) { hd[h[0].toLowerCase()] = h[1]; });
    function parse() { try { return { ok: true, v: JSON.parse(body || "null") }; } catch (e) { return { ok: false }; } }
    if (m === "POST" && path === "/auth/login") {
      var r = parse(); if (!r.ok) return { s: 400, j: { error: en ? "Invalid JSON in the body" : "JSON no válido en el cuerpo" } };
      d = r.v || {}; var email = d.email || "marta@cafeterialuna.dev";
      return { s: 200, j: { token: "demo_token_9f2c", token_type: "Bearer", expires_in: 3600, user: { id: 42, email: email, name: "Marta Ruiz", roles: ["admin", "caja"] } } };
    }
    if (path === "/auth/login") return { s: 405, st: "Method Not Allowed", j: { error: en ? "Use POST to log in" : "Usa POST para iniciar sesión", allow: ["POST"] } };
    if (m === "GET" && path === "/auth/me") {
      if (!/^bearer /i.test(hd.authorization || "")) return { s: 401, j: { error: en ? "Missing token" : "Falta el token" } };
      return { s: 200, j: { id: 42, email: "marta@cafeterialuna.dev", name: "Marta Ruiz", roles: ["admin", "caja"], profile: BASES[profile] } };
    }
    if (p[0] === "orders") {
      if (p.length === 1 && m === "GET") { var o = { page: 1 }; var res = { data: ORDERS, meta: { page: 1, per_page: 20, total: ORDERS.length } }; return { s: 200, j: res }; }
      if (p.length === 1 && m === "POST") {
        var rr = parse(); if (!rr.ok) return { s: 400, j: { error: en ? "Invalid JSON in the body" : "JSON no válido en el cuerpo" } };
        var b = rr.v || {}; var nw = order("PED-20421", b[K.c] || "Marta Ruiz", b[K.t] || 1, K.prep, ((b[K.it] || [{ sku: "CAF-LATTE", qty: 1 }]).map(function (x) { return [x.sku || "CAF-LATTE", x.sku || "CAF-LATTE", x[K.q] || 1, 3.2]; })));
        return { s: 201, st: "Created", j: nw };
      }
      if (p.length === 2) {
        var f = ORDERS.filter(function (x) { return x.id === p[1]; })[0];
        if (!f) return { s: 404, j: { error: en ? "Order not found" : "Pedido no encontrado", id: p[1] } };
        if (m === "GET") return { s: 200, j: f };
        if (m === "DELETE") return { s: 204, j: null };
      }
    }
    // Cualquier otra ruta: eco (así «localhost:8030/lo-que-sea» también responde)
    var q = {}; u.searchParams.forEach(function (v, k) { q[k] = v; });
    var rcv = parse();
    return { s: 200, j: { simulated: true, note: en ? "This route is not defined in the demo, so it echoes your request." : "Esta ruta no está definida en la demo, así que devuelve un eco de tu petición.", method: m, path: path, query: q, headers: hd, body: rcv.ok ? rcv.v : body } };
  }
  var TEXT = { 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 405: "Method Not Allowed", 404: "Not Found" };

  /* ---------- visor JSON: pliegues, números de línea, copiar valor/ruta ---------- */
  function buildLines(v, key, path, ind, comma, out, idc) {
    var isArr = Array.isArray(v), isObj = v && typeof v === "object";
    if (!isObj) { out.push({ i: ind, k: key, v: v, path: path, comma: comma }); return; }
    var keys = isArr ? v.map(function (_, n) { return n; }) : Object.keys(v), open = isArr ? "[" : "{", close = isArr ? "]" : "}";
    if (!keys.length) { out.push({ i: ind, k: key, lit: open + close, path: path, comma: comma }); return; }
    var id = idc.n++, me = { i: ind, k: key, open: open, close: close, path: path, id: id, count: keys.length }; out.push(me);
    keys.forEach(function (k, n) { buildLines(v[k], isArr ? null : k, path + (isArr ? "[" + k + "]" : (/^[A-Za-z_$][\w$]*$/.test(k) ? "." + k : "['" + k + "']")), ind + 1, n < keys.length - 1, out, idc); });
    me.end = out.length; out.push({ i: ind, closeOf: id, close: close, comma: comma, path: path });
  }
  function lit(v) {
    if (typeof v === "string") return '<span class="j-s" data-copy="' + esc(v) + '" data-p="' + esc("") + '">' + esc(JSON.stringify(v)) + "</span>";
    if (v === null) return '<span class="j-z" data-copy="null">null</span>';
    if (typeof v === "boolean") return '<span class="j-b" data-copy="' + v + '">' + v + "</span>";
    return '<span class="j-n" data-copy="' + v + '">' + v + "</span>";
  }
  function renderJson(data, folded) {
    var out = [], idc = { n: 0 }; buildLines(data, null, "$", 0, false, out, idc);
    var h = "", n = 0;
    for (var x = 0; x < out.length; x++) {
      var L = out[x], pad = 'style="padding-left:' + (L.i * 16) + 'px"', no = "<span class='sx-no'>" + (x + 1) + "</span>";
      var key = L.k !== null && L.k !== undefined && typeof L.k === "string" ? '<span class="j-k" data-copy="' + esc(L.path) + '" data-hint="path" title="' + esc(T.pathCopy) + '">"' + esc(L.k) + '"</span><span class="j-p">: </span>' : "";
      if (L.closeOf !== undefined) { h += '<div class="sx-l" data-path="' + esc(L.path) + '">' + no + "<span " + pad + '><span class="j-p">' + L.close + (L.comma ? "," : "") + "</span></span></div>"; continue; }
      if (L.open) {
        var fd = folded[L.id];
        var btn = '<button class="sx-fold" data-fold="' + L.id + '" aria-label="' + (fd ? "+" : "−") + '">' + (fd ? "▸" : "▾") + "</button>";
        if (fd) { h += '<div class="sx-l" data-path="' + esc(L.path) + '">' + no + "<span " + pad + ">" + btn + key + '<span class="j-p">' + L.open + '</span><span class="sx-cnt">' + L.count + (L.open === "[" ? "" : "") + '</span><span class="j-p">' + L.close + (out[L.end].comma ? "," : "") + "</span></span></div>"; x = L.end; continue; }
        h += '<div class="sx-l" data-path="' + esc(L.path) + '">' + no + "<span " + pad + ">" + btn + key + '<span class="j-p">' + L.open + "</span></span></div>"; continue;
      }
      var val = L.lit ? '<span class="j-p">' + L.lit + "</span>" : lit(L.v);
      h += '<div class="sx-l" data-path="' + esc(L.path) + '">' + no + "<span " + pad + ">" + key + val + (L.comma ? '<span class="j-p">,</span>' : "") + "</span></div>";
    }
    return { html: h, lines: out.length };
  }
  function jsonPath(data, expr) {
    expr = expr.trim(); if (expr.charAt(0) !== "$") return null;
    var rest = expr.slice(1), nodes = [data], single = true, m;
    var re = /^(?:\.\.([\w$-]+)|\.(\*|[\w$-]+)|\[(\d+)\]|\[\*\]|\['([^']+)'\])/;
    while (rest) {
      m = re.exec(rest); if (!m) return undefined;
      var next = [];
      if (m[1]) { single = false; (function walk(n) { if (n && typeof n === "object") { Object.keys(n).forEach(function (k) { if (k === m[1]) next.push(n[k]); walk(n[k]); }); } })(nodes[0] !== undefined ? { r: nodes } : {}); nodes.forEach(function (n) { (function walk(x) { if (x && typeof x === "object") Object.keys(x).forEach(function (k) { if (k === m[1] && next.indexOf(x[k]) < 0) next.push(x[k]); walk(x[k]); }); })(n); }); next = next.filter(function (v, i, a) { return a.indexOf(v) === i; }); }
      else if (m[2] === "*" || m[0] === "[*]") { single = false; nodes.forEach(function (n) { if (n && typeof n === "object") Object.keys(n).forEach(function (k) { next.push(n[k]); }); }); }
      else { var key = m[2] || m[4] || m[3]; nodes.forEach(function (n) { if (n && typeof n === "object" && key in n) next.push(n[key]); }); }
      nodes = next; rest = rest.slice(m[0].length);
    }
    return single ? (nodes.length ? nodes[0] : undefined) : nodes;
  }

  /* ---------- importar cURL ---------- */
  function tokenize(s) {
    var out = [], cur = "", q = null, has = false;
    s = s.replace(/\\\r?\n/g, " ");
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === q) q = null; else if (c === "\\" && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; }
      else if (c === "'" || c === '"') { q = c; has = true; }
      else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ""; has = false; }
      else cur += c;
    }
    if (cur || has) out.push(cur); return out;
  }
  function importCurl(text) {
    var t = tokenize(text.trim()); if (!t.length || t[0] !== "curl") return false;
    var m = "", url = "", hs = [], body = "";
    for (var i = 1; i < t.length; i++) {
      var a = t[i];
      if (a === "-X" || a === "--request") m = (t[++i] || "").toUpperCase();
      else if (a === "-H" || a === "--header") hs.push(t[++i] || "");
      else if (a === "-d" || a === "--data" || a === "--data-raw" || a === "--data-binary") body += (body ? "&" : "") + (t[++i] || "");
      else if (a.charAt(0) !== "-" && !url) url = a;
    }
    if (!url) return false;
    var st = state[active]; st.m = m || (body ? "POST" : "GET"); st.u = url; st.h = hs.length ? hs.join("\n") : DEFAULT_H;
    try { st.b = JSON.stringify(JSON.parse(body), null, 2); } catch (e) { st.b = body; }
    st.rt = st.b ? "body" : "params"; st.res = null; st.err = ""; st.curl = false; draw(); toast(T.curlIn); return true;
  }
  var SAMPLE = "curl -X POST https://api.cafeteria-luna.dev/v1/pedidos \\\n  -H 'Authorization: Bearer demo_token_9f2c' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"" + K.c + "\":\"Marta Ruiz\",\"" + K.t + "\":7,\"" + K.it + "\":[{\"sku\":\"CAF-LATTE\",\"" + K.q + "\":2}]}'";

  /* ---------- generador de código ---------- */
  function codeFor(st, lang) {
    var url = resolve(st.u), hs = parseHeaders(st.h), body = st.m === "GET" || st.m === "DELETE" ? "" : st.b.trim();
    if (lang === "fetch") return "const res = await fetch(" + JSON.stringify(url) + ", {\n  method: " + JSON.stringify(st.m) + ",\n  headers: " + JSON.stringify(hs.reduce(function (o, h) { o[h[0]] = h[1]; return o; }, {}), null, 4).replace(/\n/g, "\n  ") + (body ? ",\n  body: JSON.stringify(" + body.replace(/\n/g, "\n  ") + ")" : "") + "\n});\nconst data = await res.json();";
    if (lang === "py") return "import requests\n\nres = requests.request(" + JSON.stringify(st.m) + ", " + JSON.stringify(url) + ",\n    headers={" + hs.map(function (h) { return JSON.stringify(h[0]) + ": " + JSON.stringify(h[1]); }).join(", ") + "}" + (body ? ",\n    json=" + body.replace(/\n/g, "\n    ").replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None") : "") + ")\nprint(res.json())";
    return "curl -X " + st.m + " '" + url + "'" + hs.map(function (h) { return " \\\n  -H '" + h[0] + ": " + h[1] + "'"; }).join("") + (body ? " \\\n  -d '" + body.replace(/\s*\n\s*/g, " ") + "'" : "");
  }

  /* ---------- pintado ---------- */
  var ICO = { col: '<svg viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l4 1-3 13-4-1z"/></svg>', send: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/></svg>', copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>', code: '<svg viewBox="0 0 24 24"><path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/></svg>' };
  function q(s) { return root.querySelector(s); }
  function draw() {
    var st = state[active], r = st.res;
    var side = '<div class="sx-sh">' + (en ? "Collections" : "Colecciones") + '</div><div class="sx-col">' + ICO.col + T.col + "</div>";
    [[1, T.f1], [2, T.f2], [3, T.f3]].forEach(function (f) {
      side += '<div class="sx-fold-t">' + f[1] + "</div>";
      REQS.filter(function (x) { return x.f === f[0]; }).forEach(function (x) { side += '<button class="sx-it' + (x.id === active ? " on" : "") + '" data-open="' + x.id + '"><b class="m-' + state[x.id].m + '">' + state[x.id].m + "</b>" + x.n + "</button>"; });
    });
    side += '<button class="sx-curl" data-sample>' + T.curlBtn + "</button>";
    var meths = ["GET", "POST", "PUT", "PATCH", "DELETE"].map(function (m) { return "<option" + (m === st.m ? " selected" : "") + ">" + m + "</option>"; }).join("");
    var rtabs = [["params", T.params], ["headers", T.headers], ["body", T.body]].map(function (k) { return '<button data-rt="' + k[0] + '" class="' + (st.rt === k[0] ? "on" : "") + '">' + k[1] + (k[0] === "headers" ? " <i>" + parseHeaders(st.h).length + "</i>" : "") + "</button>"; }).join("");
    var panel;
    if (st.rt === "headers") panel = '<textarea spellcheck="false" id="sx-h" aria-label="Headers">' + esc(st.h) + "</textarea>";
    else if (st.rt === "body") panel = (st.m === "GET" || st.m === "DELETE") ? '<div class="sx-note">' + T.noBody + "</div>" : '<div class="sx-bt"><span>JSON</span><button data-beauty>' + T.beautify + "</button>" + (st.err ? '<em>' + esc(st.err) + "</em>" : "") + '</div><textarea spellcheck="false" id="sx-b" aria-label="Body">' + esc(st.b) + "</textarea>";
    else { var qs = ""; try { new URL(resolve(st.u)).searchParams.forEach(function (v, k) { qs += "<div><b>" + esc(k) + "</b><span>" + esc(v) + "</span></div>"; }); } catch (e) { /* nada */ } panel = '<div class="sx-kv">' + (qs || '<div class="sx-note">' + T.noParams + "</div>") + "</div>"; }
    var status = "";
    if (r && r.wait) status = '<span class="code wait">' + T.sending + "</span>";
    else if (r) status = '<span class="code ' + (r.s >= 200 && r.s < 400 ? "ok" : "bad") + '">' + (r.s || "—") + " " + (r.st || TEXT[r.s] || "") + "</span><span>" + r.t + " ms</span><span>" + r.size + " B</span>";
    var rbar = r && !r.wait ? '<div class="sx-rt"><button data-pt="body" class="' + (st.pt === "body" ? "on" : "") + '">' + T.body + '</button><button data-pt="headers" class="' + (st.pt === "headers" ? "on" : "") + '">' + T.headers + " <i>" + r.h.length + '</i></button><button data-pt="time" class="' + (st.pt === "time" ? "on" : "") + '">' + T.timeline + "</button>" + '<div class="sx-st">' + status + "</div></div>" : '<div class="sx-rt"><button class="on">' + T.body + '</button><div class="sx-st">' + status + "</div></div>";
    var tools = r && !r.wait && st.pt === "body" && r.j !== null ? '<div class="sx-tools"><div class="sx-seg"><button data-raw="0" class="' + (st.raw ? "" : "on") + '">' + T.pretty + '</button><button data-raw="1" class="' + (st.raw ? "on" : "") + '">' + T.raw + "</button></div>" + '<button data-copyall>' + ICO.copy + T.copyAll + "</button>" + (st.raw ? "" : '<button data-foldall="1">' + T.fold + '</button><button data-foldall="0">' + T.unfold + "</button>") + '<input id="sx-f" placeholder="' + esc(T.filter) + '" value="' + esc(st.filter) + '" aria-label="JSONPath"></div>' : "";
    root.innerHTML = '<div class="sx-bar"><i></i><i></i><i></i><span>Caesar</span><label class="sx-prof">' + T.profile + ' <select id="sx-p"><option value="local"' + (profile === "local" ? " selected" : "") + ">" + T.local + '</option><option value="prod"' + (profile === "prod" ? " selected" : "") + ">" + T.prod + "</option></select></label></div>" +
      '<div class="sx-body"><aside class="sx-side">' + side + '</aside><section class="sx-main"><div class="sx-req"><select id="sx-m" class="m-' + st.m + '" aria-label="Method">' + meths + '</select><input id="sx-u" spellcheck="false" aria-label="URL" value="' + esc(st.u) + '" placeholder="https://…"><button class="sx-ico sx-pc" data-curlbox title="' + T.curlBox + '">cURL</button><button class="sx-ico" data-code title="' + T.code + '">' + ICO.code + '</button><button class="sx-send" data-send' + (r && r.wait ? " disabled" : "") + ">" + ICO.send + (r && r.wait ? T.sending : T.send) + "</button></div>" +
      (st.curl ? '<div class="sx-cbox"><textarea id="sx-c" spellcheck="false" placeholder="' + esc(T.curlPh) + '"></textarea><div><button data-curlgo>' + T.curlGo + '</button><button data-sample>' + T.curlBtn + '</button></div></div>' : '') +
      (st.code ? '<div class="sx-code"><div class="sx-seg">' + [["curl", "cURL"], ["fetch", "fetch"], ["py", "Python"]].map(function (l) { return '<button data-lang="' + l[0] + '" class="' + (st.lang === l[0] ? "on" : "") + '">' + l[1] + "</button>"; }).join("") + '<button data-copycode>' + ICO.copy + T.copyAll + "</button></div><pre>" + esc(codeFor(st, st.lang)) + "</pre></div>" : "") +
      '<div class="sx-rq"><div class="sx-rt">' + rtabs + '</div><div class="sx-rp">' + panel + "</div></div>" +
      '<div class="sx-rs">' + rbar + tools + '<div class="sx-view" id="sx-view"></div><div class="sx-path" id="sx-path"></div></div></section></div><div class="sx-hint">' + T.hint + '</div><div class="sx-toast" role="status" aria-live="polite"></div>';
    drawView();
  }
  function drawView() {
    var st = state[active], r = st.res, el = q("#sx-view"); if (!el) return;
    if (!r) { el.innerHTML = '<div class="sx-empty">' + T.empty + "</div>"; return; }
    if (r.wait) { el.innerHTML = '<div class="sx-empty">' + T.sending + "</div>"; return; }
    if (st.pt === "headers") { el.innerHTML = '<div class="sx-kv pad">' + r.h.map(function (h) { return '<div><b data-copy="' + esc(h[0]) + '">' + esc(h[0]) + '</b><span data-copy="' + esc(h[1]) + '">' + esc(h[1]) + "</span></div>"; }).join("") + "</div>"; return; }
    if (st.pt === "time") {
      var tl = r.tl, tot = tl.reduce(function (a, x) { return a + x[1]; }, 0);
      el.innerHTML = '<div class="sx-tl pad"><div class="sx-note">' + T.resolved + ": <code>" + esc(resolve(st.u)) + "</code></div>" + tl.map(function (x) { return "<div><span>" + x[0] + '</span><i style="width:' + Math.max(3, Math.round(x[1] / tot * 100)) + '%"></i><b>' + x[1] + " ms</b></div>"; }).join("") + "<div class='sx-tot'><span>" + T.total + "</span><b>" + tot + " ms</b></div></div>"; return;
    }
    if (r.j === null) { el.innerHTML = '<div class="sx-empty">' + T.nobody + "</div>"; return; }
    var data = r.j, filt = st.filter.trim(), shown = data;
    if (st.raw) { el.innerHTML = '<pre class="sx-raw" data-copy="' + esc(JSON.stringify(data)) + '">' + esc(JSON.stringify(data)) + "</pre>"; return; }
    if (filt) {
      if (filt.charAt(0) === "$") { shown = jsonPath(data, filt); if (shown === undefined || (Array.isArray(shown) && !shown.length)) { el.innerHTML = '<div class="sx-empty">' + T.noMatch + "</div>"; return; } }
      else { var low = filt.toLowerCase(), lines = JSON.stringify(data, null, 2).split("\n").filter(function (l) { return l.toLowerCase().indexOf(low) > -1; }); if (!lines.length) { el.innerHTML = '<div class="sx-empty">' + T.noMatch + "</div>"; return; } el.innerHTML = '<pre class="sx-raw">' + esc(lines.join("\n")).replace(new RegExp(filt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), function (m) { return "<mark>" + m + "</mark>"; }) + "</pre>"; return; }
    }
    el.innerHTML = renderJson(shown, st.folded).html;
  }
  function send() {
    var st = state[active], id = active; if (st.res && st.res.wait) return;
    var url = resolve(st.u), hs = parseHeaders(st.h), out = mock(st.m, url, hs, st.b);
    st.res = { wait: true }; st.pt = "body"; st.folded = {}; draw();
    var t = 14 + Math.floor(Math.random() * 90);
    setTimeout(function () {
      var txt = out.j === null ? "" : JSON.stringify(out.j), rid = "req_" + Math.random().toString(16).slice(2, 10);
      var dns = 4 + Math.floor(Math.random() * 10), cn = 8 + Math.floor(Math.random() * 20), dl = Math.max(1, Math.round(t * 0.12)), w = Math.max(2, t - dns - cn - dl);
      var h = [["content-type", "application/json; charset=utf-8"], ["x-request-id", rid], ["cache-control", "no-store"], ["server", "caesar-demo"], ["date", new Date().toUTCString()]];
      st.res = { s: out.s, st: out.st, j: out.j, t: t, size: new Blob([txt]).size, h: out.j === null ? h.filter(function (x) { return x[0] !== "content-type"; }) : h, tl: [[T.dns, dns], [T.conn, cn], [T.wait, w], [T.dl, dl]] };
      if (active === id) draw();
    }, 220 + t * 3);
  }

  /* ---------- eventos ---------- */
  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-open],[data-rt],[data-pt],[data-send],[data-copy],[data-fold],[data-foldall],[data-raw],[data-copyall],[data-code],[data-lang],[data-copycode],[data-beauty],[data-sample],[data-curlbox],[data-curlgo]"); if (!el) return;
    var st = state[active], d = el.dataset;
    if (d.send !== undefined) return send();
    if (d.open) { active = d.open; return draw(); }
    if (d.rt) { st.rt = d.rt; return draw(); }
    if (d.pt) { st.pt = d.pt; return draw(); }
    if (d.copy !== undefined) return copy(d.copy);
    if (d.fold) { st.folded[d.fold] = !st.folded[d.fold]; return drawView(); }
    if (d.foldall !== undefined) { st.folded = {}; if (d.foldall === "1" && st.res && st.res.j) { var out = [], idc = { n: 0 }; buildLines(st.res.j, null, "$", 0, false, out, idc); out.forEach(function (l) { if (l.open && l.id > 0) st.folded[l.id] = true; }); } return drawView(); }
    if (d.raw !== undefined) { st.raw = d.raw === "1"; return draw(); }
    if (d.copyall !== undefined) return copy(st.raw ? JSON.stringify(st.res.j) : JSON.stringify(st.res.j, null, 2));
    if (d.code !== undefined) { st.code = !st.code; return draw(); }
    if (d.lang) { st.lang = d.lang; return draw(); }
    if (d.copycode !== undefined) return copy(codeFor(st, st.lang));
    if (d.beauty !== undefined) { try { st.b = JSON.stringify(JSON.parse(st.b), null, 2); st.err = ""; } catch (x) { st.err = T.badJson + x.message; } return draw(); }
    if (d.curlbox !== undefined) { st.curl = !st.curl; draw(); var c0 = q('#sx-c'); if (c0) c0.focus(); return; }
    if (d.curlgo !== undefined) { var c1 = q('#sx-c'); if (c1 && !importCurl(c1.value)) toast(en ? 'That does not look like a cURL command' : 'Eso no parece un comando cURL'); return; }
    if (d.sample !== undefined) { if (st.curl) { var c2 = q('#sx-c'); if (c2) { c2.value = SAMPLE; return; } } importCurl(SAMPLE); return; }
  });
  root.addEventListener("input", function (e) {
    var st = state[active], id = e.target.id;
    if (id === "sx-u") st.u = e.target.value; else if (id === "sx-b") st.b = e.target.value; else if (id === "sx-h") st.h = e.target.value;
    else if (id === "sx-f") { st.filter = e.target.value; drawView(); }
  });
  root.addEventListener("change", function (e) {
    if (e.target.id === "sx-m") { state[active].m = e.target.value; draw(); }
    if (e.target.id === "sx-p") { profile = e.target.value; draw(); }
  });
  root.addEventListener("paste", function (e) {
    if (e.target.id === "sx-c") { var tx = (e.clipboardData || window.clipboardData).getData("text"); if (/^\s*curl\b/.test(tx)) { e.preventDefault(); state[active].curl = false; importCurl(tx); } return; }
    if (e.target.id !== "sx-u") return;
    var txt = (e.clipboardData || window.clipboardData).getData("text");
    if (/^\s*curl\b/.test(txt) && importCurl(txt)) e.preventDefault();
  });
  root.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" && e.target.id === "sx-u") || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); send(); }
  });
  root.addEventListener("mouseover", function (e) {
    var l = e.target.closest(".sx-l"), p = q("#sx-path"); if (p) p.textContent = l ? l.dataset.path + "   ·   " + T.clickCopy : "";
  });
  try { draw(); } catch (e) { root.innerHTML = fallbackHTML; return; }
  setTimeout(function () { try { if (!state.list.res && active === "list") send(); } catch (e) { root.innerHTML = fallbackHTML; } }, 900);
})();

/* Gato: al tocarlo cierra los ojos de felicidad, ronronea y salen corazones (igual que en la app). */
(function () {
  var wrap = document.getElementById("cat"); if (!wrap) return;
  var img = wrap.querySelector("img"); if (!img) return;
  var NS = "http://www.w3.org/2000/svg", svg;
  try {
    svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "cat"); svg.setAttribute("viewBox", "0 0 16 12"); svg.setAttribute("shape-rendering", "crispEdges"); svg.setAttribute("aria-hidden", "true");
  } catch (e) { return; }
  var P = { o: "#f28c2e", d: "#c9621a", w: "#fff0d4", k: "#2b1a12", p: "#ff9aa8" };
  var ROWS = ["oo............oo", "ooo..........ooo", "oopo........opoo", "oopooooddoooopoo", "oooooooddooooooo", "oookkoooooookkoo", "oookkoooooookkoo", "oowwwwoppowwwwoo", "oowwwwowwowwwwoo", "ooowwwwwwwwwwooo", ".oooowwwwwoooo.", "..oooooooooooo.."];
  ROWS[10] = ".oooowwwwwoooo.."; // misma rejilla de 16 columnas
  var HAPPY = { 5: "oookkooooookkooo", 6: "ookookooookookoo" };
  function paint(happy) {
    var h = "";
    ROWS.forEach(function (r, y) {
      r = happy && HAPPY[y] ? HAPPY[y] : r;
      for (var x = 0; x < r.length; x++) if (P[r[x]]) h += '<rect x="' + x + '" y="' + y + '" width="1.02" height="1.02" fill="' + P[r[x]] + '"/>';
    });
    svg.innerHTML = h;
  }
  try { paint(false); if (!svg.querySelector("rect")) return; img.replaceWith(svg); wrap.classList.add("js"); wrap.setAttribute("role", "img"); wrap.setAttribute("aria-label", "Caesar"); wrap.title = "♥"; }
  catch (e) { return; }
  var timer, hearts = [];
  wrap.addEventListener("click", function () {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    clearTimeout(timer); hearts.forEach(function (e) { e.remove(); }); hearts = [];
    wrap.classList.remove("happy"); void wrap.offsetWidth; wrap.classList.add("happy"); paint(true);
    [["10%", 0], ["45%", .35], ["78%", .7]].forEach(function (p) {
      var s = document.createElement("span"); s.className = "cat-heart"; s.textContent = "♥"; s.style.left = p[0]; s.style.animationDelay = p[1] + "s"; wrap.appendChild(s); hearts.push(s);
    });
    timer = setTimeout(function () { wrap.classList.remove("happy"); paint(false); hearts.forEach(function (e) { e.remove(); }); hearts = []; }, 2400);
  });
})();
