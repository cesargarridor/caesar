import { useRef, useState } from "react";
import { FileSpreadsheet, Play, Square, X } from "lucide-react";
import { executeRequest, runnerPickCsv, type CsvData } from "../api";
import type { KV, TreeNode } from "../types";
import { buildExecuteArgs, requestFromNode, resolveInherit } from "../lib/request";
import { SIGNED_TYPES, signRequest } from "../lib/authSign";
import { runScript } from "../lib/script";
import { t } from "../lib/i18n";

interface Item { name: string; path: string; node: Extract<TreeNode, { type: "request" }> }
interface Row { n: number; label: string; request: string; status: number | null; ms: number; size: number; ok: boolean; note: string }

const btn = "rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50 bg-[var(--t-iris)]";
const ghost = "rounded-xl px-4 py-2 text-sm font-medium text-mist ring-1 ring-fg/30 hover:ring-fg/60 disabled:opacity-50";

/** Peticiones HTTP de la carpeta (en orden), con su ruta para heredar la autorización. */
function flatten(nodes: TreeNode[], base: string): Item[] {
  return nodes.flatMap((n, i) => {
    const path = `${base}/${i}`;
    if (n.type === "folder") return flatten(n.children, path);
    return n.kind === "ws" ? [] : [{ name: n.name, path, node: n }];
  });
}

const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

interface Props {
  folder: Extract<TreeNode, { type: "folder" }>;
  path: string;
  /** Todas las colecciones (para heredar la autorización) y las variables ya mezcladas (globales + colección + perfil). */
  collections: TreeNode[];
  baseVars: KV[];
  onClose: () => void;
}

/** Collection Runner: ejecuta cada petición de la carpeta por cada fila del CSV, inyectando las columnas como variables. */
export default function RunnerDialog({ folder, path, collections, baseVars, onClose }: Props) {
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stop = useRef(false);
  const items = flatten(folder.children, path);
  const total = (csv?.rows.length ?? 1) * items.length;

  const pick = async () => {
    setErr(null);
    try {
      const d = await runnerPickCsv();
      if (d) { setCsv(d); setRows([]); }
    } catch (e) {
      setErr(typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));
    }
  };

  const run = async () => {
    if (!csv || running || items.length === 0) return;
    stop.current = false;
    setRunning(true);
    setRows([]);
    let n = 0;
    outer: for (let r = 0; r < csv.rows.length; r++) {
      // Las columnas del CSV van al final: pisan a cualquier variable con el mismo nombre. Lo que crea un script sigue vivo en esa fila.
      const rowVars: KV[] = csv.headers.map((h, j) => ({ key: h, value: csv.rows[r][j] ?? "", enabled: true }));
      for (const it of items) {
        if (stop.current) break outer;
        const req = requestFromNode(it.node);
        const auth = resolveInherit(req.auth, collections, it.path);
        const vars = [...baseVars, ...rowVars];
        const row: Row = { n: ++n, label: String(csv.rows[r][0] ?? r + 1), request: it.name, status: null, ms: 0, size: 0, ok: false, note: "" };
        try {
          const base = buildExecuteArgs({ ...req, auth }, vars);
          const args = SIGNED_TYPES.includes(auth.type) ? await signRequest(auth, base, vars, executeRequest) : base;
          const res = await executeRequest(args);
          row.status = res.status;
          row.ms = res.timeMs;
          row.size = res.sizeBytes;
          row.ok = res.status < 400;
          if (req.tests?.trim()) {
            const working = new Map(vars.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value]));
            const sc = runScript(req.tests, { body: res.body, status: res.status, statusText: res.statusText, timeMs: res.timeMs, headers: res.headers, vars: working });
            for (const s of sc.sets) {
              const i = rowVars.findIndex((v) => v.key === s.key);
              if (i >= 0) rowVars[i] = { ...rowVars[i], value: s.value }; else rowVars.push({ key: s.key, value: s.value, enabled: true });
            }
            const failed = sc.tests.filter((x) => !x.ok).length;
            if (sc.tests.length) row.note = `${sc.tests.length - failed}/${sc.tests.length} tests`;
            if (failed || sc.errors.length) row.ok = false;
          }
        } catch (e) {
          row.note = typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido");
        }
        setRows((cur) => [...cur, row]);
      }
    }
    setRunning(false);
  };

  const okN = rows.filter((r) => r.ok).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={t("Collection Runner")}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-2xl bg-kelp p-5 ring-1 ring-fg/15">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-base font-medium text-mist">{t("Collection Runner")} · {folder.name}</h2>
          <button onClick={() => { stop.current = true; onClose(); }} className="text-slate hover:text-mist" aria-label={t("Cerrar")}><X size={18} /></button>
        </div>

        <>
            <p className="text-xs text-slate">{t("Elige un CSV: la primera fila son los nombres de columna. Cada fila ejecuta las {0} petición(es) de esta carpeta, y cada columna se usa como variable (por ejemplo {{id}}).", items.length)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button className={ghost} onClick={pick} disabled={running}><FileSpreadsheet size={14} className="mr-2 inline" />{csv ? t("Cambiar CSV") : t("Elegir CSV")}</button>
              {csv && !running && <button className={btn} onClick={run} disabled={items.length === 0}><Play size={14} className="mr-2 inline" />{t("Ejecutar")}</button>}
              {running && <button className={ghost} onClick={() => { stop.current = true; }}><Square size={14} className="mr-2 inline" />{t("Detener")}</button>}
              {csv && <span className="text-xs text-slate">{csv.name} · {csv.rows.length} {t("filas")}{csv.truncated ? ` (${t("recortado")})` : ""}</span>}
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
            {items.length === 0 && <p className="text-xs text-red-400">{t("Esta carpeta no tiene peticiones HTTP.")}</p>}

            {csv && rows.length === 0 && (
              <div className="min-h-0 overflow-auto rounded-xl ring-1 ring-fg/10">
                <table className="w-full text-left text-xs text-silver">
                  <thead className="bg-deep text-slate"><tr>{csv.headers.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{`{{${h}}}`}</th>)}</tr></thead>
                  <tbody>{csv.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-fg/10">{r.map((c, j) => <td key={j} className="max-w-[12rem] truncate px-3 py-1.5">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}

            {rows.length > 0 && (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10"><div className="h-full rounded-full bg-[var(--t-iris)] transition-all" style={{ width: `${Math.min(100, (rows.length / total) * 100)}%` }} /></div>
                <p className="text-xs text-slate" role="status">{rows.length}/{total} · {okN} OK · {rows.length - okN} {t("con fallo")}</p>
                <div className="min-h-0 overflow-auto rounded-xl ring-1 ring-fg/10">
                  <table className="w-full text-left text-xs text-silver">
                    <thead className="sticky top-0 bg-deep text-slate"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">{t("Fila")}</th><th className="px-3 py-2">{t("Petición")}</th><th className="px-3 py-2">{t("Estado")}</th><th className="px-3 py-2">{t("Tiempo")}</th><th className="px-3 py-2">{t("Tamaño")}</th><th className="px-3 py-2" /></tr></thead>
                    <tbody>
                      {rows.slice(-1000).map((r) => (
                        <tr key={r.n} className="border-t border-fg/10">
                          <td className="px-3 py-1.5 text-slate">{r.n}</td>
                          <td className="max-w-[8rem] truncate px-3 py-1.5">{r.label}</td>
                          <td className="max-w-[10rem] truncate px-3 py-1.5">{r.request}</td>
                          <td className={`px-3 py-1.5 font-medium ${r.ok ? "text-emerald-400" : "text-red-400"}`}>{r.status ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.ms} ms</td>
                          <td className="px-3 py-1.5">{fmtSize(r.size)}</td>
                          <td className="max-w-[12rem] truncate px-3 py-1.5 text-slate" title={r.note}>{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
        </>
      </div>
    </div>
  );
}
