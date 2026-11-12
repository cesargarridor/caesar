import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { teamPull, teamPush } from "../api";
import { hashJson } from "./useTeamSync";
import { ensureIds } from "./tree";
import { t } from "./i18n";
import type { WsMeta } from "./workspaces";
import type { KV, TreeNode } from "../types";

/**
 * Espacio de trabajo compartido con un equipo: usa el mismo código y la misma nube que las colecciones de equipo,
 * pero lo que se comparte es el espacio entero (todas sus colecciones y, si quien lo comparte lo elige, sus variables).
 * Solo se sincroniza el espacio que está abierto, y con la misma filosofía: subir en segundo plano tras guardar y bajar
 * solo al pulsar «Actualizar» (primero la fecha; el contenido solo si hay algo más nuevo).
 */
export interface WsPayload {
  name: string;
  collections: TreeNode[];
  /** null = las variables no se comparten (cada persona conserva las suyas). */
  vars: KV[] | null;
}

/** JSON que viaja a la nube. Las colecciones van sin marca de equipo. */
export function wsPayloadJson(name: string, collections: TreeNode[], vars: KV[] | null): string {
  const cols = collections.map((n) => {
    if (n.type !== "folder") return n;
    const { team: _t, ...rest } = n as TreeNode & { team?: unknown };
    void _t;
    return rest as TreeNode;
  });
  return JSON.stringify({ kind: "workspace", v: 1, name, collections: cols, vars });
}

export function parseWsPayload(json: string): WsPayload | null {
  try {
    const p = JSON.parse(json);
    if (p?.kind !== "workspace" || !Array.isArray(p.collections)) return null;
    return { name: typeof p.name === "string" && p.name ? p.name : t("Personal"), collections: p.collections, vars: Array.isArray(p.vars) ? p.vars : null };
  } catch {
    return null;
  }
}

export const hasTeamCollections = (cols: TreeNode[]) => cols.some((c) => c.type === "folder" && c.team);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useWorkspaceTeam(args: {
  wsList: WsMeta[];
  wsId: string;
  collections: TreeNode[];
  vars: KV[];
  setCollections: Dispatch<SetStateAction<TreeNode[]>>;
  setVars: Dispatch<SetStateAction<KV[]>>;
  setWsList: Dispatch<SetStateAction<WsMeta[]>>;
  notify: (kind: "ok" | "err", text: string) => void;
}) {
  const a = useRef(args);
  a.current = args;
  const busy = useRef(false);
  const warned = useRef("");
  const [refreshing, setRefreshing] = useState(false);

  const patch = (id: string, p: Partial<NonNullable<WsMeta["team"]>>) =>
    a.current.setWsList((list) => list.map((w) => (w.id === id && w.team ? { ...w, team: { ...w.team, ...p } } : w)));

  /** Sincroniza el espacio abierto. `pull` = el usuario pidió actualizar. Devuelve "changed" | "same" | "failed". */
  const run = async (pull: boolean): Promise<"changed" | "same" | "failed"> => {
    while (busy.current) await sleep(150);
    busy.current = true;
    // Se lee todo de golpe, antes de cualquier espera.
    const { wsList, wsId, collections, vars, setCollections, setVars, setWsList, notify } = a.current;
    const ws = wsList.find((w) => w.id === wsId);
    try {
      const team = ws?.team;
      if (!ws || !team) return "same";
      const code = team.code;
      const json = wsPayloadJson(ws.name, collections, team.vars ? vars : null);
      const h = hashJson(json);
      const known = team.h;

      const doPush = async () => {
        const stamp = await teamPush(code, json);
        patch(ws.id, { seen: stamp, h });
      };
      const doPull = async (): Promise<boolean> => {
        const doc = await teamPull(code, team.seen);
        if (!doc) return false;
        const p = parseWsPayload(doc.json);
        if (!p) throw new Error(t("El espacio compartido no es válido."));
        const cols = ensureIds(p.collections);
        const vs = team.vars && p.vars ? p.vars : null;
        setCollections(cols);
        if (vs) setVars(vs);
        setWsList((list) =>
          list.map((w) =>
            w.id === ws.id && w.team
              ? { ...w, name: p.name, team: { ...w.team, seen: doc.updatedAt, h: hashJson(wsPayloadJson(p.name, cols, team.vars ? vs ?? vars : null)) } }
              : w,
          ),
        );
        return true;
      };

      if (known === undefined) {
        if (await doPull()) return "changed";
        await doPush();
      } else if (h !== known) {
        await doPush();
      } else if (pull) {
        if (await doPull()) return "changed";
      }
      warned.current = "";
      return "same";
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
      if (msg === "NOT_FOUND") {
        // El dueño dejó de compartirlo o eliminó su cuenta: se conserva la copia local, ya sin vínculo.
        setWsList((list) => list.map((w) => (w.id === ws?.id ? { ...w, team: undefined } : w)));
        notify("err", t("«{0}» ya no se comparte (su dueño la eliminó). Conservas tu copia local.", ws?.name ?? ""));
      } else if (pull) {
        notify("err", msg || t("Error desconocido"));
      } else if (warned.current !== msg) {
        warned.current = msg;
        if (msg && !/sin conexión|No has iniciado/i.test(msg)) notify("err", msg);
      }
      return "failed";
    } finally {
      busy.current = false;
    }
  };

  // Subida en segundo plano tras guardar cambios (el arranque no cuenta: no hay nada nuevo).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!args.wsList.find((w) => w.id === args.wsId)?.team) return;
    const id = setTimeout(() => void run(false), 2500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.collections, args.vars, args.wsId]);

  return {
    refreshing,
    /** Sube ya lo pendiente (antes de cambiar de espacio o cerrar sesión). */
    flush: async () => {
      await run(false);
    },
    /** Rueda de actualizar. */
    refresh: async () => {
      setRefreshing(true);
      try {
        const r = await run(true);
        if (r !== "failed") a.current.notify("ok", r === "changed" ? t("Espacio actualizado.") : t("Ya tienes la última versión."));
      } finally {
        setRefreshing(false);
      }
    },
  };
}
