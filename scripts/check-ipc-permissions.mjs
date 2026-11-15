// Comprueba que generate_handler! (main.rs), build.rs (AppManifest) y capabilities/default.json listan los mismos comandos.
// Uso: node scripts/check-ipc-permissions.mjs
import { readFileSync } from "node:fs";

const main = readFileSync("src-tauri/src/main.rs", "utf8");
const handler = main.match(/generate_handler!\[([\s\S]*?)\]\)/)[1];
const cmds = handler.split(",").map((s) => s.trim().split("::").pop()).filter(Boolean);
const build = readFileSync("src-tauri/build.rs", "utf8");
const inBuild = [...build.matchAll(/^\s*"([a-z0-9_]+)",\s*$/gm)].map((m) => m[1]);
const cap = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
const inCap = cap.permissions.filter((p) => p.startsWith("allow-")).map((p) => p.slice(6).replaceAll("-", "_"));

let bad = false;
const diff = (name, a, b) => {
  const miss = a.filter((x) => !b.includes(x));
  if (miss.length) { bad = true; console.error(`Faltan en ${name}: ${miss.join(", ")}`); }
};
diff("build.rs", cmds, inBuild); diff("capabilities", cmds, inCap);
diff("generate_handler", inBuild, cmds); diff("generate_handler (capabilities)", inCap, cmds);
console.log(`${cmds.length} comandos; ${bad ? "DESAJUSTE" : "OK"}`);
process.exit(bad ? 1 : 0);
