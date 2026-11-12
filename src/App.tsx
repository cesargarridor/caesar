import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import NetworkLoader from "./components/NetworkLoader";
import SettingsModal from "./components/SettingsModal";
import Welcome from "./components/Welcome";
import { isOnboarded } from "./lib/legal";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import RequestBar from "./components/RequestBar";
import RequestTabs from "./components/RequestTabs";
import ResponsePanel from "./components/ResponsePanel";
import VarPicker from "./components/VarPicker";
import { NewCollectionDialog, ShareDialog, ShareWorkspaceDialog, TeamInfoDialog } from "./components/TeamDialogs";
import { hashJson, normCode, teamJson, useTeamSync } from "./lib/useTeamSync";
import { hasTeamCollections, parseWsPayload, useWorkspaceTeam, wsPayloadJson } from "./lib/useWorkspaceTeam";
import {
  DEFAULT_WS, loadWsActive, loadWsList, newWsId, removeWsData, saveWsActive, saveWsList, snapshotAll, wsKey, type WsMeta,
} from "./lib/workspaces";
import {
  appVersion, checkUpdate, executeRequest, syncStatus, teamJoin, teamPublish, teamUnshare, installUpdate, parseCollectionContent, pickTextFile, localSave, onSyncRemote, onUpdateProgress, saveTextFile,
} from "./api";
import UpdateOverlay from "./components/UpdateOverlay";
import UpdatePrompt from "./components/UpdatePrompt";
import { applyTheme, loadThemeId, saveThemeId } from "./lib/themes";
import { generateCurl } from "./lib/curlOut";
import { emptyRequest, parseCurl } from "./lib/curl";
import { buildExecuteArgs, normAuth, requestFromNode, resolveInherit } from "./lib/request";
import { signRequest, SIGNED_TYPES } from "./lib/authSign";
import { applyUrlEdit, buildUrl } from "./lib/url";
import { exportCollection } from "./lib/collectionExport";
import { detectAndParse, exportExt, exportFileName, exportHar, exportYaml, type ExportFormat } from "./lib/interchange";
import {
  addChild, addFolder, ensureIds, getAt, moveCollection, moveNode, moveRelative, newFolderNode, newRequestNode, nodeFromRequest, pathAfterDelete, pathAfterInsert,
  removeAt, renameAt, suggestName, updateAt,
} from "./lib/tree";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { runScript, type ScriptResult } from "./lib/script";
import { installFindShortcut } from "./lib/find";
import { t, useLang } from "./lib/i18n";
import {
  applyFonts, loadAutoUpdate, loadAutosave, saveAutosave, BASE_METHODS, loadExtraMethods, saveExtraMethods, loadFonts, loadHideEmpty, loadSidebarWidth, saveAutoUpdate, saveFonts, saveHideEmpty,
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

const errMsg = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));

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
const blankTab = (): Tab => ({ id: newId(), req: emptyRequest(), path: null, name: t("Nueva petición"), dirty: false });

/** Tabs guardadas: se valida la forma por si el formato cambió. */
function loadTabs(wsId: string): { tabs: Tab[]; activeId: string } {
  const saved = load<{ tabs?: Tab[]; activeId?: string }>(wsKey("tabs", wsId), {});
  const tabs = (saved.tabs ?? []).filter(
    (t) => t && typeof t.id === "string" && t.req && typeof t.req.method === "string" && Array.isArray(t.req.params),
  );
  if (tabs.length === 0) {
    const t = blankTab();
    return { tabs: [t], activeId: t.id };
  }
  return { tabs, activeId: tabs.some((t) => t.id === saved.activeId) ? saved.activeId! : tabs[0].id };
}

export default function App() {
  useLang(); // re-renderiza toda la interfaz al cambiar de idioma
  // Espacios de trabajo: cada uno guarda sus propias colecciones, variables y pestañas (ver lib/workspaces.ts).
  const [wsList, setWsList] = useState<WsMeta[]>(loadWsList);
  const [wsId, setWsId] = useState<string>(() => loadWsActive(wsList));
  useEffect(() => saveWsList(wsList), [wsList]);
  const [collections, setCollections] = useState<TreeNode[]>(() => ensureIds(load(wsKey("collections", wsId), [])));
  /** Carpetas desplegadas (por id estable, no por posición). Las colecciones empiezan abiertas. */
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(collections.flatMap((c) => (c.type === "folder" && c.uid ? [c.uid] : []))),
  );
  const openFolder = (uid?: string) => uid && setOpenIds((s) => (s.has(uid) ? s : new Set(s).add(uid)));
  const toggleFolder = (uid?: string) =>
    uid &&
    setOpenIds((s) => {
      const n = new Set(s);
      if (!n.delete(uid)) n.add(uid);
      return n;
    });
  const [vars, setVars] = useState<KV[]>(() => load(wsKey("vars", wsId), []));
  const initial = useMemo(() => loadTabs(wsId), []);
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
  const [updPrompt, setUpdPrompt] = useState(false);
  const [autosave, setAutosave] = useState(loadAutosave);
  const [extraMethods, setExtraMethods] = useState(loadExtraMethods);
  useEffect(() => saveExtraMethods(extraMethods), [extraMethods]);
  useEffect(() => saveAutosave(autosave), [autosave]);
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
      else {
        setUpd({ phase: "available", version: info.version, current: info.current, notes: info.notes });
        setUpdPrompt(true); // enseña las novedades y deja elegir; ya no se instala a escondidas
      }
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
  const [settingsSection, setSettingsSection] = useState<"ui" | "edit">("ui");
  const [showWelcome, setShowWelcome] = useState(() => !isOnboarded());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const req = active.req;
  /** Colección (carpeta raíz) a la que pertenece la pestaña activa y sus variables; pisan a las globales. */
  const rootIdx = active.path !== null ? Number(active.path.split("/")[0]) : null;
  const rootNode = rootIdx !== null ? collections[rootIdx] : undefined;
  const collVars: KV[] = rootNode && rootNode.type === "folder" ? rootNode.variables ?? [] : [];
  const effVars = useMemo(() => [...vars, ...collVars], [vars, collVars]);
  /** Autorización efectiva: con "Inherit" sube por las carpetas hasta la de la colección. */
  const effAuth = useMemo(() => resolveInherit(req.auth, collections, active.path), [req.auth, collections, active.path]);
  const collAuth = rootNode && rootNode.type === "folder" ? normAuth(rootNode.auth ?? { type: "none" }) : null;
  const res = results[active.id] ?? { response: null, error: null };
  const fullUrl = useMemo(() => buildUrl(req.url, req.params), [req.url, req.params]);

  // ───── persistencia automática (borradores incluidos, aunque no se pulse Guardar) ─────
  useEffect(() => save(wsKey("tabs", wsId), { tabs, activeId: active.id }), [tabs, active.id, wsId]);
  useEffect(() => save(wsKey("collections", wsId), collections), [collections, wsId]);
  useEffect(() => save(wsKey("vars", wsId), vars), [vars, wsId]);
  // Barrera 1: 2 s sin cambios antes de pasar los datos a Rust (que los guarda en disco y avisa al trabajador de sincronización).
  useEffect(() => {
    const id = setTimeout(() => {
      localSave(JSON.stringify(snapshotAll(wsList, wsId, collections, vars))).catch(() => {});
    }, 2000);
    return () => clearTimeout(id);
  }, [collections, vars, wsList, wsId]);
  // ───── espacios de trabajo ─────
  /** Carga otro espacio: lee su bloque del disco y lo pone en pantalla al instante (sin red). */
  const enterWs = (id: string) => {
    void wsTeam.flush(); // lo pendiente del espacio que se deja (si está compartido)
    save(wsKey("collections", wsId), collections);
    save(wsKey("vars", wsId), vars);
    save(wsKey("tabs", wsId), { tabs, activeId: active.id });
    const cols = ensureIds(load<TreeNode[]>(wsKey("collections", id), []));
    const tb = loadTabs(id);
    saveWsActive(id);
    setWsId(id);
    setCollections(cols);
    setVars(load<KV[]>(wsKey("vars", id), []));
    setTabs(tb.tabs);
    setActiveId(tb.activeId);
    setResults({});
    setPendingClose(null);
    setRenamingPath(null);
    setOpenIds(new Set(cols.flatMap((c) => (c.type === "folder" && c.uid ? [c.uid] : []))));
  };
  const addWs = (name: string) => {
    const id = newWsId();
    const list = [...wsList, { id, name }];
    setWsList(list);
    saveWsList(list);
    save(wsKey("collections", id), []);
    save(wsKey("vars", id), []);
    enterWs(id);
  };
  const renameWs = (id: string, name: string) => {
    const list = wsList.map((w) => (w.id === id ? { ...w, name } : w));
    setWsList(list);
    saveWsList(list);
  };
  const deleteWs = (id: string) => {
    if (wsList.length <= 1) return;
    const list = wsList.filter((w) => w.id !== id);
    setWsList(list);
    saveWsList(list);
    if (id === wsId) enterWs(list[0].id);
    removeWsData(id);
  };
  /** Datos que llegan de otro equipo: todos los espacios (o, de versiones antiguas, solo el principal). */
  const applyRemoteRef = useRef((_d: unknown) => {});
  applyRemoteRef.current = (d: any) => {
    const ws: any[] = Array.isArray(d?.workspaces) ? d.workspaces.filter((w: any) => w && typeof w.id === "string") : [];
    if (ws.length === 0) {
      // Formato anterior: solo un conjunto de colecciones (el espacio principal).
      if (wsId === DEFAULT_WS) {
        if (Array.isArray(d?.collections)) setCollections(ensureIds(d.collections));
        if (Array.isArray(d?.vars)) setVars(d.vars);
      } else {
        if (Array.isArray(d?.collections)) save(wsKey("collections", DEFAULT_WS), ensureIds(d.collections));
        if (Array.isArray(d?.vars)) save(wsKey("vars", DEFAULT_WS), d.vars);
      }
      return;
    }
    // Los espacios compartidos con un equipo no viajan por la cuenta: los locales se conservan tal cual.
    const list: WsMeta[] = [
      ...ws.map((w) => ({ id: w.id, name: typeof w.name === "string" && w.name ? w.name : t("Personal") })),
      ...wsList.filter((w) => w.team),
    ];
    for (const w of ws) {
      const cols = Array.isArray(w.collections) ? ensureIds(w.collections) : [];
      const vs = Array.isArray(w.vars) ? w.vars : [];
      if (w.id === wsId) {
        setCollections(cols);
        setVars(vs);
      } else {
        save(wsKey("collections", w.id), cols);
        save(wsKey("vars", w.id), vs);
      }
    }
    for (const old of wsList) if (!list.some((w) => w.id === old.id) && old.id !== wsId) removeWsData(old.id);
    setWsList(list);
    saveWsList(list);
    if (!list.some((w) => w.id === wsId)) enterWs(list[0].id);
  };

  // Cambios que llegan de otro equipo.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    onSyncRemote((json) => {
      try {
        applyRemoteRef.current(JSON.parse(json));
      } catch {
        /* datos remotos ilegibles: se ignoran */
      }
    })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
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
      const file = await pickTextFile();
      const found = file ? detectAndParse(file.content) : null;
      const imported = !file || !found ? null : found.kind === "native" ? await parseCollectionContent(file.content) : found.data;
      if (imported) {
        // Las variables de la colección importada viven en la propia colección (no en las globales).
        const root: TreeNode =
          imported.root.type === "folder" ? { ...imported.root, variables: imported.variables } : imported.root;
        const [withId] = ensureIds([root]);
        setCollections((c) => [...c, withId]);
        openFolder(withId.type === "folder" ? withId.uid : undefined);
      }
    } catch (e) {
      setImportError(errMsg(e));
    } finally {
      setImporting(false);
    }
  };

  // ───── colecciones de equipo ─────
  const [teamDialog, setTeamDialog] = useState<null | { kind: "new" } | { kind: "shareWs" } | { kind: "infoWs" } | { kind: "share" | "info"; path: string }>(null);
  const team = useTeamSync(collections, setCollections, (kind, text) => setNotice({ kind, text }));
  const wsTeam = useWorkspaceTeam({ wsList, wsId, collections, vars, setCollections, setVars, setWsList, notify: (kind, text) => setNotice({ kind, text }) });
  const activeWsTeam = wsList.find((w) => w.id === wsId)?.team;

  const handleJoin = async (code: string) => {
    const norm = normCode(code);
    if (collections.some((c) => c.type === "folder" && c.team && normCode(c.team.code) === norm)) throw new Error(t("Ya tienes esa colección de equipo."));
    if (wsList.some((w) => w.team && normCode(w.team.code) === norm)) throw new Error(t("Ya tienes ese espacio de equipo."));
    const doc = await teamJoin(code);
    const wsp = parseWsPayload(doc.json);
    if (wsp) {
      // El código era de un espacio entero: se crea un espacio nuevo con su contenido.
      const id = newWsId();
      const cols = ensureIds(wsp.collections);
      const h = hashJson(wsPayloadJson(wsp.name, cols, wsp.vars));
      save(wsKey("collections", id), cols);
      save(wsKey("vars", id), wsp.vars ?? []);
      setWsList((l) => [...l, { id, name: wsp.name, team: { code: norm, owner: doc.owner, seen: doc.updatedAt, h, vars: wsp.vars !== null } }]);
      enterWs(id);
      setTeamDialog(null);
      return;
    }
    if (activeWsTeam) throw new Error(t("Este espacio ya está compartido: no se pueden añadir colecciones de equipo sueltas dentro de él."));
    const root = JSON.parse(doc.json) as TreeNode;
    if (root.type !== "folder") throw new Error(t("La colección del equipo no es válida."));
    const [withId] = ensureIds([{ ...root, team: { code: norm, owner: doc.owner, seen: doc.updatedAt, h: hashJson(JSON.stringify(root)) } }]);
    team.markSynced(norm, JSON.stringify(root));
    setCollections((c) => [...c, withId]);
    setTeamDialog(null);
    openFolder(withId.type === "folder" ? withId.uid : undefined);
  };

  const handleShareWs = async (includeVars: boolean): Promise<string> => {
    const ws = wsList.find((w) => w.id === wsId);
    if (!ws) throw new Error(t("Espacio no encontrado."));
    if (hasTeamCollections(collections)) throw new Error(t("Este espacio tiene colecciones de equipo: deja de compartirlas antes de compartir el espacio entero."));
    const json = wsPayloadJson(ws.name, collections, includeVars ? vars : null);
    const code = await teamPublish(json);
    const norm = normCode(code);
    setWsList((l) => l.map((w) => (w.id === wsId ? { ...w, team: { code: norm, owner: true, seen: Date.now(), h: hashJson(json), vars: includeVars } } : w)));
    return code;
  };

  const handleLeaveWs = async () => {
    const ws = wsList.find((w) => w.id === wsId);
    if (!ws?.team) return;
    if (ws.team.owner) await teamUnshare(ws.team.code);
    setWsList((l) => l.map((w) => (w.id === wsId ? { ...w, team: undefined } : w)));
    setTeamDialog(null);
  };

  const handleShare = async (path: string): Promise<string> => {
    if (activeWsTeam) throw new Error(t("Este espacio ya está compartido: no se pueden compartir colecciones sueltas dentro de él."));
    const node = getAt(collections, path);
    if (!node || node.type !== "folder") throw new Error(t("Colección no encontrada."));
    const json = teamJson(node);
    const code = await teamPublish(json);
    const norm = normCode(code);
    team.markSynced(norm, json);
    setCollections((c) => updateAt(c, path, (n) => (n.type === "folder" ? { ...n, team: { code: norm, owner: true, seen: Date.now(), h: hashJson(json) } } : n)));
    return code;
  };

  const handleLeaveTeam = async (path: string) => {
    const node = getAt(collections, path);
    if (!node || node.type !== "folder" || !node.team) return;
    if (node.team.owner) await teamUnshare(node.team.code);
    team.forget(node.team.code);
    setCollections((c) => updateAt(c, path, (n) => { if (n.type !== "folder") return n; const { team: _t, ...rest } = n; void _t; return rest as TreeNode; }));
    setTeamDialog(null);
  };

  /** Copia de seguridad previa a compartir: lanza error si no se guardó. */
  const backupBeforeShare = async (path: string, format: ExportFormat) => {
    const node = getAt(collections, path);
    if (!node) return;
    const text = format === "yaml" ? exportYaml(node, vars) : format === "har" ? exportHar(node, vars) : exportCollection(node, vars);
    const saved = await saveTextFile(exportFileName(node.name, format), text, exportExt(format));
    if (!saved) throw new Error(t("No se guardó la copia de seguridad."));
  };

  const handleNewCollection = () => {
    const node = newFolderNode(t("Nueva colección"));
    setRenamingPath(String(collections.length));
    setCollections((c) => [...c, node]);
    openFolder(node.type === "folder" ? node.uid : undefined);
  };

  const handleAddFolder = (path: string) => {
    // La carpeta nueva va justo después de la última carpeta; la de arriba se vuelve a desplegar.
    const r = addFolder(collections, path, newFolderNode());
    setCollections(r.nodes);
    setTabs((ts) => ts.map((tb) => (tb.path ? { ...tb, path: pathAfterInsert(tb.path, path, r.index) } : tb)));
    const parent = getAt(collections, path);
    openFolder(parent?.type === "folder" ? parent.uid : undefined);
    setRenamingPath(r.path);
  };

  /** Arrastrar y soltar en el árbol: mueve una carpeta o petición dentro de otra carpeta (o al nivel raíz). */
  const handleMove = (from: string, to: string, pos?: "before" | "after") => {
    const r = !from.includes("/")
      ? moveCollection(collections, from, to, pos ?? "after")
      : pos
        ? moveRelative(collections, from, to, pos)
        : moveNode(collections, from, to);
    if (!r) return;
    setCollections(r.nodes);
    setTabs((ts) => ts.map((tb) => (tb.path ? { ...tb, path: r.mapPath(tb.path) } : tb)));
    const dest = to === "root" || !from.includes("/") || pos ? null : getAt(collections, to);
    if (dest?.type === "folder") openFolder(dest.uid);
    setRenamingPath(null);
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

  /** Cuántas colecciones compartidas (de equipo) hay en este equipo. */
  const sharedCount = collections.filter((c) => c.type === "folder" && c.team).length + wsList.filter((w) => w.team).length;

  /**
   * Al cerrar sesión las colecciones compartidas salen de este equipo (siguen en la nube para quien las tenga);
   * las locales se quedan. Las pestañas abiertas sobre ellas pasan a ser borradores y las demás se reindexan.
   */
  const colRef = useRef(collections);
  colRef.current = collections;
  const purgeShared = () => {
    const cur = colRef.current;
    const idxs = cur.map((c, i) => (c.type === "folder" && c.team ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) return 0;
    colRef.current = cur.filter((c) => !(c.type === "folder" && c.team)); // una segunda llamada antes del repintado no repite el reindexado
    setCollections((cs) => cs.filter((c) => !(c.type === "folder" && c.team)));
    setTabs((ts) =>
      ts.map((tb) => {
        let p = tb.path;
        for (const i of [...idxs].reverse()) {
          if (p === null) break;
          p = pathAfterDelete(p, String(i));
        }
        return p === tb.path ? tb : { ...tb, path: p, dirty: p === null ? true : tb.dirty };
      }),
    );
    team.reset();
    setRenamingPath(null);
    return idxs.length;
  };
  /** Los espacios de equipo también salen de este equipo al cerrar sesión (siguen en la nube); los locales se quedan. */
  const wsListRef = useRef(wsList);
  wsListRef.current = wsList;
  const purgeWs = () => {
    const cur = wsListRef.current;
    const shared = cur.filter((w) => w.team);
    if (!shared.length) return 0;
    let keep = cur.filter((w) => !w.team);
    if (keep.length === 0) {
      const id = newWsId();
      keep = [{ id, name: t("Personal") }];
      save(wsKey("collections", id), []);
      save(wsKey("vars", id), []);
    }
    wsListRef.current = keep;
    setWsList(keep);
    if (shared.some((w) => w.id === wsId)) enterWs(keep[0].id);
    for (const w of shared) removeWsData(w.id);
    return shared.length;
  };
  const purgeAll = () => purgeShared() + purgeWs();
  const purgeRef = useRef(purgeAll);
  purgeRef.current = purgeAll;

  // Red de seguridad: si la sesión desaparece por cualquier vía (cuenta borrada, token revocado…), pasa lo mismo.
  useEffect(() => {
    let was: boolean | null = null;
    const check = () =>
      syncStatus()
        .then((s) => {
          if (was === true && !s.signed_in) {
            const n = purgeRef.current();
            if (n) setNotice({ kind: "ok", text: t("Sesión cerrada: las colecciones compartidas han salido de este equipo.") });
          }
          was = s.signed_in;
        })
        .catch(() => {});
    void check();
    const id = setInterval(check, 4000);
    return () => clearInterval(id);
  }, []);

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

  const handleSave = (tab: Tab = active, silent = false) => {
    const req = tab.req;
    const current = tab.path ? getAt(collections, tab.path) : null;
    if (tab.path && current && current.type === "request") {
      setCollections((c) => updateAt(c, tab.path!, (n) => nodeFromRequest(n.name, req)));
      patchTab(tab.id, (t) => ({ ...t, dirty: false }));
      if (!silent) setFlash("save");
      return;
    }
    // Borrador: se guarda en la primera colección (o se crea una).
    const node = nodeFromRequest(suggestName(req), req);
    let base = collections;
    let target = "0";
    if (base.length === 0 || base[0].type !== "folder") {
      base = [...base, newFolderNode(t("Mi colección"))];
      target = String(base.length - 1);
    }
    const { nodes, path } = addChild(base, target, node);
    setCollections(nodes);
    patchTab(tab.id, (t) => ({ ...t, path, name: node.name, dirty: false }));
    setFlash("save");
  };

  const handleExport = async (path: string, format: ExportFormat = "json") => {
    const node = getAt(collections, path);
    if (!node) return;
    try {
      const text = format === "yaml" ? exportYaml(node, vars) : format === "har" ? exportHar(node, vars) : exportCollection(node, vars);
      const saved = await saveTextFile(exportFileName(node.name, format), text, exportExt(format));
      if (saved) setNotice({ kind: "ok", text: t("Colección exportada: {0}", saved) });
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    }
  };

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(generateCurl(buildExecuteArgs({ ...req, auth: effAuth }, effVars)));
      setFlash("curl");
    } catch {
      setNotice({ kind: "err", text: t("No se pudo copiar al portapapeles.") });
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
      const base = buildExecuteArgs({ ...req, auth: effAuth }, effVars);
      // Digest, NTLM, OAuth, AWS… se firman o negocian justo antes de enviar.
      const args = SIGNED_TYPES.includes(effAuth.type) ? await signRequest(effAuth, base, effVars, executeRequest) : base;
      const response = await executeRequest(args);
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
  const kb = useRef<{ newTab: () => void; closeTab: () => void; step: (d: number) => void; goto: (n: number) => void }>({
    newTab, closeTab: () => {}, step: () => {}, goto: () => {},
  });
  kb.current = {
    newTab,
    closeTab: () => requestClose(active.id),
    step: (d) => {
      const i = tabs.findIndex((t) => t.id === active.id);
      setActiveId(tabs[(i + d + tabs.length) % tabs.length].id);
    },
    goto: (n) => tabs[n] && setActiveId(tabs[n].id),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const stop = () => e.preventDefault();
      if (k === "s") {
        stop();
        saveRef.current();
      } else if (e.key === "Enter") {
        stop();
        sendRef.current();
      } else if (k === "t") {
        stop();
        kb.current.newTab();
      } else if (k === "w") {
        stop();
        kb.current.closeTab();
      } else if (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") {
        stop();
        kb.current.step(e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1);
      } else if (/^[1-9]$/.test(e.key)) {
        stop();
        kb.current.goto(Number(e.key) - 1);
      } else if (k === "l") {
        stop();
        const el = document.getElementById("caesar-url") as HTMLInputElement | null;
        el?.focus();
        el?.select();
      } else if (e.key === ",") {
        stop();
        setSettingsSection("ui");
        setShowSettings(true);
      } else if (e.key === "/") {
        stop();
        setSettingsSection("edit");
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Autoguardado (si está activado): guarda la petición abierta de una colección un instante después de dejar de editar.
  useEffect(() => {
    if (!autosave || !active.dirty || !active.path) return;
    const id = setTimeout(() => saveRef.current(active, true), 800);
    return () => clearTimeout(id);
  }, [autosave, active]);

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
        collAuth={collAuth}
        onCollAuth={(a) =>
          rootIdx !== null &&
          setCollections((c) => updateAt(c, String(rootIdx), (n) => (n.type === "folder" ? { ...n, auth: a } : n)))
        }
        onImport={handleImport}
        onNewCollection={() => setTeamDialog({ kind: "new" })}
        onShare={(path) => setTeamDialog({ kind: "share", path })}
        onTeamInfo={(path) => setTeamDialog({ kind: "info", path })}
        onTeamRefresh={(code) => void team.refresh(code)}
        refreshingTeams={team.refreshing}
        workspaces={wsList}
        activeWs={wsId}
        onSwitchWs={enterWs}
        onAddWs={addWs}
        onRenameWs={renameWs}
        onDeleteWs={deleteWs}
        onShareWs={() => setTeamDialog({ kind: "shareWs" })}
        onInfoWs={() => setTeamDialog({ kind: "infoWs" })}
        onJoinWs={handleJoin}
        onRefreshWs={() => void wsTeam.refresh()}
        refreshingWs={wsTeam.refreshing}
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
        onMove={handleMove}
        isOpen={(uid) => !!uid && openIds.has(uid)}
        onToggleOpen={toggleFolder}
        onOpenFolder={openFolder}
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
              <h2 className="text-xl text-mist">{t("¿Cerrar sin guardar?")}</h2>
              <p className="mt-2 text-sm text-slate">
                {t("Esta pestaña tiene cambios sin guardar. Si la cierras, se perderán.")}
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  autoFocus
                  onClick={() => setPendingClose(null)}
                  className="rounded-[10px] px-4 py-2 text-sm text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40"
                >
                  {t("Cancelar")}
                </button>
                <button
                  onClick={() => {
                    closeTab(pendingClose);
                    setPendingClose(null);
                  }}
                  className="rounded-[10px] px-4 py-2 text-sm text-rose ring-1 ring-rose/40 hover:ring-rose"
                >
                  {t("Cerrar sin guardar")}
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
                  {t("Guardar y cerrar")}
                </button>
              </div>
            </div>
          </div>
        )}
        <RequestBar
          method={req.method}
          methods={[...BASE_METHODS, ...extraMethods]}
          onMore={() => { setSettingsSection("edit"); setShowSettings(true); }}
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
        <RequestTabs key={active.id} req={req} patch={patch} inherited={effAuth} />
        </div>
        <ResponsePanel response={res.response} error={res.error} sending={sending} steps={steps} script={res.script ?? null} hideEmpty={hideEmpty} />
        {sending && <NetworkLoader steps={steps} method={req.method} />}
        {showSettings && (
          <SettingsModal
            themeId={themeId}
            onTheme={chooseTheme}
            fonts={fonts}
            onFonts={setFonts}
            hideEmpty={hideEmpty}
            onHideEmpty={setHideEmpty}
            autosave={autosave}
            onAutosave={setAutosave}
            extraMethods={extraMethods}
            onExtraMethods={setExtraMethods}
            initialSection={settingsSection}
            sharedCount={sharedCount}
            onBeforeSignOut={() => team.flush()}
            onSignedOut={() => {
              const n = purgeAll();
              setNotice({ kind: "ok", text: n ? t("Sesión cerrada. Las colecciones compartidas han salido de este equipo; las locales se quedan.") : t("Sesión cerrada.") });
            }}
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
        {showWelcome && <Welcome onDone={() => setShowWelcome(false)} />}
        <VarPicker vars={effVars} />
        {teamDialog?.kind === "new" && (
          <NewCollectionDialog
            onClose={() => setTeamDialog(null)}
            onOwn={() => { setTeamDialog(null); handleNewCollection(); }}
            onJoin={handleJoin}
          />
        )}
        {teamDialog?.kind === "share" && (() => {
          const n = getAt(collections, teamDialog.path);
          return n ? (
            <ShareDialog name={n.name} onClose={() => setTeamDialog(null)} onExport={(f) => backupBeforeShare(teamDialog.path, f)} onConfirm={() => handleShare(teamDialog.path)} />
          ) : null;
        })()}
        {teamDialog?.kind === "shareWs" && (
          <ShareWorkspaceDialog name={wsList.find((w) => w.id === wsId)?.name ?? ""} onClose={() => setTeamDialog(null)} onConfirm={handleShareWs} />
        )}
        {teamDialog?.kind === "infoWs" && activeWsTeam && (
          <TeamInfoDialog
            name={wsList.find((w) => w.id === wsId)?.name ?? ""}
            code={activeWsTeam.code}
            owner={activeWsTeam.owner}
            onClose={() => setTeamDialog(null)}
            onLeave={handleLeaveWs}
          />
        )}
        {teamDialog?.kind === "info" && (() => {
          const n = getAt(collections, teamDialog.path);
          return n && n.type === "folder" && n.team ? (
            <TeamInfoDialog name={n.name} code={n.team.code} owner={n.team.owner} onClose={() => setTeamDialog(null)} onLeave={() => handleLeaveTeam(teamDialog.path)} />
          ) : null;
        })()}
        {upd.phase === "available" && updPrompt && (
          <UpdatePrompt
            current={upd.current}
            version={upd.version}
            notes={upd.notes}
            onInstall={() => {
              setUpdPrompt(false);
              void installNow(upd.version);
            }}
            onLater={() => setUpdPrompt(false)}
          />
        )}
        {upd.phase === "installing" && <UpdateOverlay version={upd.version} downloaded={upd.downloaded} total={upd.total} />}
      </main>
    </div>
  );
}
