// Genera los manifiestos de winget (Windows) y el cask de Homebrew (macOS) de una versión YA publicada en GitHub Releases.
// Uso: node scripts/package-managers.mjs 1.0.7 [carpeta-salida]   (por defecto packaging/out)
// Descarga los instaladores de la Release, calcula su SHA-256 y escribe:
//   <salida>/winget/manifests/c/CesarGarrido/Caesar/<versión>/*.yaml   → se envía como PR a microsoft/winget-pkgs
//   <salida>/homebrew/Casks/caesar.rb                                   → va al tap cesargarridor/homebrew-caesar
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Uso: node scripts/package-managers.mjs X.Y.Z [carpeta-salida]");
  process.exit(1);
}
const out = process.argv[3] ?? "packaging/out";
const REPO = "cesargarridor/caesar";
const base = `https://github.com/${REPO}/releases/download/v${version}`;
const exeName = `Caesar_${version}_x64-setup.exe`;
const dmgName = `Caesar_${version}_universal.dmg`;

async function sha256(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status} (¿la Release v${version} ya está publicada?)`);
  return createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex");
}

const [exeHash, dmgHash] = await Promise.all([sha256(`${base}/${exeName}`), sha256(`${base}/${dmgName}`)]);
const date = new Date().toISOString().slice(0, 10);

// ── winget ──
const ID = "CesarGarrido.Caesar";
const dir = join(out, "winget", "manifests", "c", "CesarGarrido", "Caesar", version);
mkdirSync(dir, { recursive: true });
const head = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.6.0.schema.json\n\nPackageIdentifier: ${ID}\nPackageVersion: ${version}\n`;
writeFileSync(join(dir, `${ID}.yaml`), head("version") + `DefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.6.0\n`);
writeFileSync(
  join(dir, `${ID}.installer.yaml`),
  head("installer") +
    `InstallerLocale: en-US
Platform:
- Windows.Desktop
MinimumOSVersion: 10.0.17763.0
InstallerType: nsis
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
InstallerSwitches:
  Silent: /S
  SilentWithProgress: /S
UpgradeBehavior: install
ReleaseDate: ${date}
Installers:
- Architecture: x64
  InstallerUrl: ${base}/${exeName}
  InstallerSha256: ${exeHash.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.6.0
`,
);
writeFileSync(
  join(dir, `${ID}.locale.en-US.yaml`),
  head("defaultLocale") +
    `PackageLocale: en-US
Publisher: Cesar Garrido
PublisherUrl: https://github.com/cesargarridor
PublisherSupportUrl: https://github.com/${REPO}/issues
Author: Cesar Garrido
PackageName: Caesar
PackageUrl: https://cesargarridor.github.io/caesar/
License: FSL-1.1-MIT
LicenseUrl: https://github.com/${REPO}/blob/master/LICENSE
Copyright: Copyright (c) Cesar Garrido
ShortDescription: Fast native API client with collections, GraphQL, WebSocket and end-to-end encrypted sync.
Description: Caesar is a native API client (Tauri + Rust) that starts instantly and works offline. Paste a cURL, import OpenAPI or HAR, organise requests in collections, run them with the Collection Runner and sync them with end-to-end encryption.
Moniker: caesar
Tags:
- api
- api-client
- graphql
- http
- rest
- websocket
- postman-alternative
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`,
);

// ── Homebrew ──
const cask = join(out, "homebrew", "Casks");
mkdirSync(cask, { recursive: true });
writeFileSync(
  join(cask, "caesar.rb"),
  `cask "caesar" do
  version "${version}"
  sha256 "${dmgHash}"

  url "https://github.com/${REPO}/releases/download/v#{version}/Caesar_#{version}_universal.dmg"
  name "Caesar"
  desc "Fast native API client with collections, GraphQL, WebSocket and encrypted sync"
  homepage "https://cesargarridor.github.io/caesar/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  app "Caesar.app"

  zap trash: [
    "~/Library/Application Support/app.caesar.client",
    "~/Library/Caches/app.caesar.client",
    "~/Library/Preferences/app.caesar.client.plist",
    "~/Library/Saved Application State/app.caesar.client.savedState",
    "~/Library/WebKit/app.caesar.client",
  ]
end
`,
);
console.log(`winget: ${dir}\nhomebrew: ${join(cask, "caesar.rb")}\nexe ${exeHash}\ndmg ${dmgHash}`);
