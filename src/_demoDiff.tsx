// TEMPORAL: harness para grabar el modal de conflictos con datos inventados. Borrar tras grabar.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { AccountProvider } from "./lib/account";
import { initTheme } from "./lib/themes";
import { applyFonts, loadFonts } from "./lib/prefs";
import { applyFontFamily, loadFontId } from "./lib/fonts";
import { ConflictBanner } from "./components/ConflictBanner";
import ConflictDiffModal from "./components/ConflictDiffModal";

initTheme(); applyFonts(loadFonts()); applyFontFamily(loadFontId());

const cloud = JSON.stringify({ name: "Cafetería Luna API", version: 12, baseUrl: "https://api.cafeteria-luna.dev",
  requests: [
    { name: "Crear pedido", method: "POST", url: "{{base}}/v1/pedidos", timeoutMs: 5000, headers: { Authorization: "Bearer {{token}}" } },
    { name: "Listar mesas", method: "GET", url: "{{base}}/v1/mesas" },
    { name: "Cobrar pedido", method: "POST", url: "{{base}}/v1/pedidos/{id}/cobro" },
  ] });
const local = JSON.stringify({ name: "Cafetería Luna API", version: 12, baseUrl: "https://api.cafeteria-luna.dev",
  requests: [
    { name: "Crear pedido", method: "POST", url: "{{base}}/v1/pedidos", timeoutMs: 8000, headers: { Authorization: "Bearer {{token}}", "X-Idempotency-Key": "{{$uuid}}" } },
    { name: "Mesas libres", method: "GET", url: "{{base}}/v1/mesas?estado=libre" },
    { name: "Cobrar pedido", method: "POST", url: "{{base}}/v1/pedidos/{id}/cobro" },
  ] });

function Demo() {
  const [banner, setBanner] = useState(false);
  const [diff, setDiff] = useState(false);
  useEffect(() => { const f = () => setBanner(true); addEventListener("demo-banner", f); return () => removeEventListener("demo-banner", f); }, []);
  const done = () => { setDiff(false); setBanner(false); };
  return (
    <>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 60 }}>
        <div style={{ pointerEvents: "auto", position: "absolute", inset: 0 }}>
          {banner && <ConflictBanner items={[{ key: "x", name: "Cafetería Luna API", onDiff: () => setDiff(true), onKeepCloud: done, onForce: done }]} />}
        </div>
      </div>
      {diff && <ConflictDiffModal name="Cafetería Luna API" cloud={cloud} local={local} onClose={() => setDiff(false)} onKeepCloud={done} onForce={done} />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode><ToastProvider><AccountProvider><App /><Demo /></AccountProvider></ToastProvider></StrictMode>,
);
