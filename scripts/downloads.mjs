#!/usr/bin/env node
// Descargas totales de Caesar: GitHub Releases (exe, msi, dmg, AppImage, deb…) + Snap Store (instalaciones).
// Uso: node scripts/downloads.mjs
//   · GitHub: usa `gh` (autenticado) o la API pública; suma download_count de cada instalador (sin .sig ni latest.json).
//   · Snap Store: necesita `snapcraft` con sesión iniciada (snapcraft login) o SNAPCRAFT_STORE_CREDENTIALS; si no, se avisa y se omite.
import { execFileSync } from "node:child_process";

const REPO = "cesargarridor/caesar";
const run = (cmd, args, env) => execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });

let releases;
try {
  releases = JSON.parse(run("gh", ["api", `repos/${REPO}/releases`, "--paginate", "--slurp"])).flat();
} catch {
  releases = await (await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`)).json();
}
const kind = (n) =>
  /\.(sig)$/.test(n) || /^latest.*\.json$/.test(n) ? null
  : /\.exe$|\.msi$/.test(n) ? "Windows"
  : /\.dmg$|\.app\.tar\.gz$/.test(n) ? "macOS"
  : /\.AppImage$|\.deb$|\.rpm$/.test(n) ? "Linux" : null;
const by = { Windows: 0, macOS: 0, Linux: 0 };
const perRelease = [];
for (const r of releases) {
  let sum = 0;
  for (const a of r.assets ?? []) {
    const k = kind(a.name);
    if (k && !/\.app\.tar\.gz$/.test(a.name)) { by[k] += a.download_count; sum += a.download_count; }
  }
  perRelease.push([r.tag_name, sum]);
}
const gh = Object.values(by).reduce((a, b) => a + b, 0);

let snap = null;
try {
  const out = run("snapcraft", ["metrics", "caesar", "--name", "installed_base_by_channel", "--format", "json"]);
  const j = JSON.parse(out);
  // última serie: suma de instalaciones activas en el último día disponible
  const series = j.series ?? [];
  const last = series.map((s) => s.values?.filter((v) => v != null).slice(-1)[0] ?? 0);
  snap = last.reduce((a, b) => a + b, 0);
} catch {
  /* sin acceso a la Snap Store */
}

console.log("Descargas por versión (GitHub):");
for (const [t, n] of perRelease.slice(0, 10)) console.log(`  ${t.padEnd(10)} ${n}`);
console.log(`\nGitHub Releases: ${gh}  (Windows ${by.Windows} · macOS ${by.macOS} · Linux ${by.Linux})`);
console.log(snap == null ? "Snap Store: sin datos (ejecuta `snapcraft login` o define SNAPCRAFT_STORE_CREDENTIALS)" : `Snap Store: ${snap} instalaciones activas`);
console.log(`TOTAL: ${gh + (snap ?? 0)}`);
