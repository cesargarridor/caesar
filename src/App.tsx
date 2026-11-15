import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import NetworkLoader from "./components/NetworkLoader";
import SettingsModal from "./components/SettingsModal";
import Welcome from "./components/Welcome";
import { useToast } from "./components/Toast";
import { useAccount, planError } from "./lib/account";
import { isOnboarded, termsAccepted } from "./lib/legal";
import { TermsGate } from "./components/ConsentChecks";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import EmptyTabs from "./components/EmptyTabs";
import RequestBar from "./components/RequestBar";
import RequestTabs from "./components/RequestTabs";
import ResponsePanel from "./components/ResponsePanel";
import CodeSnippetPanel from "./components/CodeSnippetPanel";
import WebSocketPanel from "./components/WebSocketPanel";
import WsMessages from "./components/WsMessages";
import { disposeWs, wsStatusOf } from "./lib/wsStore";
import { sendDraft, startWs } from "./lib/wsRequest";
import VarPicker from "./components/VarPicker";
import VarPeek from "./components/VarPeek";
import VarsDialog, { type VarsSection } from "./components/VarsDialog";
import { NewCollectionDialog, ShareDialog, ShareWorkspaceDialog, TeamInfoDialog } from "./components/TeamDialogs";
import { hashJson, normCode, teamJson, useTeamSync } from "./lib/useTeamSync";
import { hasTeamCollections, parseWsPayload, useWorkspaceTeam, wsPayloadJson } from "./lib/useWorkspaceTeam";
import {
  DEFAULT_WS, addTombstones, canCreateWorkspace, collectNodeIds, loadWsActive, loadWsList, newWsId, loadProfiles, newProfileId, normProfiles, removeWsData, saveWsActive, saveWsList, snapshotAll, wsKey, type WsMeta,
} from "./lib/workspaces";
import {
  appVersion, checkTrialAndWhitelist, checkUpdate, executeRequest, syncStatus, teamJoin, teamPublish, teamUnshare, installUpdate, parseCollectionContent, pickTextFiles, localSave, onSyncRemote, onUpdateProgress, saveTextFile,
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
import { collectNestedVars, foldNestedVars, importSummary, mergeGlobals, profileFromEnv, type ImportCounts } from "./lib/vars";
import { detectAndParse, exportExt, exportFileName, exportHar, exportYaml, type ExportFormat } from "./lib/interchange";
import {
  addChild, addFolder, ensureIds, getAt, moveCollection, moveNode, moveRelative, newFolderNode, newRequestNode, newWsNode, nodeFromRequest, pathAfterDelete, pathAfterInsert,
  removeAt, renameAt, suggestName, updateAt,
} from "./lib/tree";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { runScript, type ScriptResult } from "./lib/script";
import { installFindShortcut, triggerFind } from "./lib/find";
import { allCommands, getCombos, getToolbar, installKeymap, prettyCombo, stepsOf } from "./lib/keymap";
import { activeAfterClose, dirtyIds, idsToClose, type CloseMode } from "./lib/tabs";
import { useKeymapVersion } from "./lib/useKeymap";
import { t, useLang } from "./lib/i18n";
import {
  applyFonts, loadAutoUpdate, loadAutosave, saveAutosave, BASE_METHODS, loadExtraMethods, saveExtraMethods, loadFonts, loadHideEmpty, loadSidebarWidth, saveAutoUpdate, saveFonts, saveHideEmpty,
  saveSidebarWidth, type FontPrefs,
} from "./lib/prefs";
import type { KV, ProfilesState, ProgressEvent, VarProfile, RequestNode, RequestState, ResponseData, StepState, Tab, TreeNode, UpdateState } from "./types";

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

/** Pestaña "fantasma" para cuando no hay ninguna abierta: nunca está en `tabs`, así los parches por id no hacen nada. */
const NO_TAB: Tab = { id: "", req: emptyRequest(), path: null, name: "", dirty: false };

/** Tabs guardadas: se valida la forma por si el formato cambió. */
function loadTabs(wsId: string): { tabs: Tab[]; activeId: string } {
  const saved = load<{ tabs?: Tab[]; activeId?: string }>(wsKey("tabs", wsId), {});
  const tabs = (saved.tabs ?? []).filter(
    (t) => t && typeof t.id === "string" && t.req && typeof t.req.method === "string" && Array.isArray(t.req.params),
  );
  // Lo guardado como [] se respeta (sin pestañas). Solo si no hay clave guardada (primer arranque) se abre una en blanco.
  if (tabs.length === 0) {
    if (Array.isArray(saved.tabs)) return { tabs: [], activeId: "" };
    const t = blankTab();
    return { tabs: [t], activeId: t.id };
  }
  return { tabs, activeId: tabs.some((t) => t.id === saved.activeId) ? saved.activeId! : tabs[0].id };
}

/** Convierte PRO_REQUIRED / GUEST_LIMIT_WORKSPACES en un mensaje claro; el resto se relanza igual. */
const planThrow = (e: unknown): never => {
  const m = planError(e);
  throw m ? new Error(m) : e;
};

export default function App() {
  useLang(); // re-renderiza toda la interfaz al cambiar de idioma
  const toast = useToast();
  const { account, setAccount } = useAccount();
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
  const [profiles, setProfiles] = useState<ProfilesState>(() => loadProfiles(wsId));
  const initial = useMemo(() => loadTabs(wsId), []);
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [activeId, setActiveId] = useState(initial.activeId);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [codegenOpen, setCodegenOpen] = useState(false);

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
  const [, setTermsRev] = useState(0); // fuerza el repintado al aceptar los términos
  // Arranque: comprueba prueba de 7 días / lista blanca (Rust hace la red). Si la cuenta se borró, vuelve al modo Invitado.
  useEffect(() => {
    checkTrialAndWhitelist()
      .then((a) => {
        setAccount(a);
        if (a.deleted) {
          setShowWelcome(true);
          toast.show(t("Prueba de 7 días caducada: tu cuenta se ha eliminado y vuelves al modo Invitado."), "err", 12000);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [manageTick, setManageTick] = useState(0);
  /** Editor grande de variables / perfiles / colección (null = cerrado). collIdx = colección elegida (por defecto la de la pestaña activa). */
  const [varsDlg, setVarsDlg] = useState<null | { section: VarsSection; collIdx?: number; collTab?: "vars" | "auth" }>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const activeOrNull = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  const active = activeOrNull ?? NO_TAB;
  const req = active.req;
  /** Colección (carpeta raíz) a la que pertenece la pestaña activa y sus variables; pisan a las globales. */
  const rootIdx = active.path !== null ? Number(active.path.split("/")[0]) : null;
  const rootNode = rootIdx !== null ? collections[rootIdx] : undefined;
  const collVars: KV[] = rootNode && rootNode.type === "folder" ? rootNode.variables ?? [] : [];
  /** Perfil de variables activo (selector junto a «Enviar»). Pisa a las globales y a las de la colección. */
  const activeProfile = profiles.list.find((p) => p.id === profiles.active) ?? null;
  const profVars: KV[] = activeProfile?.vars ?? [];
  const effVars = useMemo(() => [...vars, ...collVars, ...profVars], [vars, collVars, profVars]);
  /** Autorización efectiva: con "Inherit" sube por las carpetas hasta la de la colección. */
  const effAuth = useMemo(() => resolveInherit(req.auth, collections, active.path), [req.auth, collections, active.path]);
  const res = results[active.id] ?? { response: null, error: null };
  const fullUrl = useMemo(() => buildUrl(req.url, req.params), [req.url, req.params]);

  // ───── persistencia automática (borradores incluidos, aunque no se pulse Guardar) ─────
  useEffect(() => save(wsKey("tabs", wsId), { tabs, activeId: active.id }), [tabs, active.id, wsId]);
  useEffect(() => save(wsKey("collections", wsId), collections), [collections, wsId]);
  useEffect(() => save(wsKey("vars", wsId), vars), [vars, wsId]);
  useEffect(() => save(wsKey("envs", wsId), profiles), [profiles, wsId]);
  // Barrera 1: 2 s sin cambios antes de pasar los datos a Rust (que los guarda en disco y avisa al trabajador de sincronización).
  useEffect(() => {
    const id = setTimeout(() => {
      localSave(JSON.stringify(snapshotAll(wsList, wsId, collections, vars, profiles))).catch(() => {});
    }, 2000);
    return () => clearTimeout(id);
  }, [collections, vars, profiles, wsList, wsId]);
  // ───── espacios de trabajo ─────
  /** Carga otro espacio: lee su bloque del disco y lo pone en pantalla al instante (sin red). */
  const enterWs = (id: string) => {
    void wsTeam.flush(); // lo pendiente del espacio que se deja (si está compartido)
    save(wsKey("collections", wsId), collections);
    save(wsKey("vars", wsId), vars);
    save(wsKey("envs", wsId), profiles);
    save(wsKey("tabs", wsId), { tabs, activeId: active.id });
    const cols = ensureIds(load<TreeNode[]>(wsKey("collections", id), []));
    const tb = loadTabs(id);
    saveWsActive(id);
    setWsId(id);
    setCollections(cols);
    setVars(load<KV[]>(wsKey("vars", id), []));
    setProfiles(loadProfiles(id));
    setTabs(tb.tabs);
    setActiveId(tb.activeId);
    setResults({});
    setPendingClose(null);
    setRenamingPath(null);
    setOpenIds(new Set(cols.flatMap((c) => (c.type === "folder" && c.uid ? [c.uid] : []))));
  };
  const addWs = (name: string) => {
    if (!canCreateWorkspace(account.is_pro, wsList)) {
      setNotice({ kind: "err", text: planError("GUEST_LIMIT_WORKSPACES") ?? "" });
      return;
    }
    const id = newWsId();
    const list = [...wsList, { id, name, updatedAt: Date.now() }];
    setWsList(list);
    saveWsList(list);
    save(wsKey("collections", id), []);
    save(wsKey("vars", id), []);
    enterWs(id);
  };
  const renameWs = (id: string, name: string) => {
    const list = wsList.map((w) => (w.id === id ? { ...w, name, updatedAt: Date.now() } : w));
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
      ...ws.map((w) => ({ id: w.id, name: typeof w.name === "string" && w.name ? w.name : t("Personal"), ...(typeof w.updatedAt === "number" ? { updatedAt: w.updatedAt } : {}) })),
      ...wsList.filter((w) => w.team),
    ];
    for (const w of ws) {
      const cols = Array.isArray(w.collections) ? ensureIds(w.collections) : [];
      const vs = Array.isArray(w.vars) ? w.vars : [];
      // Versiones anteriores no traen perfiles: en ese caso se conservan los locales.
      const pr = w.envs === undefined ? null : normProfiles(w.envs);
      if (w.id === wsId) {
        setCollections(cols);
        setVars(vs);
        if (pr) setProfiles(pr);
      } else {
        save(wsKey("collections", w.id), cols);
        save(wsKey("vars", w.id), vs);
        if (pr) save(wsKey("envs", w.id), pr);
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
  const newWsTab = () => {
    const node = newWsNode(t("Nueva WebSocket"));
    openTab({ id: newId(), req: requestFromNode(node), path: null, name: node.name, dirty: false });
  };

  const [pendingClose, setPendingClose] = useState<string | null>(null);
  /** Pide confirmación si la pestaña tiene cambios sin guardar. */
  const requestClose = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (t?.dirty) setPendingClose(id);
    else closeTab(id);
  };
  const closeTab = (id: string) => closeTabs([id]);
  /** Cierra varias pestañas: corta sus WebSockets, limpia resultados y elige la nueva activa (ninguna si no queda alguna). */
  const closeTabs = (ids: string[]) => {
    if (ids.length === 0) return;
    ids.forEach((id) => disposeWs(id)); // cierra su conexión WebSocket, si la tiene
    const next = activeAfterClose(tabs, ids, activeOrNull?.id ?? null);
    const gone = new Set(ids);
    setTabs(tabs.filter((t) => !gone.has(t.id)));
    setActiveId(next ?? "");
    setResults((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !gone.has(k))));
  };
  const [pendingMany, setPendingMany] = useState<string[] | null>(null);
  /** Cierra varias; si alguna tiene cambios sin guardar, un solo diálogo de confirmación. */
  const requestCloseMany = (mode: CloseMode, id: string | null) => {
    const ids = idsToClose(tabs, id, mode);
    if (ids.length === 0) return;
    if (dirtyIds(tabs, ids).length > 0) setPendingMany(ids);
    else closeTabs(ids);
  };
  /** Guarda varias pestañas de una vez (una sola actualización de colecciones, para que los borradores no se pisen). */
  const saveMany = (list: Tab[]) => {
    let cols = collections;
    for (const tab of list) {
      const r = tab.req;
      const cur = tab.path ? getAt(cols, tab.path) : null;
      if (tab.path && cur && cur.type === "request") {
        cols = updateAt(cols, tab.path, (n) => nodeFromRequest(n.name, r, n));
        continue;
      }
      const node = nodeFromRequest(suggestName(r), r);
      if (cols.length === 0 || cols[0].type !== "folder") cols = [...cols, newFolderNode(t("Mi colección"))];
      const target = cols[0].type === "folder" ? "0" : String(cols.length - 1);
      cols = addChild(cols, target, node).nodes;
    }
    setCollections(cols);
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
    if (activeOrNull && !active.path && !active.dirty && !active.req.url) {
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
      // Acepta varios archivos a la vez (colección + entornos de Postman). Cada uno se procesa por separado.
      const files = await pickTextFiles();
      const counts: ImportCounts = { collections: 0, profiles: 0, globals: 0 };
      const roots: TreeNode[] = [];
      const newProfiles: VarProfile[] = [];
      let globals = vars;
      const errors: string[] = [];
      for (const file of files) {
        try {
          const found = detectAndParse(file.content);
          if (found.kind === "env") {
            // Entorno de Postman -> perfil nuevo (sin activar); globales de Postman -> se fusionan con las globales.
            if (found.env.kind === "globals") {
              const m = mergeGlobals(globals, found.env.vars);
              globals = m.vars;
              counts.globals += m.added + m.updated;
            } else {
              newProfiles.push(profileFromEnv(found.env, [...profiles.list, ...newProfiles], newProfileId()));
              counts.profiles++;
            }
            continue;
          }
          const imported = found.kind === "native" ? await parseCollectionContent(file.content) : found.data;
          // Las variables de la colección importada viven en la propia colección (no en las globales). Las de carpetas y peticiones
          // (Postman v2.1) se suben a la colección raíz sin pisar las claves que ya tenga.
          let variables = imported.variables;
          if (found.kind === "native") {
            try {
              variables = foldNestedVars(variables, collectNestedVars(JSON.parse(file.content)));
            } catch {
              /* el JSON ya lo validó Rust */
            }
          }
          const root: TreeNode = imported.root.type === "folder" ? { ...imported.root, variables } : imported.root;
          roots.push(ensureIds([root])[0]);
          counts.collections++;
        } catch (e) {
          errors.push(`${file.name}: ${errMsg(e)}`);
        }
      }
      if (roots.length) {
        setCollections((c) => [...c, ...roots]);
        const last = roots[roots.length - 1];
        openFolder(last.type === "folder" ? last.uid : undefined);
      }
      if (newProfiles.length) setProfiles((p) => ({ ...p, list: [...p.list, ...newProfiles] }));
      if (globals !== vars) setVars(globals);
      if (errors.length) setImportError(errors.join(" · "));
      if (counts.collections + counts.profiles + counts.globals > 0) {
        const only = counts.collections === 0 && counts.globals === 0 && newProfiles.length === 1;
        setNotice({ kind: "ok", text: only ? `${t("Perfil")} «${newProfiles[0].name}» ${t("importado")}` : importSummary(counts, t) });
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
    const doc = await teamJoin(code).catch(planThrow);
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
    const code = await teamPublish(json).catch(planThrow);
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
    const code = await teamPublish(json).catch(planThrow);
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

  const handleAddSocket = (path: string) => {
    const node = newWsNode(t("Nueva WebSocket"));
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
    const gone = getAt(collections, path);
    if (gone) addTombstones(collectNodeIds(gone));
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
    if (!tab.id) return; // sin pestañas: nada que guardar
    const req = tab.req;
    const current = tab.path ? getAt(collections, tab.path) : null;
    if (tab.path && current && current.type === "request") {
      setCollections((c) => updateAt(c, tab.path!, (n) => nodeFromRequest(n.name, req, n)));
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
    if (!activeOrNull) return; // sin pestañas: nada que enviar
    if (req.kind === "ws") {
      // WebSocket: Ctrl/Cmd+Enter envía el mensaje si hay conexión; si no, conecta.
      const st = wsStatusOf(active.id);
      if (st === "connected") sendDraft(active.id, req).catch((e) => setNotice({ kind: "err", text: t(String((e as Error)?.message ?? e)) }));
      else if (st === "disconnected") {
        const err = startWs(active.id, req, effAuth, effVars);
        if (err) setNotice({ kind: "err", text: err });
      }
      return;
    }
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
          // Si la variable ya existe en el perfil activo se actualiza ahí; si no, en la colección; y si no, en las globales.
          const inProf = new Set(profVars.map((v) => v.key));
          const inColl = new Set(collVars.map((v) => v.key).filter((k) => !inProf.has(k)));
          setVars((cur) => apply(cur, (k) => !inColl.has(k) && !inProf.has(k), true));
          if (activeProfile && inProf.size) {
            const pid = activeProfile.id;
            setProfiles((p) => ({ ...p, list: p.list.map((x) => (x.id === pid ? { ...x, vars: apply(x.vars, (k) => inProf.has(k), false) } : x)) }));
          }
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
  const copyCurlRef = useRef(handleCopyCurl);
  copyCurlRef.current = handleCopyCurl;
  const saveRef = useRef(handleSave);
  const sendRef = useRef(handleSend);
  saveRef.current = handleSave;
  sendRef.current = handleSend;
  const kb = useRef<{ newTab: () => void; closeTab: () => void; step: (d: number) => void; goto: (n: number) => void }>({
    newTab, closeTab: () => {}, step: () => {}, goto: () => {},
  });
  kb.current = {
    newTab,
    closeTab: () => activeOrNull && requestClose(activeOrNull.id),
    step: (d) => {
      if (tabs.length === 0) return;
      const i = tabs.findIndex((t) => t.id === active.id);
      setActiveId(tabs[(i + d + tabs.length) % tabs.length].id);
    },
    goto: (n) => tabs[n] && setActiveId(tabs[n].id),
  };
  // Atajos de teclado editables (lib/keymap): el despachador traduce la combinación pulsada en un comando y lo ejecuta aquí.
  const histGo = useRef<(d: -1 | 1) => void>(() => {});
  const runStep = (id: string) => {
    const gt = /^gotoTab([1-9])$/.exec(id);
    if (gt) return kb.current.goto(Number(gt[1]) - 1);
    switch (id) {
      case "save": return saveRef.current();
      case "send": return sendRef.current();
      case "copyCurl": return activeOrNull ? void copyCurlRef.current() : undefined;
      case "codegen": return activeOrNull ? setCodegenOpen((o) => !o) : undefined;
      case "newTab": return kb.current.newTab();
      case "closeTab": return kb.current.closeTab();
      case "closeAllTabs": return requestCloseMany("all", null);
      case "nextTab": return kb.current.step(1);
      case "prevTab": return kb.current.step(-1);
      case "historyBack": return histGo.current(-1);
      case "historyForward": return histGo.current(1);
      case "focusUrl": {
        const el = document.getElementById("caesar-url") as HTMLInputElement | null;
        el?.focus();
        el?.select();
        return;
      }
      case "find": return triggerFind();
      case "varPicker": return void window.dispatchEvent(new Event("caesar-var-picker"));
      case "settings":
        setSettingsSection("ui");
        return setShowSettings(true);
      case "shortcuts":
        setSettingsSection("edit");
        return setShowSettings(true);
    }
  };
  const runCommand = (id: string) => {
    for (const step of stepsOf(id)) runStep(step);
  };
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  useEffect(() => installKeymap((id) => runCommandRef.current(id)), []);
  useKeymapVersion();
  const toolbarButtons = getToolbar().flatMap((id) => {
    const c = allCommands().find((x) => x.id === id);
    return c ? [{ id, label: c.user ? c.label : t(c.label) }] : [];
  });

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
    if (!active.id || h.list[h.idx] === active.id) return;
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
    histGo.current = go;
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("mouseup", onMouse, true);
    window.addEventListener("auxclick", onMouse, true);
    return () => {
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("mouseup", onMouse, true);
      window.removeEventListener("auxclick", onMouse, true);
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
        profiles={profiles}
        onProfiles={setProfiles}
        manageProfilesTick={manageTick}
        onOpenVars={(section) => setVarsDlg({ section })}
        onCollSettings={(path) => setVarsDlg({ section: "collection", collIdx: Number(path.split("/")[0]) })}
        onImport={handleImport}
        onNewCollection={() => (!account.is_pro ? handleNewCollection() : setTeamDialog({ kind: "new" }))}
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
        onAddSocket={handleAddSocket}
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
        <TabBar tabs={tabs} activeId={activeOrNull?.id ?? null} onSelect={setActiveId} onClose={requestClose} onNew={newTab} onNewWs={newWsTab} onCloseMany={requestCloseMany} />
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
        {pendingMany && (() => {
          const dirtyN = dirtyIds(tabs, pendingMany).length;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-8" onMouseDown={() => setPendingMany(null)}>
              <div role="alertdialog" aria-modal="true" aria-labelledby="close-many-title" className="w-full max-w-md rounded-2xl bg-kelp glass p-7" onMouseDown={(e) => e.stopPropagation()}>
                <h2 id="close-many-title" className="text-xl text-mist">
                  {dirtyN === 1 ? t("Una pestaña tiene cambios sin guardar") : t("{0} pestañas tienen cambios sin guardar", dirtyN)}
                </h2>
                <p className="mt-2 text-sm text-slate">{t("Si las cierras sin guardar, se perderán los cambios.")}</p>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <button
                    autoFocus
                    onClick={() => setPendingMany(null)}
                    className="rounded-[10px] px-4 py-2 text-sm text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40"
                  >
                    {t("Cancelar")}
                  </button>
                  <button
                    onClick={() => {
                      closeTabs(pendingMany);
                      setPendingMany(null);
                    }}
                    className="rounded-[10px] px-4 py-2 text-sm text-rose ring-1 ring-rose/40 hover:ring-rose"
                  >
                    {t("Cerrar sin guardar")}
                  </button>
                  <button
                    onClick={() => {
                      const gone = new Set(pendingMany);
                      saveMany(tabs.filter((x) => gone.has(x.id) && x.dirty));
                      closeTabs(pendingMany);
                      setPendingMany(null);
                    }}
                    className="btn-aurora px-5 py-2 text-sm font-semibold"
                  >
                    {t("Guardar todo y cerrar")}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        {!activeOrNull ? (
          <EmptyTabs onNew={newTab} onNewWs={newWsTab} newCombo={getCombos("newTab")[0] ? prettyCombo(getCombos("newTab")[0]) : undefined} />
        ) : req.kind === "ws" ? (
          <WebSocketPanel
            key={active.id}
            id={active.id}
            req={req}
            patch={patch}
            auth={effAuth}
            vars={effVars}
            profiles={profiles}
            onProfile={(a) => setProfiles((p) => ({ ...p, active: a }))}
            onManageProfiles={() => setManageTick((n) => n + 1)}
            onSave={() => handleSave()}
            saved={flash === "save"}
            onError={(text) => setNotice({ kind: "err", text })}
          />
        ) : (
        <RequestBar
          method={req.method}
          methods={[...BASE_METHODS, ...extraMethods]}
          onMore={() => { setSettingsSection("edit"); setShowSettings(true); }}
          profiles={profiles}
          onProfile={(active) => setProfiles((p) => ({ ...p, active }))}
          onManageProfiles={() => setManageTick((n) => n + 1)}
          onShowResolved={() => setVarsDlg({ section: "resolved" })}
          url={fullUrl}
          sending={sending}
          onMethod={(method) => patch({ method })}
          onUrlEdit={(full) => patch(applyUrlEdit(full, req.params))}
          onCurl={handleCurl}
          onSend={handleSend}
          onSave={() => handleSave()}
          onCopyCurl={handleCopyCurl}
          onCodegen={() => setCodegenOpen((o) => !o)}
          codegenOpen={codegenOpen}
          flash={flash}
          extra={toolbarButtons}
          onCommand={(id) => runCommandRef.current(id)}
        />
        )}
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
        {activeOrNull && req.kind !== "ws" && <RequestTabs key={active.id} req={req} patch={patch} inherited={effAuth} vars={effVars} />}
        </div>
        {!activeOrNull ? null : req.kind === "ws" ? (
          <WsMessages key={active.id} id={active.id} />
        ) : (
          <ResponsePanel response={res.response} error={res.error} sending={sending} steps={steps} script={res.script ?? null} hideEmpty={hideEmpty} />
        )}
        {activeOrNull && sending && req.kind !== "ws" && <NetworkLoader steps={steps} method={req.method} />}
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
        {!showWelcome && !termsAccepted() && <TermsGate onAccepted={() => setTermsRev((n) => n + 1)} />}
        {varsDlg && (() => {
          const ci = varsDlg.collIdx ?? rootIdx;
          const cn = ci !== null && ci !== undefined ? collections[ci] : undefined;
          const folder = cn && cn.type === "folder" ? cn : null;
          return (
            <VarsDialog
              section={varsDlg.section}
              collTab={varsDlg.collTab}
              vars={vars}
              onVars={setVars}
              profiles={profiles}
              onProfiles={setProfiles}
              collName={folder ? folder.name : null}
              collVars={folder?.variables ?? []}
              onCollVars={(v) => ci != null && setCollections((c) => updateAt(c, String(ci), (n) => (n.type === "folder" ? { ...n, variables: v, updatedAt: Date.now() } : n)))}
              collAuth={folder ? normAuth(folder.auth ?? { type: "none" }) : null}
              onCollAuth={(a) => ci != null && setCollections((c) => updateAt(c, String(ci), (n) => (n.type === "folder" ? { ...n, auth: a, updatedAt: Date.now() } : n)))}
              onClose={() => setVarsDlg(null)}
            />
          );
        })()}
        <VarPicker vars={effVars} />
        <VarPeek
          vars={vars}
          onVars={setVars}
          profile={activeProfile}
          onProfileVars={(v) => activeProfile && setProfiles((p) => ({ ...p, list: p.list.map((x) => (x.id === activeProfile.id ? { ...x, vars: v } : x)) }))}
          collVars={rootIdx !== null ? collVars : null}
          onCollVars={
            rootIdx !== null
              ? (v) => setCollections((c) => updateAt(c, String(rootIdx), (n) => (n.type === "folder" ? { ...n, variables: v, updatedAt: Date.now() } : n)))
              : null
          }
        />
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
      {codegenOpen && activeOrNull && (
        <CodeSnippetPanel
          getArgs={(resolve) => buildExecuteArgs({ ...req, auth: effAuth }, resolve ? effVars : [])}
          onClose={() => setCodegenOpen(false)}
          onNotice={(kind, text) => setNotice({ kind, text })}
        />
      )}
    </div>
  );
}
