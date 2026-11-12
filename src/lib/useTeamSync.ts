import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { teamPull, teamPush } from "../api";
import { t } from "./i18n";
import type { TreeNode } from "../types";

/** Código en su forma canónica (sin guiones ni espacios, en mayúsculas), para comparar. */
export const normCode = (c: string) => c.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** JSON de una colección SIN la marca de equipo: es lo que se comparte. */
export function teamJson(n: TreeNode): string {
  const { team: _team, ...rest } = n as TreeNode & { team?: unknown };
  void _team;
  return JSON.stringify(rest);
}

const teamOf = (n: TreeNode) => (n.type === "folder" ? n.team : undefined);

/**
 * Mantiene al día las colecciones de equipo en segundo plano: tras editar (2,5 s sin teclear) sube los cambios y cada
 * 10 s mira si hay algo nuevo de los compañeros. La edición es siempre local e instantánea; la red la hace Rust.
 * Conflictos: gana la última escritura (si editas a la vez que otra persona, se queda lo que subió el último).
 */
export function useTeamSync(
  collections: TreeNode[],
  setCollections: Dispatch<SetStateAction<TreeNode[]>>,
  notify: (kind: "ok" | "err", text: string) => void,
) {
  const ref = useRef(collections);
  ref.current = collections;
  const synced = useRef(new Map<string, string>()); // código -> último JSON que sabemos que está en la nube
  const busy = useRef(false);
  const warned = useRef(new Set<string>());
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const apply = (code: string, json: string, updatedAt: number, owner: boolean) => {
    let root: TreeNode;
    try {
      root = JSON.parse(json) as TreeNode;
    } catch {
      return;
    }
    if (root.type !== "folder") return;
    synced.current.set(code, JSON.stringify(root));
    setCollections((cur) =>
      cur.map((n) => (teamOf(n)?.code === code ? ({ ...root, team: { code, owner, seen: updatedAt } } as TreeNode) : n)),
    );
  };

  const tick = useRef(async () => {});
  tick.current = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (const n of ref.current) {
        const team = teamOf(n);
        if (!team || n.type !== "folder") continue;
        const code = team.code;
        try {
          const json = teamJson(n);
          const known = synced.current.get(code);
          if (known === undefined) {
            // Primera vez en esta sesión: baja lo nuevo; si no hay nada nuevo, se fuerza una subida por si hubo cambios sin conexión.
            const doc = await teamPull(code, team.seen);
            if (doc) apply(code, doc.json, doc.updatedAt, doc.owner);
            else synced.current.set(code, "");
          } else if (json !== known) {
            const stamp = await teamPush(code, json);
            synced.current.set(code, json);
            setCollections((cur) => cur.map((c) => (teamOf(c)?.code === code ? ({ ...c, team: { ...team, seen: stamp } } as TreeNode) : c)));
          } else {
            const doc = await teamPull(code, team.seen);
            if (doc) apply(code, doc.json, doc.updatedAt, doc.owner);
          }
          warned.current.delete(code);
        } catch (e) {
          const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
          if (msg === "NOT_FOUND") {
            // El dueño dejó de compartirla o eliminó su cuenta: se conserva la copia local, ya sin vínculo.
            setCollections((cur) =>
              cur.map((c) => {
                if (teamOf(c)?.code !== code) return c;
                const { team: _t, ...rest } = c as TreeNode & { team?: unknown };
                void _t;
                return rest as TreeNode;
              }),
            );
            synced.current.delete(code);
            notifyRef.current("err", t("«{0}» ya no se comparte (su dueño la eliminó). Conservas tu copia local.", n.name));
          } else if (!warned.current.has(code)) {
            warned.current.add(code); // un aviso por fallo, no uno cada 10 s
            if (msg && !/sin conexión|No has iniciado/i.test(msg)) notifyRef.current("err", msg);
          }
        }
      }
    } finally {
      busy.current = false;
    }
  };

  // Subida tras editar
  useEffect(() => {
    if (!collections.some((n) => teamOf(n))) return;
    const id = setTimeout(() => void tick.current(), 2500);
    return () => clearTimeout(id);
  }, [collections]);

  // Consulta periódica
  useEffect(() => {
    const id = setInterval(() => void tick.current(), 10_000);
    void tick.current();
    return () => clearInterval(id);
  }, []);

  return {
    /** Marca un JSON como ya sincronizado (al compartir o unirse). */
    markSynced: (code: string, json: string) => synced.current.set(code, json),
    forget: (code: string) => synced.current.delete(code),
    /** Sube los cambios pendientes de las colecciones de equipo ahora mismo (antes de cerrar sesión). */
    flush: () => tick.current(),
    /** Olvida todo el estado de sincronización (al cerrar sesión). */
    reset: () => {
      synced.current.clear();
      warned.current.clear();
    },
  };
}
