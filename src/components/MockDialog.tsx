import { useEffect, useState } from "react";
import { Play, Server, Square, X } from "lucide-react";
import { mockStart, mockStatus, mockStop, onMockHit, type MockHit, type MockRoute } from "../api";
import type { TreeNode } from "../types";
import { t } from "../lib/i18n";

type Req = Extract<TreeNode, { type: "request" }>;
interface Def { id: string; name: string; method: string; path: string; status: number; body: string; delayMs: number }

const btn = "rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50 bg-[var(--t-iris)]";
const ghost = "rounded-xl px-4 py-2 text-sm font-medium text-mist ring-1 ring-fg/30 hover:ring-fg/60 disabled:opacity-50";
const field = "rounded-lg bg-deep px-2 py-1.5 text-xs text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua";

/** `{{baseUrl}}/items?x=1` o `https://api.x.com/items` → `/items` (las variables de ruta se quedan como comodín). */
export function pathOf(url: string): string {
  const p = url.replace(/^\s*(\{\{[^}]+\}\}|https?:\/\/[^/]+)/i, "").split("?")[0].split("#")[0];
  return p.startsWith("/") ? p : `/${p}`;
}

function collect(nodes: TreeNode[], base: string, out: { id: string; node: Req }[]) {
  nodes.forEach((n, i) => {
    if (n.type === "folder") collect(n.children, `${base}/${i}`, out);
    else if (n.kind !== "ws") out.push({ id: `${base}/${i}`, node: n });
  });
}

/** La respuesta por defecto: el cuerpo JSON de la propia petición si lo tiene; si no, un JSON sencillo. */
const defaultBody = (n: Req) => (n.body?.mode === "json" && n.body.raw?.trim() ? n.body.raw : '{\n  "ok": true\n}');

interface Props { folder: Extract<TreeNode, { type: "folder" }>; onClose: () => void }

/** Servidor Mock: convierte las peticiones de la carpeta en rutas de un servidor local con la respuesta que tú escribas. */
export default function MockDialog({ folder, onClose }: Props) {
  const key = `caesar.mock.${folder.uid ?? folder.name}`;
  const [defs, setDefs] = useState<Def[]>(() => {
    const found: { id: string; node: Req }[] = [];
    collect(folder.children, "", found);
    let saved: Record<string, Partial<Def>> = {};
    try { saved = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { /* sin guardado */ }
    return found.map(({ id, node }) => ({ id, name: node.name, method: node.method, path: pathOf(node.url), status: 200, body: defaultBody(node), delayMs: 0, ...saved[id] }));
  });
  const [port, setPort] = useState(4010);
  const [running, setRunning] = useState<number | null>(null);
  const [hits, setHits] = useState<MockHit[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    mockStatus().then((s) => { setRunning(s.running ? s.port : null); setHits(s.hits); }).catch(() => {});
    const un = onMockHit((h) => setHits((l) => [h, ...l].slice(0, 100)));
    return () => { void un.then((f) => f()).catch(() => {}); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(defs.map((d) => [d.id, { path: d.path, status: d.status, body: d.body, delayMs: d.delayMs }])))); } catch { /* sin almacenamiento */ }
  }, [defs, key]);

  const set = (id: string, p: Partial<Def>) => setDefs((l) => l.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const start = async () => {
    setErr(null);
    const routes: MockRoute[] = defs.map((d) => ({ method: d.method, path: d.path, status: d.status, headers: [], body: d.body, delayMs: d.delayMs }));
    try { setRunning(await mockStart(port, routes)); } catch (e) { setErr(typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido")); }
  };
  const stop = async () => { await mockStop().catch(() => {}); setRunning(null); };
  const url = running ? `http://127.0.0.1:${running}` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={t("Servidor Mock")}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-2xl bg-kelp p-5 ring-1 ring-fg/15">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-medium text-mist"><Server size={16} /> {t("Servidor Mock")} · {folder.name}</h2>
          <button onClick={onClose} className="text-slate hover:text-mist" aria-label={t("Cerrar")}><X size={18} /></button>
        </div>
        <p className="text-xs text-slate">{t("Cada petición de la carpeta se convierte en una ruta de un servidor local (solo tu equipo, gratis e ilimitado). Escribe la respuesta que debe dar y apunta tu app a la dirección de abajo.")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate">{t("Puerto")} <input type="number" min={1024} max={65535} className={`${field} ml-1 w-24`} value={port} disabled={running !== null} onChange={(e) => setPort(Number(e.target.value) || 4010)} /></label>
          {running === null ? <button className={btn} onClick={start}><Play size={14} className="mr-2 inline" />{t("Arrancar")}</button> : <button className={ghost} onClick={stop}><Square size={14} className="mr-2 inline" />{t("Parar")}</button>}
          {running !== null && <code className="select-all rounded-lg bg-deep px-2 py-1 text-xs text-aqua">{url}</code>}
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {defs.map((d) => (
            <div key={d.id} className="space-y-1.5 rounded-xl bg-deep p-3 ring-1 ring-fg/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 text-xs font-semibold text-silver">{d.method}</span>
                <input className={`${field} min-w-0 flex-1 font-mono`} value={d.path} onChange={(e) => set(d.id, { path: e.target.value })} aria-label={t("Ruta")} />
                <input className={`${field} w-16`} type="number" value={d.status} onChange={(e) => set(d.id, { status: Number(e.target.value) || 200 })} aria-label={t("Estado")} />
                <input className={`${field} w-20`} type="number" min={0} value={d.delayMs} onChange={(e) => set(d.id, { delayMs: Math.max(0, Number(e.target.value) || 0) })} title={t("Retraso (ms)")} aria-label={t("Retraso (ms)")} />
              </div>
              <textarea className={`${field} h-16 w-full resize-y font-mono`} value={d.body} onChange={(e) => set(d.id, { body: e.target.value })} spellCheck={false} aria-label={t("Respuesta")} />
            </div>
          ))}
          {defs.length === 0 && <p className="text-xs text-red-400">{t("Esta carpeta no tiene peticiones HTTP.")}</p>}
        </div>
        {hits.length > 0 && (
          <div className="max-h-28 overflow-y-auto rounded-xl bg-deep p-2 text-xs text-silver ring-1 ring-fg/10">
            {hits.slice(0, 30).map((h, i) => <div key={i} className="flex gap-2"><span className="w-12 text-slate">{h.method}</span><span className="min-w-0 flex-1 truncate">{h.path}</span><span className={h.status < 400 ? "text-emerald-400" : "text-red-400"}>{h.status}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}
