#!/usr/bin/env node
// Genera la web traducida (docs/<idioma>/) a partir de las páginas en inglés (docs/en/).
//   node scripts/site-i18n/build.mjs extract   → escribe scripts/site-i18n/segments.json (textos en inglés)
//   node scripts/site-i18n/build.mjs build     → lee scripts/site-i18n/tr/<idioma>.json y genera docs/<idioma>/*.html
//   (y reescribe el selector de idioma + hreflang de TODAS las páginas, incl. es/en, y sitemap.xml)
// Requiere: npm i --no-save cheerio
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";

const BASE = "https://cesargarridor.github.io/caesar/";
const LANGS = [
  { id: "es", label: "ES", name: "Español", og: "es_ES" },
  { id: "en", label: "EN", name: "English", og: "en_GB" },
  { id: "de", label: "DE", name: "Deutsch", og: "de_DE" },
  { id: "fr", label: "FR", name: "Français", og: "fr_FR" },
  { id: "it", label: "IT", name: "Italiano", og: "it_IT" },
  { id: "pt-BR", label: "PT", name: "Português (Brasil)", og: "pt_BR" },
  { id: "zh-CN", label: "中文", name: "简体中文", og: "zh_CN" },
  { id: "ja", label: "JA", name: "日本語", og: "ja_JP" },
  { id: "ru", label: "RU", name: "Русский", og: "ru_RU" },
];
const NEW = LANGS.filter((l) => !["es", "en"].includes(l.id));
// página lógica → archivo en es / resto
const PAGES = { index: ["index.html", "index.html"], download: ["download.html", "download.html"], features: ["funciones.html", "features.html"] };
const file = (lang, page) => (lang === "es" ? PAGES[page][0] : PAGES[page][1]);
const dir = (lang) => (lang === "es" ? "" : lang + "/");
const url = (lang, page) => BASE + dir(lang) + (page === "index" ? "" : file(lang, page));
// ruta relativa desde una página de `from` a la página `page` de `to`
const rel = (from, to, page) => {
  const up = from === "es" ? "" : "../";
  return up + dir(to) + (page === "index" ? "" : file(to, page));
};

const INLINE = new Set(["a", "strong", "b", "em", "i", "code", "span", "kbd", "br", "small", "mark", "abbr", "sub", "sup"]);
const ATTRS = ["alt", "title", "aria-label", "placeholder"];
const load = (p) => cheerio.load(readFileSync(p, "utf8"), { decodeEntities: false });

/** Recorre una página en inglés y llama a fn(texto, setter) por cada texto traducible. */
function walk($, fn) {
  const META = [
    "meta[name=description]", "meta[property='og:title']", "meta[property='og:description']",
    "meta[name='twitter:title']", "meta[name='twitter:description']",
  ];
  fn($("title").html(), (v) => $("title").html(v));
  for (const sel of META) $(sel).each((_, el) => fn($(el).attr("content"), (v) => $(el).attr("content", v)));
  $("body")
    .find("*")
    .each((_, el) => {
      const $el = $(el);
      for (const a of ATTRS) if ($el.attr(a)) fn($el.attr(a), (v) => $el.attr(a, v));
    });
  const visit = (el) => {
    const tag = el.name;
    if (["script", "style", "svg", "pre", "noscript"].includes(tag)) return;
    const kids = el.children || [];
    const hasText = kids.some((c) => c.type === "text" && c.data.trim());
    const onlyInline = kids.every((c) => c.type === "text" || c.type === "comment" || (c.type === "tag" && INLINE.has(c.name)));
    if (hasText && onlyInline) {
      const $el = cheerio.load("<x></x>", null, false)(el);
      const inner = cheerio.load(el.children.length ? "" : "", null, false);
      void inner;
      fn(null, null, el);
      return;
    }
    kids.forEach((c) => c.type === "tag" && visit(c));
  };
  visit($("body")[0]);
  // precios (script inline con P={year:[...],month:[...]})
}

const innerOf = ($, el) => $(el).html();

function segmentsOf(page) {
  const $ = load(`docs/en/${file("en", page)}`);
  const out = [];
  const add = (s) => s && s.trim() && out.push(s.trim());
  add($("title").html());
  for (const sel of ["meta[name=description]", "meta[property='og:title']", "meta[property='og:description']", "meta[name='twitter:title']", "meta[name='twitter:description']"])
    $(sel).each((_, el) => add($(el).attr("content")));
  $("body *").each((_, el) => ATTRS.forEach((a) => $(el).attr(a) && add($(el).attr(a))));
  const visit = (el) => {
    if (["script", "style", "svg", "pre", "noscript"].includes(el.name)) return;
    const kids = el.children || [];
    const hasText = kids.some((c) => c.type === "text" && c.data.trim());
    const onlyInline = kids.every((c) => c.type === "text" || c.type === "comment" || (c.type === "tag" && INLINE.has(c.name)));
    if (hasText && onlyInline) return add(innerOf($, el));
    kids.forEach((c) => c.type === "tag" && visit(c));
  };
  visit($("body")[0]);
  // textos del script de precios
  $("script").each((_, el) => {
    const t = $(el).html() || "";
    if (t.includes("var P={")) for (const m of t.matchAll(/"([^"]*[A-Za-z][^"]*)"/g)) if (!m[1].startsWith("€") && m[1] !== "pro-price" && /\s/.test(m[1]) || m[1] === "/ year" || m[1] === "/ month") add(m[1]);
  });
  return out;
}

function translatePage(page, lang, tr) {
  const $ = load(`docs/en/${file("en", page)}`);
  // la fuente en/ ya puede llevar el selector nuevo: se sustituye por un marcador antes de traducir
  const swOld = $("details:has(summary[aria-label='Idioma / Language'])").first();
  if (swOld.length) swOld.replaceWith('<div data-langsw="1"></div>');
  else $("[aria-label='Idioma / Language'], [aria-label='Language']").first().attr("data-langsw", "1");
  // botón "Download for <SO>" (lo rellena download.js)
  const DL = { de: "Herunterladen für", fr: "Télécharger pour", it: "Scarica per", "pt-BR": "Baixar para", "zh-CN": "下载：", ja: "ダウンロード：", ru: "Скачать для" };
  $("[data-label]").attr("data-label", DL[lang]);
  const T = (s) => {
    const k = s.trim();
    const v = tr[k];
    if (v == null) throw new Error(`Falta traducción (${lang}/${page}): ${k.slice(0, 70)}`);
    return s.replace(k, () => v);
  };
  const tv = (s) => (s && s.trim() ? T(s) : s);
  $("title").html(tv($("title").html()));
  for (const sel of ["meta[name=description]", "meta[property='og:title']", "meta[property='og:description']", "meta[name='twitter:title']", "meta[name='twitter:description']"])
    $(sel).each((_, el) => $(el).attr("content", tv($(el).attr("content"))));
  $("body *").each((_, el) => ATTRS.forEach((a) => $(el).attr(a) && $(el).attr(a, tv($(el).attr(a)))));
  const visit = (el) => {
    if (["script", "style", "svg", "pre", "noscript"].includes(el.name)) return;
    const kids = el.children || [];
    const hasText = kids.some((c) => c.type === "text" && c.data.trim());
    const onlyInline = kids.every((c) => c.type === "text" || c.type === "comment" || (c.type === "tag" && INLINE.has(c.name)));
    if (hasText && onlyInline) return void $(el).html(tv($(el).html()));
    kids.forEach((c) => c.type === "tag" && visit(c));
  };
  visit($("body")[0]);
  $("script").each((_, el) => {
    const t = $(el).html() || "";
    if (t.includes("var P={"))
      $(el).html(t.replace(/"([^"]*[A-Za-z][^"]*)"/g, (m, s) => (!s.startsWith("€") && (/\s/.test(s) || s === "/ year" || s === "/ month") && tr[s.trim()] != null ? JSON.stringify(tr[s.trim()]) : m)));
  });
  return $;
}

/** Selector de idioma + hreflang + canonical + lang, para cualquier página. */
function finish($, lang, page) {
  const meta = LANGS.find((l) => l.id === lang);
  $("html").attr("lang", lang);
  $("link[rel=canonical]").attr("href", url(lang, page));
  $("link[rel=alternate][hreflang]").remove();
  const alts = LANGS.map((l) => `<link rel="alternate" hreflang="${l.id}" href="${url(l.id, page)}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${url("en", page)}">`;
  $("link[rel=canonical]").after("\n" + alts);
  $("meta[property='og:url']").attr("content", url(lang, page));
  $("meta[property='og:locale']").remove();
  $("meta[property='og:url']").after(`<meta property="og:locale" content="${meta.og}">`);
  // selector: sustituye el bloque ES/EN existente
  let sw = $("[data-langsw], [aria-label='Idioma / Language'], [aria-label='Language']").first();
  // si lo encontrado es el <summary> de un selector ya existente, se sustituye el <details> entero (si no, se anida uno nuevo en cada ejecución)
  if (sw.is("summary")) sw = sw.parent("details");
  const items = LANGS.map((l) =>
    l.id === lang
      ? `<span class="block rounded-md bg-white/10 px-3 py-1.5 text-white" aria-current="true">${l.name}</span>`
      : `<a class="block rounded-md px-3 py-1.5 text-zinc-300 transition hover:bg-white/10 hover:text-white" href="${rel(lang, l.id, page)}" hreflang="${l.id}" lang="${l.id}">${l.name}</a>`,
  ).join("");
  const html = `<details class="group relative text-xs font-medium"><summary class="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-zinc-300 transition hover:text-white [&::-webkit-details-marker]:hidden" aria-label="Idioma / Language"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>${meta.label}</summary><div class="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-white/10 bg-[#0a0a0a] p-1.5 shadow-2xl">${items}</div></details>`;
  if (!sw.length) throw new Error(`Sin selector de idioma en ${lang}/${page}`);
  if ($("script[src*='cdn.tailwindcss']").length) return void sw.replaceWith(html);
  // páginas con style.css (sin Tailwind): menú propio (.lang-dd)
  const items2 = LANGS.map((l) =>
    l.id === lang ? `<span aria-current="true">${l.name}</span>` : `<a href="${rel(lang, l.id, page)}" hreflang="${l.id}" lang="${l.id}">${l.name}</a>`,
  ).join("");
  sw.replaceWith(`<details class="lang-dd"><summary aria-label="Idioma / Language"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>${meta.label}</summary><div>${items2}</div></details>`);
}

const mode = process.argv[2];
if (mode === "extract") {
  const all = new Map();
  for (const p of Object.keys(PAGES)) for (const s of segmentsOf(p)) all.set(s, true);
  const obj = Object.fromEntries([...all.keys()].map((k) => [k, k]));
  writeFileSync("scripts/site-i18n/segments.json", JSON.stringify(obj, null, 1));
  console.log(Object.keys(obj).length, "segmentos");
} else if (mode === "build") {
  for (const l of NEW) {
    const tp = `scripts/site-i18n/tr/${l.id}.json`;
    if (!existsSync(tp)) { console.warn("sin traducción:", l.id); continue; }
    const tr = JSON.parse(readFileSync(tp, "utf8"));
    mkdirSync(`docs/${l.id}`, { recursive: true });
    for (const p of Object.keys(PAGES)) {
      const $ = translatePage(p, l.id, tr);
      finish($, l.id, p);
      writeFileSync(`docs/${l.id}/${file(l.id, p)}`, $.html());
    }
  }
  // es / en: solo selector + hreflang
  for (const lang of ["es", "en"])
    for (const p of Object.keys(PAGES)) {
      const path = `docs/${dir(lang)}${file(lang, p)}`;
      const $ = load(path);
      finish($, lang, p);
      writeFileSync(path, $.html());
    }
  const today = new Date().toISOString().slice(0, 10);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;
  for (const p of Object.keys(PAGES))
    for (const l of LANGS) {
      xml += `<url><loc>${url(l.id, p)}</loc><lastmod>${today}</lastmod>\n`;
      for (const a of LANGS) xml += `<xhtml:link rel="alternate" hreflang="${a.id}" href="${url(a.id, p)}"/>\n`;
      xml += `<xhtml:link rel="alternate" hreflang="x-default" href="${url("en", p)}"/></url>\n`;
    }
  writeFileSync("docs/sitemap.xml", xml + "</urlset>\n");
  console.log("web generada");
} else console.log("uso: extract | build");
