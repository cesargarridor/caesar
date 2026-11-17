// Worker gratuito: página a la que apuntan los enlaces para compartir peticiones de Caesar.
// Redirige a caesar://share?payload=… (el payload va tras # y nunca llega al servidor).
const PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Caesar</title>
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#272822">
<meta name="description" content="Caesar: cliente API nativo, rápido y con cifrado E2E.">
<meta property="og:title" content="Caesar"><meta property="og:description" content="Abre esta petición en Caesar con un clic.">
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{display:grid;place-items:center;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f8f8f2;background:radial-gradient(1200px 600px at 50% -10%,#3a3b30 0%,#272822 60%)}
main{width:min(92vw,30rem);text-align:center;padding:36px 28px;border:1px solid #ffffff1a;border-radius:18px;background:#2f302700;backdrop-filter:blur(2px)}
.logo{width:56px;height:56px;margin:0 auto 14px;border-radius:14px;background:#a6e22e;color:#1b1c16;display:grid;place-items:center;font:800 28px/1 system-ui}
h1{margin:0 0 .25em;font-size:1.6rem;letter-spacing:-.02em}
p{margin:.4em 0;color:#cfcfc2}
.sub{color:#a8a8a4;font-size:.9rem}
a.btn,button{display:inline-block;margin:1em .3em 0;padding:.7em 1.4em;border:0;border-radius:10px;background:#a6e22e;color:#111;font:600 .95rem system-ui;cursor:pointer;text-decoration:none}
a.btn:hover{filter:brightness(1.08)}
button.alt{background:#3e3d32;color:#f8f8f2}
ul{list-style:none;margin:1.4em 0 0;padding:0;display:grid;gap:.4em;font-size:.88rem;color:#a8a8a4;text-align:left}
li:before{content:"✓";color:#a6e22e;margin-right:.6em}
small{display:block;margin-top:1.4em;color:#a8a8a4}
small a{color:#a6e22e}
</style></head><body><main>
<div class="logo">C</div>
<h1 id="h">Caesar</h1>
<p id="m"></p>
<a class="btn" id="open" href="#"></a><button class="alt" id="copy"></button>
<ul id="f"></ul>
<small><span id="s"></span> <a id="dl" href="https://cesargarridor.github.io/caesar/download.html"></a></small>
<script>
(function(){
var T={
es:{ing:"Abriendo la petición en Caesar…",open:"Abrir en Caesar",copy:"Copiar enlace",ok:"Copiado",ko:"No se pudo copiar",bad:"Este enlace no es válido.",s:"Si no se abre, copia el enlace y pégalo en Caesar con Ctrl/Cmd+V. ¿No tienes Caesar?",dl:"Descárgalo gratis",f:["Nativo y ligero: arranca al instante","Funciona sin conexión","Sincronización con cifrado E2E"]},
en:{ing:"Opening the request in Caesar…",open:"Open in Caesar",copy:"Copy link",ok:"Copied",ko:"Could not copy",bad:"This link is not valid.",s:"If it doesn't open, copy the link and paste it into Caesar with Ctrl/Cmd+V. Don't have Caesar?",dl:"Download it for free",f:["Native and light: starts instantly","Works offline","End-to-end encrypted sync"]},
de:{ing:"Anfrage wird in Caesar geöffnet…",open:"In Caesar öffnen",copy:"Link kopieren",ok:"Kopiert",ko:"Kopieren nicht möglich",bad:"Dieser Link ist ungültig.",s:"Falls sich nichts öffnet: Link kopieren und in Caesar mit Strg/Cmd+V einfügen. Noch kein Caesar?",dl:"Kostenlos herunterladen",f:["Nativ und leicht: startet sofort","Funktioniert offline","Ende-zu-Ende-verschlüsselte Synchronisierung"]},
fr:{ing:"Ouverture de la requête dans Caesar…",open:"Ouvrir dans Caesar",copy:"Copier le lien",ok:"Copié",ko:"Copie impossible",bad:"Ce lien n'est pas valide.",s:"Si rien ne s'ouvre, copiez le lien et collez-le dans Caesar avec Ctrl/Cmd+V. Vous n'avez pas Caesar ?",dl:"Téléchargez-le gratuitement",f:["Natif et léger : démarre instantanément","Fonctionne hors ligne","Synchronisation chiffrée de bout en bout"]},
it:{ing:"Apertura della richiesta in Caesar…",open:"Apri in Caesar",copy:"Copia link",ok:"Copiato",ko:"Impossibile copiare",bad:"Questo link non è valido.",s:"Se non si apre, copia il link e incollalo in Caesar con Ctrl/Cmd+V. Non hai Caesar?",dl:"Scaricalo gratis",f:["Nativo e leggero: parte subito","Funziona offline","Sincronizzazione con crittografia E2E"]},
pt:{ing:"Abrindo a requisição no Caesar…",open:"Abrir no Caesar",copy:"Copiar link",ok:"Copiado",ko:"Não foi possível copiar",bad:"Este link não é válido.",s:"Se não abrir, copie o link e cole no Caesar com Ctrl/Cmd+V. Não tem o Caesar?",dl:"Baixe grátis",f:["Nativo e leve: abre na hora","Funciona offline","Sincronização com criptografia E2E"]}
};
var L=(navigator.language||"es").slice(0,2).toLowerCase(),t=T[L]||T.es;
document.documentElement.lang=T[L]?L:"es";
var $=function(i){return document.getElementById(i)};
$("m").textContent=t.ing;$("open").textContent=t.open;$("copy").textContent=t.copy;$("s").textContent=t.s;$("dl").textContent=t.dl;
$("f").innerHTML=t.f.map(function(x){return "<li>"+x+"</li>"}).join("");
var p=location.hash.slice(1);
if(!/^[A-Za-z0-9._-]{4,}$/.test(p)){$("m").textContent=t.bad;$("open").style.display="none";$("copy").style.display="none";return}
var deep="caesar://share?payload="+p;
$("open").href=deep;
$("copy").onclick=function(){var b=this;(navigator.clipboard?navigator.clipboard.writeText(location.href):Promise.reject()).then(function(){b.textContent=t.ok},function(){b.textContent=t.ko})};
setTimeout(function(){location.href=deep},300);
})();
</script>
</main></body></html>
`;

export default {
  fetch() {
    return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", "x-robots-tag": "noindex" } });
  },
};
