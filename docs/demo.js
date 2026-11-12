/* Demo interactiva de Caesar: todo ocurre en tu navegador (no hay red ni servidor). */
(function () {
  var root = document.getElementById("demo"); if (!root) return;
  var en = (document.documentElement.lang || "es").slice(0, 2) === "en";
  var T = en ? {
    col: "Caesar demo", f1: "Basics", f2: "Users", hello: "Say hello", login: "Log in", echo: "Echo", list: "List users", one: "Get user 1", del: "Delete user 2", missing: "Not found",
    send: "Send", sending: "Sending…", params: "Params", headers: "Headers", body: "Body", none: "This request has no body.", size: "B", hint: "Everything here is simulated in your browser. Pick a request, edit the URL or the body, and press Send.", empty: "Press Send to see the response", nobody: "(no content)"
  } : {
    col: "Caesar demo", f1: "Básicos", f2: "Usuarios", hello: "Decir hola", login: "Iniciar sesión", echo: "Eco", list: "Listar usuarios", one: "Ver usuario 1", del: "Borrar usuario 2", missing: "No existe",
    send: "Enviar", sending: "Enviando…", params: "Parámetros", headers: "Cabeceras", body: "Cuerpo", none: "Esta petición no lleva cuerpo.", size: "B", hint: "Todo es simulado en tu navegador. Elige una petición, edita la URL o el cuerpo y pulsa Enviar.", empty: "Pulsa Enviar para ver la respuesta", nobody: "(sin contenido)"
  };
  var H = "https://api.example.com";
  var login = en ? '{\n  "name": "Ada"\n}' : '{\n  "name": "Ada"\n}';
  var REQS = [
    { id: "hello", f: 1, n: T.hello, m: "GET", u: H + "/hello", b: "" },
    { id: "login", f: 1, n: T.login, m: "POST", u: H + "/login", b: login },
    { id: "echo", f: 1, n: T.echo, m: "POST", u: H + "/echo", b: '{\n  "ping": true\n}' },
    { id: "list", f: 2, n: T.list, m: "GET", u: H + "/users", b: "" },
    { id: "one", f: 2, n: T.one, m: "GET", u: H + "/users/1", b: "" },
    { id: "del", f: 2, n: T.del, m: "DELETE", u: H + "/users/2", b: "" },
    { id: "missing", f: 2, n: T.missing, m: "GET", u: H + "/users/99", b: "" }
  ];
  var USERS = [{ id: 1, name: "Ada", role: "admin" }, { id: 2, name: "Linus", role: "dev" }, { id: 3, name: "Grace", role: "dev" }];
  var state = {}; // id -> {m,u,b,res,tab}
  REQS.forEach(function (r) { state[r.id] = { m: r.m, u: r.u, b: r.b, res: null, tab: "body" }; });
  var open = ["hello"], active = "hello";

  function mock(m, url, body) {
    var path; try { path = new URL(url).pathname.replace(/\/+$/, "") || "/"; } catch (e) { return { s: 0, st: en ? "Invalid URL" : "URL no válida", j: { error: en ? "Check the URL" : "Revisa la URL" } }; }
    var p = path.split("/").filter(Boolean), j, d = null;
    if (m === "GET" && path === "/hello") return { s: 200, j: { message: en ? "Hello, world! I'm Caesar" : "¡Hola, mundo! Soy Caesar", local_first: true, fast: true, tip: en ? "Your data never leaves your machine" : "Tus datos no salen de tu equipo" } };
    if (m === "POST" && path === "/login") {
      try { d = JSON.parse(body || "{}"); } catch (e) { return { s: 400, j: { error: en ? "Invalid JSON in the body" : "JSON no válido en el cuerpo" } }; }
      var name = d && d.name ? String(d.name) : (en ? "stranger" : "desconocido");
      return { s: 200, j: { message: (en ? "Hello, " : "¡Hola, ") + name + "!", token: "caesar_" + Math.random().toString(36).slice(2, 12), expires_in: 3600 } };
    }
    if (path === "/echo") {
      try { d = JSON.parse(body || "null"); } catch (e) { d = body; }
      return { s: 200, j: { method: m, received: d } };
    }
    if (p[0] === "users") {
      if (p.length === 1 && m === "GET") return { s: 200, j: USERS };
      if (p.length === 2) {
        var u = USERS.filter(function (x) { return String(x.id) === p[1]; })[0];
        if (!u) return { s: 404, j: { error: en ? "User not found" : "Usuario no encontrado" } };
        if (m === "GET") return { s: 200, j: u };
        if (m === "DELETE") return { s: 204, j: null };
      }
    }
    return { s: 404, j: { error: en ? "Not found" : "No encontrado", path: path } };
  }
  var TEXT = { 200: "OK", 204: "No Content", 400: "Bad Request", 404: "Not Found" };
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function hl(obj) {
    var s = esc(JSON.stringify(obj, null, 2));
    return s.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?|[{}\[\],]/g, function (x, str, colon, bool) {
      if (str) return colon ? '<span class="j-k">' + str + '</span><span class="j-p">:</span>' : '<span class="j-s">' + str + "</span>";
      if (bool) return '<span class="j-b">' + x + "</span>";
      if (x === "null") return '<span class="j-z">null</span>';
      if (/^[{}\[\],]$/.test(x)) return '<span class="j-p">' + x + "</span>";
      return '<span class="j-n">' + x + "</span>";
    });
  }
  var ICON_COL = '<svg viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l4 1-3 13-4-1z"/></svg>';
  var ICON_F = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  function q(s) { return root.querySelector(s); }
  function nameOf(id) { return REQS.filter(function (r) { return r.id === id; })[0].n; }

  function draw() {
    var st = state[active];
    var side = '<h4>' + (en ? "Collections" : "Colecciones") + '</h4><div class="ap-col">' + ICON_COL + T.col + "</div>";
    [1, 2].forEach(function (f) {
      side += '<div class="ap-fold">' + ICON_F + (f === 1 ? T.f1 : T.f2) + "</div>";
      REQS.filter(function (r) { return r.f === f; }).forEach(function (r) {
        side += '<button class="ap-item' + (r.id === active ? " on" : "") + '" data-open="' + r.id + '"><span class="ap-m m-' + state[r.id].m + '">' + state[r.id].m + "</span>" + r.n + "</button>";
      });
    });
    var tabs = open.map(function (id) {
      return '<button class="ap-tab' + (id === active ? " on" : "") + '" data-tab="' + id + '"><b class="m-' + state[id].m + '">' + state[id].m + "</b>" + nameOf(id) + '<u data-close="' + id + '">×</u></button>';
    }).join("");
    var meths = ["GET", "POST", "PUT", "DELETE"].map(function (m) { return "<option" + (m === st.m ? " selected" : "") + ">" + m + "</option>"; }).join("");
    var rt = ["params", "headers", "body"].map(function (k) { return '<button data-rt="' + k + '" class="' + (st.tab === k ? "on" : "") + '">' + T[k] + "</button>"; }).join("");
    var panel = st.tab === "body"
      ? (st.m === "GET" || st.m === "DELETE" ? '<div class="kv">' + T.none + "</div>" : '<textarea spellcheck="false" id="ap-body">' + esc(st.b) + "</textarea>")
      : st.tab === "headers" ? '<div class="kv"><b>Accept</b>: application/json<br><b>User-Agent</b>: Caesar</div>'
      : '<div class="kv">' + (st.u.indexOf("?") > -1 ? esc(st.u.split("?")[1]).replace(/&amp;/g, "<br>") : T.none) + "</div>";
    var r = st.res, status = "", body = '<span class="j-p">' + T.empty + "</span>";
    if (r) {
      if (r.wait) { status = '<span class="code wait">' + T.sending + "</span>"; body = ""; }
      else {
        status = '<span class="code ' + (r.s >= 200 && r.s < 300 ? "ok" : "bad") + '">' + (r.s || "—") + " " + (r.st || TEXT[r.s] || "") + "</span><span>" + r.t + " ms</span><span>" + r.size + " " + T.size + "</span>";
        body = r.j === null ? '<span class="j-p">' + T.nobody + "</span>" : hl(r.j);
      }
    }
    root.innerHTML =
      '<div class="ap-bar"><i></i><i></i><i></i><span>Caesar</span></div><div class="ap-body"><aside class="ap-side">' + side +
      '</aside><section class="ap-main"><div class="ap-tabs">' + tabs + '</div><div class="ap-req"><select id="ap-m" aria-label="Method" class="m-' + st.m + '">' + meths +
      '</select><input id="ap-u" spellcheck="false" aria-label="URL" value="' + st.u.replace(/"/g, "&quot;") + '"><button class="ap-send" id="ap-s"' + (r && r.wait ? " disabled" : "") + ">" + (r && r.wait ? T.sending : T.send) + '</button></div><div class="ap-rt">' + rt +
      '</div><div class="ap-rp">' + panel + '</div><div class="ap-res"><div class="ap-st">' + status + "</div><pre>" + body + '</pre></div></section></div><div class="ap-hint">' + T.hint + "</div>";
  }
  function send() {
    var st = state[active], id = active; if (st.res && st.res.wait) return;
    var out = mock(st.m, st.u, st.b);
    st.res = { wait: true }; draw();
    var t = 6 + Math.floor(Math.random() * 30);
    setTimeout(function () {
      var txt = out.j === null ? "" : JSON.stringify(out.j);
      st.res = { s: out.s, st: out.st, j: out.j, t: t, size: new Blob([txt]).size };
      if (active === id) draw();
    }, 250 + t * 6);
  }
  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-open],[data-tab],[data-close],[data-rt],#ap-s"); if (!t) return;
    if (t.id === "ap-s") return send();
    if (t.dataset.close) { var id = t.dataset.close; if (open.length > 1) { open = open.filter(function (x) { return x !== id; }); if (active === id) active = open[open.length - 1]; } return draw(); }
    if (t.dataset.rt) { state[active].tab = t.dataset.rt; return draw(); }
    var go = t.dataset.open || t.dataset.tab; active = go; if (open.indexOf(go) < 0) open.push(go); draw();
  });
  root.addEventListener("input", function (e) {
    if (e.target.id === "ap-u") state[active].u = e.target.value;
    if (e.target.id === "ap-body") state[active].b = e.target.value;
  });
  root.addEventListener("change", function (e) {
    if (e.target.id === "ap-m") { state[active].m = e.target.value; draw(); }
  });
  root.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.id === "ap-u") { e.preventDefault(); send(); } });
  draw();
  setTimeout(function () { if (!state.hello.res) send(); }, 900);
})();

/* Gato: al tocarlo cierra los ojos de felicidad, ronronea y salen corazones (igual que en la app). */
(function () {
  var wrap = document.getElementById("cat"); if (!wrap) return;
  var svg = wrap.querySelector("svg"); if (!svg) return;
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
