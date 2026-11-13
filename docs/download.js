/* Descarga directa de la última versión (sin pasar por la página de GitHub). */
(function () {
  var REPO = "cesargarridor/caesar";
  var FALLBACK = "https://github.com/" + REPO + "/releases/latest";
  var ua = navigator.userAgent || "", plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  var os = /Win/i.test(plat + ua) ? "windows" : /Mac|iPhone|iPad/i.test(plat) || /Mac OS X/.test(ua) ? "macos" : /Linux|X11|CrOS/i.test(plat + ua) ? "linux" : "";
  var NAMES = { windows: "Windows", macos: "macOS", linux: "Linux" };
  var PICK = {
    windows: [/x64-setup\.exe$/, /\.msi$/],
    macos: [/universal\.dmg$/, /\.dmg$/],
    linux: [/amd64\.AppImage$/, /amd64\.deb$/],
    deb: [/amd64\.deb$/]
  };
  function find(assets, key) {
    var pats = PICK[key] || [];
    for (var i = 0; i < pats.length; i++) for (var j = 0; j < assets.length; j++)
      if (pats[i].test(assets[j].name) && !/\.sig$/.test(assets[j].name)) return assets[j];
    return null;
  }
  function mb(n) { return (n / 1048576).toFixed(n > 20971520 ? 0 : 1) + " MB"; }
  function qa(s) { return [].slice.call(document.querySelectorAll(s)); }

  qa("[data-dl]").forEach(function (a) { a.href = FALLBACK; });
  if (os) qa("[data-dl-os]").forEach(function (a) { var k = a.getAttribute("data-dl-os"); if (k === os) a.classList.add("rec"); });

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (rel) {
      var assets = rel.assets || [], ver = (rel.tag_name || "").replace(/^v/, "");
      qa("[data-dl-os]").forEach(function (a) {
        var as = find(assets, a.getAttribute("data-dl-os")); if (!as) return;
        a.href = as.browser_download_url; a.setAttribute("download", as.name);
        var s = a.querySelector("[data-size]"); if (s) s.textContent = as.name + " · " + mb(as.size);
      });
      qa("[data-dl]").forEach(function (a) {
        var as = find(assets, os); if (!as) return;
        a.href = as.browser_download_url; a.setAttribute("download", as.name);
        var l = a.getAttribute("data-label") || "Download for"; if (os) a.textContent = l + " " + NAMES[os];
      });
      qa("[data-version]").forEach(function (e) {
        var f = e.getAttribute("data-version") || "", v = "v" + ver;
        e.textContent = f.indexOf("|") > -1 ? f.replace("|", v) : f + v;
      });
    }).catch(function () {});

  // Vídeo de demostración: solo se muestra si existe media/demo.mp4
  qa(".vid").forEach(function (box) {
    var v = box.querySelector("video"), src = v && v.getAttribute("data-src"); if (!src) return;
    fetch(src, { method: "HEAD" }).then(function (r) { if (r.ok) { v.src = src; box.classList.add("show"); } }).catch(function () {});
  });
  // Capturas: media/shot-1.png … shot-4.png (las que existan)
  qa(".gallery").forEach(function (g) {
    var base = g.getAttribute("data-base");
    [1, 2, 3, 4].forEach(function (i) {
      var u = base + "shot-" + i + ".png";
      fetch(u, { method: "HEAD" }).then(function (r) { if (r.ok) { var im = new Image(); im.src = u; im.alt = (document.documentElement.lang === "en" ? "Caesar screenshot " : "Captura de pantalla de Caesar ") + (g.children.length + 1); im.loading = "lazy"; g.appendChild(im); } }).catch(function () {});
    });
  });

  // Aviso que puede salir tras descargar, según el sistema (pestañas; sin JS se ven los tres).
  (function () {
    var sec = document.getElementById("avisos") || document.getElementById("warnings"); if (!sec) return;
    var tabs = [].slice.call(sec.querySelectorAll(".os-tabs [data-os]")), panels = [].slice.call(sec.querySelectorAll(".os-panel"));
    if (!tabs.length || !panels.length) return;
    document.body.classList.add("os-js");
    function pick(k, flash) {
      if (!k) k = "macos";
      tabs.forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-os") === k ? "true" : "false"); });
      panels.forEach(function (p) {
        var on = p.getAttribute("data-os") === k; p.classList.toggle("on", on); p.classList.remove("flash");
        if (on && flash) { void p.offsetWidth; p.classList.add("flash"); }
      });
    }
    tabs.forEach(function (t) { t.addEventListener("click", function () { pick(t.getAttribute("data-os")); }); });
    pick(os || "macos");
    qa("[data-dl],[data-dl-os]").forEach(function (a) {
      a.addEventListener("click", function () {
        var k = a.getAttribute("data-dl-os"); if (k === "deb") k = "linux"; if (!k) k = os || "macos";
        pick(k, true);
        setTimeout(function () { sec.scrollIntoView({ behavior: "smooth", block: "start" }); }, 500);
      });
    });
  })();
})();
