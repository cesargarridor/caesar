#!/usr/bin/env node
// Publica una versión nueva: rama release/vX.Y.Z -> commit con el cambio de versión -> merge a master -> tag -> push.
// El tag dispara el workflow "Release" de GitHub Actions, que compila e instala las builds firmadas
// y las publica en GitHub Releases (de ahí las recogen las apps instaladas con actualización automática).
//
// Uso:  node scripts/release.mjs "mensaje del cambio" [patch|minor|major|X.Y.Z] [--no-push]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const noPush = process.argv.includes("--no-push");
const message = args[0];
const bump = args[1] ?? "patch";
if (!message) {
  console.error('Uso: node scripts/release.mjs "mensaje" [patch|minor|major|X.Y.Z] [--no-push]');
  process.exit(1);
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const read = (p) => readFileSync(p, "utf8");
const write = (p, s) => writeFileSync(p, s);

// ── versión siguiente ──
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
const current = conf.version;
const [maj, min, pat] = current.split(".").map(Number);
let next;
if (/^\d+\.\d+\.\d+$/.test(bump)) next = bump;
else if (bump === "major") next = `${maj + 1}.0.0`;
else if (bump === "minor") next = `${maj}.${min + 1}.0`;
else next = `${maj}.${min}.${pat + 1}`;
const tag = `v${next}`;
const branch = `release/${tag}`;

// ── comprobaciones ──
const main = git("symbolic-ref", "--short", "HEAD");
if (main !== "master") throw new Error(`Hay que estar en 'master' (ahora: ${main}).`);
// Con el árbol limpio (p. ej. tras fusionar develop en master) también se publica: el cambio de versión ya es un commit.
if (!git("status", "--porcelain") && git("rev-list", "--count", "origin/master..master") === "0") throw new Error("No hay nada que publicar.");
if (git("tag", "--list", tag)) throw new Error(`El tag ${tag} ya existe.`);

// ── rama + cambio de versión ──
git("switch", "-c", branch);
try {
  const setJson = (p, fn) => {
    const j = JSON.parse(read(p));
    fn(j);
    write(p, JSON.stringify(j, null, 2) + "\n");
  };
  setJson("package.json", (j) => (j.version = next));
  setJson("src-tauri/tauri.conf.json", (j) => (j.version = next));
  try {
    setJson("package-lock.json", (j) => {
      j.version = next;
      if (j.packages?.[""]) j.packages[""].version = next;
    });
  } catch {
    /* sin package-lock */
  }
  write("src-tauri/Cargo.toml", read("src-tauri/Cargo.toml").replace(/^version = ".*"$/m, `version = "${next}"`));
  try {
    write(
      "src-tauri/Cargo.lock",
      read("src-tauri/Cargo.lock").replace(/(name = "caesar"\r?\nversion = )"[^"]*"/, `$1"${next}"`),
    );
  } catch {
    /* sin Cargo.lock */
  }

  git("add", "-A");
  git("commit", "-m", `${tag}: ${message}`);
  git("switch", "master");
  git("merge", "--no-ff", branch, "-m", `Merge ${branch}`);
  git("tag", "-a", tag, "-m", `Caesar ${tag}`);
  git("branch", "-d", branch);
} catch (e) {
  console.error(`\nFalló la publicación: ${e.message}\nEstás en: ${git("symbolic-ref", "--short", "HEAD")}`);
  process.exit(1);
}

if (noPush) {
  console.log(`\n${tag} creada en local (sin push). Para publicar: git push origin master ${tag}`);
} else {
  git("push", "origin", "master", tag);
  console.log(`\n${tag} publicada. GitHub Actions está compilando: https://github.com/cesargarridor/caesar/actions`);
}
