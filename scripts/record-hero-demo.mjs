// Genera docs/media/hero-demo.mp4 grabando la app real (vite dev en :1420) con datos inventados.
// Uso: npm i playwright-core en una carpeta aparte, mkdir frames, node rec.mjs; luego ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=30,format=yuv420p" -c:v libx264 -crf 23 -movflags +faststart -an hero-demo.mp4
// El comando nativo execute_request (Rust) se simula en el navegador; el resto es la interfaz real.
import fs from "node:fs";
import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const c = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
await c.addInitScript(() => {
  // La app real corre en el navegador; el comando nativo `execute_request` (Rust) se simula con datos inventados.
  const resp = { id: "PED-20418", cliente: "Marta Ruiz", mesa: 7, estado: "preparando",
    items: [{ sku: "CAF-LATTE", nombre: "Latte grande", cantidad: 2, precio: 3.2 }, { sku: "TOS-AGUACATE", nombre: "Tostada de aguacate", cantidad: 1, precio: 5.0 }],
    total: 11.4, moneda: "EUR", creado: "2026-11-15T10:42:07Z" };
  const body = JSON.stringify(resp);
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => { const k = Math.random(); window["_" + k] = f; return k; },
    invoke: async (cmd) => {
      if (cmd !== "execute_request") throw new Error("no disponible: " + cmd);
      await new Promise((r) => setTimeout(r, 420));
      return { status: 201, statusText: "Created", timeMs: 142, sizeBytes: body.length, truncated: false,
        headers: [["content-type", "application/json; charset=utf-8"], ["x-request-id", "req_7f3a91c2"], ["cache-control", "no-store"], ["server", "cloudflare"]],
        body, pretty: JSON.stringify(resp, null, 2),
        timeline: [{ id: "dns", label: "DNS", ms: 18, detail: "api.cafeteria-luna.dev" }, { id: "conn", label: "Conexión", ms: 41, detail: "TLS 1.3" }, { id: "wait", label: "Espera", ms: 76, detail: "" }, { id: "dl", label: "Descarga", ms: 7, detail: "" }] };
    },
  };
  // Cursor visible en el vídeo.
  addEventListener("DOMContentLoaded", () => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 3px rgba(240,136,62,.55);pointer-events:none;left:-40px;top:-40px;transition:transform .08s";
    document.body.appendChild(d);
    addEventListener("mousemove", (e) => { d.style.left = e.clientX - 9 + "px"; d.style.top = e.clientY - 9 + "px"; });
    addEventListener("mousedown", () => (d.style.transform = "scale(.7)"));
    addEventListener("mouseup", () => (d.style.transform = "scale(1)"));
  });
});
const p = await c.newPage();
await p.goto("http://localhost:1420"); await p.waitForTimeout(1200);
for (const cb of await p.locator("input[type=checkbox]").all()) await cb.check();
await p.getByText("Continuar como Invitado").click(); await p.waitForTimeout(1500);
import("node:fs").then(()=>{});
const t0 = Date.now();
let rec = true; const frames = [];
const loop = (async () => { while (rec) { const t = Date.now(); const f = `frames/f${String(frames.length).padStart(5,"0")}.jpg`; await p.screenshot({ path: f, type: "jpeg", quality: 88 }); frames.push([f, t]); } })();
const mv = async (loc, steps = 25) => { const bb = await loc.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps }); };
const url = p.locator(`input[placeholder*="cURL"]`).first();
await p.mouse.move(640, 500); await p.waitForTimeout(900);
await mv(url); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(500);
await p.keyboard.insertText(`curl -X POST https://api.cafeteria-luna.dev/v1/pedidos -H 'Authorization: Bearer demo_token_9f2c' -H 'Content-Type: application/json' -d '{"cliente":"Marta Ruiz","mesa":7,"items":[{"sku":"CAF-LATTE","cantidad":2},{"sku":"TOS-AGUACATE","cantidad":1}]}'`);
await p.waitForTimeout(2200);
await p.mouse.move(521, 126, { steps: 25 }); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(2200);
await mv(p.getByRole("button", { name: /send/i }).first()); await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(2800);
await mv(p.getByText(/^headers\s*\d*$/i).last()); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1800);
await mv(p.getByText(/^body$/i).last()); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(2200);
console.log("segundos grabados tras login:", (Date.now() - t0) / 1000);
rec = false; await loop; await p.screenshot({ path: "final.png" });
fs.writeFileSync("frames.txt", frames.map(([f,t],i)=>`file '${f}'\nduration ${(((frames[i+1]?.[1]??t+80)-t)/1000).toFixed(3)}`).join("\n")+`\nfile '${frames.at(-1)[0]}'\n`);
await c.close(); await b.close();
