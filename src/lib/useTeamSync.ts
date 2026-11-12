import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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

/** Huella corta (FNV-1a de 32 bits) de un JSON: sirve para saber si la colección cambió desde la última sincronización. */
export function hashJson(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + "-" + s.length.toString(16);
}

const teamOf = (n: TreeNode) => (n.type === "folder" ? n.team : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Colecciones de equipo, sin conexión permanente ni consultas periódicas:
 *  · SUBIR: tras guardar un cambio (2,5 s sin tocar nada) se sube en segundo plano. Si la colección no cambió, no se hace nada.
 *  · BAJAR: solo cuando el usuario pulsa «Actualizar» (la rueda de la colección). Primero se pregunta solo la fecha
 *    (unos bytes); la colección se descarga únicamente si hay una versión más nueva.
 * La edición es siempre local e instantánea; la red la hace Rust. Conflictos: gana la última escritura.
 */
export function useTeamSync(
  collections: TreeNode[],
  setCollections: Dispatch<SetStateAction<TreeNode[]>>,
  notify: (kind: "ok" | "err", text: string) => void,
) {
  const ref = useRef(collections);
  ref.current = collections;
  const synced = useRef(new Map<string, string>()); // código -> huella de la última versión que sabemos que está en la nube
  const busy = useRef(false);
  const warned = useRef(new Set<string>());
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [refreshing, setRefreshing] = useState<string[]>([]);

  /** Aplica la versión de la nube a la colección local. */
  const apply = (code: string, json: string, updatedAt: number, owner: boolean) => {
    let root: TreeNode;
    try {
      root = JSON.parse(json) as TreeNode;
    } catch {
      return;
    }
    if (root.type !== "folder") return;
    const h = hashJson(JSON.stringify(root));
    synced.current.set(code, h);
    setCollections((cur) =>
      cur.map((n) => (teamOf(n)?.code === code ? ({ ...root, team: { code, owner, seen: updatedAt, h } } as TreeNode) : n)),
    );
  };

  /** Sincroniza una colección. `pull` = el usuario pidió actualizar. Devuelve true si cambió algo local. */
  const syncOne = async (n: TreeNode, pull: boolean): Promise<boolean> => {
    const team = teamOf(n);
    if (!team || n.type !== "folder") return false;
    const code = team.code;
    const json = teamJson(n);
    const h = hashJson(json);
    const known = synced.current.get(code) ?? team.h;

    const doPush = async () => {
      const stamp = await teamPush(code, json);
      synced.current.set(code, h);
      setCollections((cur) =>
        cur.map((c) => {
          const tm = teamOf(c);
          return tm?.code === code ? ({ ...c, team: { ...tm, seen: stamp, h } } as TreeNode) : c;
        }),
      );
    };

    if (known === undefined) {
      // Sin referencia de la última sincronización: se mira la fecha; si alguien subió algo más nuevo, se baja; si no, se sube lo local.
      const doc = await teamPull(code, team.seen);
      if (doc) {
        apply(code, doc.json, doc.updatedAt, doc.owner);
        return true;
      }
      await doPush();
    } else if (h !== known) {
      await doPush();
    } else if (pull) {
      const doc = await teamPull(code, team.seen);
      if (doc) {
        apply(code, doc.json, doc.updatedAt, doc.owner);
        return true;
      }
    }
    return false;
  };

  /** Recorre las colecciones de equipo (todas, o solo la de `only`). */
  const run = async (pull: boolean, only?: string): Promise<"changed" | "same" | "failed"> => {
    while (busy.current) await sleep(150);
    busy.current = true;
    let changed = false;
    let failed = false;
    try {
      for (const n of ref.current) {
        const team = teamOf(n);
        if (!team || (only && team.code !== only)) continue;
        const code = team.code;
        try {
          if (await syncOne(n, pull)) changed = true;
          warned.current.delete(code);
        } catch (e) {
          failed = true;
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
          } else if (pull) {
            notifyRef.current("err", msg || t("Error desconocido")); // el usuario lo pidió: se le dice qué falló
          } else if (!warned.current.has(code)) {
            warned.current.add(code); // en segundo plano: un aviso por fallo
            if (msg && !/sin conexión|No has iniciado/i.test(msg)) notifyRef.current("err", msg);
          }
        }
      }
    } finally {
      busy.current = false;
    }
    return failed ? "failed" : changed ? "changed" : "same";
  };

  // Subida tras guardar cambios (se ignora el arranque: no hay nada nuevo que subir).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!collections.some((n) => teamOf(n))) return;
    const id = setTimeout(() => void run(false), 2500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections]);

  return {
    /** Marca un JSON como ya sincronizado (al compartir o unirse). */
    markSynced: (code: string, json: string) => synced.current.set(code, hashJson(json)),
    forget: (code: string) => synced.current.delete(code),
    /** Sube los cambios pendientes de las colecciones de equipo ahora mismo (antes de cerrar sesión). */
    flush: async () => {
      await run(false);
    },
    /** Olvida todo el estado de sincronización (al cerrar sesión). */
    reset: () => {
      synced.current.clear();
      warned.current.clear();
    },
    /** Códigos de las colecciones que se están actualizando ahora mismo (la rueda gira). */
    refreshing,
    /** Botón «Actualizar»: mira la fecha y baja la colección solo si hay algo más nuevo. */
    refresh: async (code: string) => {
      setRefreshing((r) => (r.includes(code) ? r : [...r, code]));
      try {
        const r = await run(true, code);
        if (r !== "failed") notifyRef.current("ok", r === "changed" ? t("Colección actualizada.") : t("Ya tienes la última versión."));
      } finally {
        setRefreshing((r) => r.filter((c) => c !== code));
      }
    },
  };
}
