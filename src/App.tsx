import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import BrainLoader from "./components/BrainLoader";
import SettingsModal from "./components/SettingsModal";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import RequestBar from "./components/RequestBar";
import RequestTabs from "./components/RequestTabs";
import ResponsePanel from "./components/ResponsePanel";
import {
  appVersion, checkUpdate, executeRequest, importPostmanCollection, installUpdate, onUpdateProgress, saveTextFile,
} from "./api";
import UpdateOverlay from "./components/UpdateOverlay";
import { applyTheme, loadThemeId, saveThemeId } from "./lib/themes";
import { generateCurl } from "./lib/curlOut";
import { emptyRequest, parseCurl } from "./lib/curl";
import { buildExecuteArgs, requestFromNode } from "./lib/request";
import { applyUrlEdit, buildUrl } from "./lib/url";
import { exportCollection, safeFileName } from "./lib/postmanExport";
import {
  addChild, getAt, newFolderNode, newRequestNode, nodeFromRequest, removeAt, renameAt, suggestName, updateAt,
} from "./lib/tree";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { runScript, type ScriptResult } from "./lib/script";
import { installFindShortcut } from "./lib/find";
import {
  applyFonts, loadAutoUpdate, loadFonts, loadHideEmpty, loadSidebarWidth, saveAutoUpdate, saveFonts, saveHideEmpty,
  saveSidebarWidth, type FontPrefs,
} from "./lib/prefs";
import type { KV, ProgressEvent, RequestNode, RequestState, ResponseData, StepState, Tab, TreeNode, UpdateState } from "./types";

const STEP_DEFS = [
  { id: "validate", label: "Validando petición" },
  { id: "dns", label: "Resolviendo DNS" },
  { id: "request", label: "Conectando y esperando respuesta" },
  { id: "download", label: "Descargando respuesta" },
  { id: "process", label: "Procesando respuesta" },
];
const freshSteps = (): StepState[] => STEP_DEFS.map((s) => ({ ...s, state: "pending", ms: 0, detail: "" }));

// Campo de estrellas (posiciones fijas, generadas una vez)
const STARS = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 70 }, () => `${Math.floor(rnd() * 2200)}px ${Math.floor(rnd() * 1400)}px 0 0 currentColor`).join(", ");
})();

const errMsg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Error desconocido");

// Persistencia local (solo comodidad; si falla, la app sigue funcionando).
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* cuota o almacenamiento no disponible */
  }
}

let idSeq = 0;
const newId = () => `t${Date.now().toString(36)}${(idSeq++).toString(36)}`;
const blankTab = (): Tab => ({ id: newId(), req: emptyRequest(), path: null, name: "Nueva petición", dirty: false });

/** Tabs guardadas: se valida la forma por si el formato cambió. */
function loadTabs(): { tabs: Tab[]; activeId: string } {
  const saved = load<{ tabs?: Tab[]; activeId?: string }>("caesar.tabs", {});
  const tabs = (saved.tabs ?? []).filter(
    (t) => t && typeof t.id === "string" && t.req && typeof t.req.method === "string" && Array.isArray(t.req.params),
  );
  if (tabs.length === 0) {
    const t = blankTab();
    return { tabs: [t], activeId: t.id };
  }
  return { tabs, activeId: tabs.some((t) => t.id === saved.activeId) ? saved.activeId! : tabs[0].id };
}

/** Reajusta la ruta de una pestaña cuando se borra un nodo del árbol (los nodos se direccionan por índice). */
function pathAfterDelete(tabPath: string | null, deleted: string): string | null {
  if (!tabPath) return null;
  const tp = tabPath.split("/");
  const dp = deleted.split("/");
  const pos = dp.length - 1;
  if (tp.length < dp.length) return tabPath;
  if (tp.slice(0, pos).join("/") !== dp.slice(0, pos).join("/")) return tabPath;
  const ti = Number(tp[pos]);
  const di = Number(dp[pos]);
  if (ti === di) return null;
  if (ti > di) tp[pos] = String(ti - 1);
  return tp.join("/");
}

export default function App() {
  const [collections, setCollections] = useState<TreeNode[]>(() => load("caesar.collections", []));
  const [vars, setVars] = useState<KV[]>(() => load("caesar.vars", []));
  const initial = useMemo(loadTabs, []);
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [activeId, setActiveId] = useState(initial.activeId);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Respuestas en memoria, una por pestaña.
  const [results, setResults] = useState<
    Record<string, { response: ResponseData | null; error: string | null; script?: ScriptResult | null }>
  >({});
  const [sending, setSending] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);

  const [themeId, setThemeId] = useState(loadThemeId);
  const [fonts, setFonts] = useState<FontPrefs>(loadFonts);
  const [sidebarW, setSidebarW] = useState(loadSidebarWidth);
  useEffect(() => {
    applyFonts(fonts);
    saveFonts(fonts);
  }, [fonts]);
  useEffect(() => saveSidebarWidth(sidebarW), [sidebarW]);

  const [hideEmpty, setHideEmpty] = useState(loadHideEmpty);
  useEffect(() => saveHideEmpty(hideEmpty), [hideEmpty]);

  // ───── Actualizaciones ─────
  const [autoUpdate, setAutoUpdate] = useState(loadAutoUpdate);
  const [version, setVersion] = useState("");
  const [upd, setUpd] = useState<UpdateState>({ phase: "idle" });
  useEffect(() => saveAutoUpdate(autoUpdate), [autoUpdate]);

  const installNow = async (v: string) => {
    setUpd({ phase: "installing", version: v, downloaded: 0, total: null });
    try {
      await installUpdate(); // al terminar, Rust reinicia la app
    } catch (e) {
      setUpd({ phase: "error", message: errMsg(e) });
    }
  };
  /** auto = comprobación silenciosa al arrancar (instala sola); manual = desde Ajustes. */
  const runCheck = async (auto: boolean) => {
    setUpd({ phase: "checking" });
    try {
      const info = await checkUpdate();
      if (!info) setUpd({ phase: "uptodate" });
      else if (auto) await installNow(info.version);
      else setUpd({ phase: "available", version: info.version, notes: info.notes });
    } catch (e) {
      setUpd(auto ? { phase: "idle" } : { phase: "error", message: errMsg(e) }); // sin red: no molestar
    }
  };
  const checkedOnce = useRef(false);
  useEffect(() => {
    appVersion().then(setVersion).catch(() => {});
    if (checkedOnce.current) return;
    checkedOnce.current = true;
    if (autoUpdate) void runCheck(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let un: (() => void) | undefined;
    onUpdateProgress((p) =>
      setUpd((u) => (u.phase === "installing" ? { ...u, downloaded: p.downloaded, total: p.total } : u)),
    )
      .then((f) => (un = f))
      .catch(() => {});
    return () => un?.();
  }, []);
  const [showSettings, setShowSettings] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const req = active.req;
  /** Colección (carpeta raíz) a la que pertenece la pestaña activa y sus variables; pisan a las globales. */
  const rootIdx = active.path !== null ? Number(active.path.split("/")[0]) : null;
  const rootNode = rootIdx !== null ? collections[rootIdx] : undefined;
  const collVars: KV[] = rootNode && rootNode.type === "folder" ? rootNode.variables ?? [] : [];
  const effVars = useMemo(() => [...vars, ...collVars], [vars, collVars]);
  const res = results[active.id] ?? { response: null, error: null };
  const fullUrl = useMemo(() => buildUrl(req.url, req.params), [req.url, req.params]);

  // ───── persistencia automática (borradores incluidos, aunque no se pulse Guardar) ─────
  useEffect(() => save("caesar.tabs", { tabs, activeId: active.id }), [tabs, active.id]);
  useEffect(() => save("caesar.collections", collections), [collections]);
  useEffect(() => save("caesar.vars", vars), [vars]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);
  /** Feedback en los botones Guardar / cURL: icono de check durante ~2,5 s. */
  const [flash, setFlash] = useState<"save" | "curl" | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // Progreso en vivo emitido por Rust (solo escucha).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<ProgressEvent>("request-progress", (e) => {
      const p = e.payload;
      setSteps((cur) =>
        cur.map((s) =>
          s.id === p.id
            ? { ...s, state: p.state === "done" ? "done" : p.state === "error" ? "error" : "active", ms: p.ms, detail: p.detail || s.detail }
            : s,
        ),
      );
    })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const chooseTheme = (id: string) => {
    setThemeId(id);
    applyTheme(id);
    saveThemeId(id);
  };

  // ───── pestañas ─────
  const patchTab = (id: string, fn: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  const patch = (p: Partial<RequestState>) => patchTab(active.id, (t) => ({ ...t, req: { ...t.req, ...p }, dirty: true }));

  const openTab = (tab: Tab) => {
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  };

  const newTab = () => openTab(blankTab());

  const [pendingClose, setPendingClose] = useState<string | null>(null);
  /** Pide confirmación si la pestaña tiene cambios sin guardar. */
  const requestClose = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (t?.dirty) setPendingClose(id);
    else closeTab(id);
  };
  const closeTab = (id: string) => {
    const i = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    if (rest.length === 0) {
      const t = blankTab();
      setTabs([t]);
      setActiveId(t.id);
    } else {
      setTabs(rest);
      if (id === active.id) setActiveId(rest[Math.min(i, rest.length - 1)].id);
    }
    setResults((r) => {
      const { [id]: _drop, ...others } = r;
      return others;
    });
  };

  /** Abre una petición del árbol: si ya está abierta se activa (conservando el borrador). */
  const handleSelect = (path: string, node: RequestNode) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const tab: Tab = { id: newId(), req: requestFromNode(node), path, name: node.name, dirty: false };
    // Si la pestaña activa es un borrador vacío sin tocar, se reutiliza.
    if (!active.path && !active.dirty && !active.req.url) {
      setTabs((ts) => ts.map((t) => (t.id === active.id ? { ...tab, id: active.id } : t)));
    } else {
      openTab(tab);
    }
  };

  // ───── CRUD de colecciones / carpetas / requests ─────
  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const imported = await importPostmanCollection();
      if (imported) {
        // Las variables de la colección importada viven en la propia colección (no en las globales).
        const root: TreeNode =
          imported.root.type === "folder" ? { ...imported.root, variables: imported.variables } : imported.root;
        setCollections((c) => [...c, root]);
      }
    } catch (e) {
      setImportError(errMsg(e));
    } finally {
      setImporting(false);
    }
  };

  const handleNewCollection = () => {
    setRenamingPath(String(collections.length));
    setCollections((c) => [...c, newFolderNode("Nueva colección")]);
  };

  const handleAddFolder = (path: string) => {
    const { nodes, path: np } = addChild(collections, path, newFolderNode());
    setCollections(nodes);
    setRenamingPath(np);
  };

  const handleAddRequest = (path: string) => {
    const node = newRequestNode();
    const { nodes, path: np } = addChild(collections, path, node);
    setCollections(nodes);
    openTab({ id: newId(), req: requestFromNode(node), path: np, name: node.name, dirty: false });
    setRenamingPath(np);
  };

  const handleRename = (path: string, name: string) => {
    setCollections((c) => renameAt(c, path, name));
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, name } : t)));
    setRenamingPath(null);
  };

  const handleDelete = (path: string) => {
    setCollections((c) => removeAt(c, path));
    // Las pestañas abiertas sobre lo borrado pasan a ser borradores; las demás se reindexan.
    setTabs((ts) =>
      ts.map((t) => {
        const np = pathAfterDelete(t.path, path);
        return np === t.path ? t : { ...t, path: np, dirty: np === null ? true : t.dirty };
      }),
    );
    setRenamingPath(null);
  };

  const handleSave = (tab: Tab = active) => {
    const req = tab.req;
    const current = tab.path ? getAt(collections, tab.path) : null;
    if (tab.path && current && current.type === "request") {
      setCollections((c) => updateAt(c, tab.path!, (n) => nodeFromRequest(n.name, req)));
      patchTab(tab.id, (t) => ({ ...t, dirty: false }));
      setFlash("save");
      return;
    }
    // Borrador: se guarda en la primera colección (o se crea una).
    const node = nodeFromRequest(suggestName(req), req);
    let base = collections;
    let target = "0";
    if (base.length === 0 || base[0].type !== "folder") {
      base = [...base, newFolderNode("Mi colección")];
      target = String(base.length - 1);
    }
    const { nodes, path } = addChild(base, target, node);
    setCollections(nodes);
    patchTab(tab.id, (t) => ({ ...t, path, name: node.name, dirty: false }));
    setFlash("save");
  };

  const handleExport = async (path: string) => {
    const node = getAt(collections, path);
    if (!node) return;
    try {
      const saved = await saveTextFile(safeFileName(node.name), exportCollection(node, vars));
      if (saved) setNotice({ kind: "ok", text: `Colección exportada: ${saved}` });
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    }
  };

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(generateCurl(buildExecuteArgs(req, effVars)));
      setFlash("curl");
    } catch {
      setNotice({ kind: "err", text: "No se pudo copiar al portapapeles." });
    }
  };

  const handleCurl = (text: string) => {
    try {
      const parsed = parseCurl(text);
      patchTab(active.id, (t) => ({ ...t, req: { ...parsed, tests: t.req.tests ?? "" }, dirty: true }));
      setResults((r) => ({ ...r, [active.id]: { response: null, error: null } }));
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    }
  };

  const handleSend = async () => {
    if (sending) return;
    const id = active.id;
    setSending(true);
    setResults((r) => ({ ...r, [id]: { response: null, error: null } }));
    setSteps(freshSteps());
    try {
      const response = await executeRequest(buildExecuteArgs(req, effVars));
      // Tests / automatizaciones post-respuesta (intérprete propio, sin eval ni red).
      let script: ScriptResult | null = null;
      if (req.tests?.trim()) {
        const working = new Map(effVars.filter((v) => v.enabled && v.key).map((v) => [v.key, v.value]));
        script = runScript(req.tests, {
          body: response.body,
          status: response.status,
          statusText: response.statusText,
          timeMs: response.timeMs,
          headers: response.headers,
          vars: working,
        });
        const { sets, unsets } = script;
        if (sets.length || unsets.length) {
          const apply = (cur: KV[], own: (k: string) => boolean, add: boolean) => {
            let next = cur.filter((v) => !(unsets.includes(v.key) && own(v.key)));
            for (const s of sets) {
              if (!own(s.key)) continue;
              next = next.some((v) => v.key === s.key)
                ? next.map((v) => (v.key === s.key ? { ...v, value: s.value, enabled: true } : v))
                : add
                  ? [...next, { key: s.key, value: s.value, enabled: true }]
                  : next;
            }
            return next;
          };
          // Si la variable ya existe en la colección se actualiza ahí; si no, en las globales.
          const inColl = new Set(collVars.map((v) => v.key));
          setVars((cur) => apply(cur, (k) => !inColl.has(k), true));
          if (rootIdx !== null && inColl.size) {
            setCollections((c) =>
              updateAt(c, String(rootIdx), (n) =>
                n.type === "folder" ? { ...n, variables: apply(n.variables ?? [], (k) => inColl.has(k), false) } : n,
              ),
            );
          }
        }
      }
      setResults((r) => ({ ...r, [id]: { response, error: null, script } }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { response: null, error: errMsg(e) } }));
    } finally {
      setSending(false);
    }
  };

  // Atajos globales: Ctrl+S guarda, Ctrl+Enter envía desde CUALQUIER campo (siempre con el estado más reciente).
  const saveRef = useRef(handleSave);
  const sendRef = useRef(handleSend);
  saveRef.current = handleSave;
  sendRef.current = handleSend;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      } else if (e.key === "Enter") {
        e.preventDefault();
        sendRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Ctrl+F: buscador propio en la respuesta y en los editores (evita el buscador nativo del webview).
  useEffect(() => installFindShortcut(), []);

  // Historial de pestañas visitadas: botones laterales del ratón (atrás = 3, adelante = 4) y Alt+←/→.
  const hist = useRef<{ list: string[]; idx: number; nav: boolean }>({ list: [], idx: -1, nav: false });
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active.id);
  activeRef.current = active.id;
  useEffect(() => {
    const h = hist.current;
    if (h.nav) {
      h.nav = false;
      return;
    }
    if (h.list[h.idx] === active.id) return;
    h.list = [...h.list.slice(0, h.idx + 1), active.id].slice(-100);
    h.idx = h.list.length - 1;
  }, [active.id]);
  useEffect(() => {
    const go = (dir: -1 | 1) => {
      const h = hist.current;
      const alive = (id: string) => tabsRef.current.some((t) => t.id === id);
      let i = h.idx + dir;
      while (i >= 0 && i < h.list.length && !alive(h.list[i])) i += dir; // salta pestañas cerradas
      if (i < 0 || i >= h.list.length) return;
      h.idx = i;
      if (h.list[i] === activeRef.current) return; // ya estás en esa pestaña
      h.nav = true;
      setActiveId(h.list[i]);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault(); // evita la navegación nativa del webview
      if (e.type === "mouseup") go(e.button === 3 ? -1 : 1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        go(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("mouseup", onMouse, true);
    window.addEventListener("auxclick", onMouse, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("mouseup", onMouse, true);
      window.removeEventListener("auxclick", onMouse, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar
        collections={collections}
        selectedPath={active.path}
        importing={importing}
        error={importError}
        vars={vars}
        onVars={setVars}
        collName={rootNode && rootNode.type === "folder" ? rootNode.name : null}
        collVars={collVars}
        onCollVars={(v) =>
          rootIdx !== null &&
          setCollections((c) => updateAt(c, String(rootIdx), (n) => (n.type === "folder" ? { ...n, variables: v } : n)))
        }
        onImport={handleImport}
        onNewCollection={handleNewCollection}
        onSettings={() => setShowSettings(true)}
        width={sidebarW}
        onWidth={setSidebarW}
        renaming={renamingPath}
        onSelect={handleSelect}
        onStartRename={setRenamingPath}
        onRename={handleRename}
        onCancelRename={() => setRenamingPath(null)}
        onAddRequest={handleAddRequest}
        onAddFolder={handleAddFolder}
        onDelete={handleDelete}
        onExport={handleExport}
      />
      <div className="aurora-line" />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="stars" style={{ boxShadow: STARS }} aria-hidden />
        <div className="fs-scale fs-request flex min-h-0 flex-1 flex-col">
        <TabBar tabs={tabs} activeId={active.id} onSelect={setActiveId} onClose={requestClose} onNew={newTab} />
        {pendingClose && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-8" onMouseDown={() => setPendingClose(null)}>
            <div className="w-full max-w-md rounded-2xl bg-kelp glass p-7" onMouseDown={(e) => e.stopPropagation()}>
              <h2 className="text-xl text-mist">¿Cerrar sin guardar?</h2>
              <p className="mt-2 text-sm text-slate">
                Esta pestaña tiene cambios sin guardar. Si la cierras, se perderán.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  autoFocus
                  onClick={() => setPendingClose(null)}
                  className="rounded-[10px] px-4 py-2 text-sm text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    closeTab(pendingClose);
                    setPendingClose(null);
                  }}
                  className="rounded-[10px] px-4 py-2 text-sm text-rose ring-1 ring-rose/40 hover:ring-rose"
                >
                  Cerrar sin guardar
                </button>
                <button
                  onClick={() => {
                    const t = tabs.find((x) => x.id === pendingClose);
                    if (t) handleSave(t);
                    closeTab(pendingClose);
                    setPendingClose(null);
                  }}
                  className="btn-aurora px-5 py-2 text-sm font-semibold"
                >
                  Guardar y cerrar
                </button>
              </div>
            </div>
          </div>
        )}
        <RequestBar
          method={req.method}
          url={fullUrl}
          sending={sending}
          onMethod={(method) => patch({ method })}
          onUrlEdit={(full) => patch(applyUrlEdit(full, req.params))}
          onCurl={handleCurl}
          onSend={handleSend}
          onSave={() => handleSave()}
          onCopyCurl={handleCopyCurl}
          flash={flash}
        />
        {notice && (
          <div
            className={`absolute right-4 top-24 z-50 flex max-w-md items-center gap-2 break-all rounded-2xl bg-kelp px-4 py-2.5 text-xs shadow-lg ${
              notice.kind === "ok" ? "text-mist ring-1 ring-leaf/60" : "text-rose ring-1 ring-rose/50"
            }`}
          >
            {notice.kind === "ok" ? <CheckCircle2 size={15} className="shrink-0 text-leaf" /> : <AlertCircle size={15} className="shrink-0" />}
            {notice.text}
          </div>
        )}
        <RequestTabs key={active.id} req={req} patch={patch} />
        </div>
        <ResponsePanel response={res.response} error={res.error} sending={sending} steps={steps} script={res.script ?? null} hideEmpty={hideEmpty} />
        {sending && <BrainLoader steps={steps} />}
        {showSettings && (
          <SettingsModal
            themeId={themeId}
            onTheme={chooseTheme}
            fonts={fonts}
            onFonts={setFonts}
            hideEmpty={hideEmpty}
            onHideEmpty={setHideEmpty}
            updates={{
              version,
              auto: autoUpdate,
              onAuto: setAutoUpdate,
              state: upd,
              onCheck: () => void runCheck(false),
              onInstall: () => upd.phase === "available" && void installNow(upd.version),
            }}
            onClose={() => setShowSettings(false)}
          />
        )}
        {upd.phase === "installing" && <UpdateOverlay version={upd.version} downloaded={upd.downloaded} total={upd.total} />}
      </main>
    </div>
  );
}
