import type { RequestNode, RequestState, TreeNode } from "../types";
import { buildUrl } from "./url";

const idx = (path: string) => path.split("/").map(Number);

export function getAt(nodes: TreeNode[], path: string): TreeNode | null {
  let list = nodes;
  let node: TreeNode | null = null;
  for (const i of idx(path)) {
    node = list[i] ?? null;
    if (!node) return null;
    list = node.type === "folder" ? node.children : [];
  }
  return node;
}

function updateIdx(nodes: TreeNode[], p: number[], fn: (n: TreeNode) => TreeNode | null): TreeNode[] {
  const [head, ...rest] = p;
  return nodes.flatMap((n, i) => {
    if (i !== head) return [n];
    if (rest.length === 0) {
      const r = fn(n);
      return r ? [r] : [];
    }
    return n.type === "folder" ? [{ ...n, children: updateIdx(n.children, rest, fn) }] : [n];
  });
}

export const updateAt = (nodes: TreeNode[], path: string, fn: (n: TreeNode) => TreeNode | null) =>
  updateIdx(nodes, idx(path), fn);

export const removeAt = (nodes: TreeNode[], path: string) => updateAt(nodes, path, () => null);

export const renameAt = (nodes: TreeNode[], path: string, name: string) =>
  updateAt(nodes, path, (n) => ({ ...n, name }));

/** Añade un hijo a una carpeta y devuelve el nuevo árbol y la ruta del hijo creado. */
export function addChild(nodes: TreeNode[], path: string, child: TreeNode): { nodes: TreeNode[]; path: string } {
  const target = getAt(nodes, path);
  const n = target && target.type === "folder" ? target.children.length : 0;
  return {
    nodes: updateAt(nodes, path, (t) => (t.type === "folder" ? { ...t, children: [...t.children, child] } : t)),
    path: `${path}/${n}`,
  };
}

export const newRequestNode = (name = "Nueva petición"): RequestNode => ({
  type: "request",
  name,
  method: "GET",
  url: "",
  headers: [],
  body: { mode: "none", raw: "", formdata: [], urlencoded: [] },
  auth: { type: "none" },
});

let uidSeq = 0;
export const newUid = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${(uidSeq++).toString(36)}`;

export const newFolderNode = (name = "Nueva carpeta"): TreeNode => ({ type: "folder", name, children: [], uid: newUid() });

/** Da un id estable a toda carpeta que no lo tenga (colecciones guardadas antes o importadas). */
export function ensureIds(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => (n.type === "folder" ? { ...n, uid: n.uid ?? newUid(), children: ensureIds(n.children) } : n));
}

/** Ruta de una pestaña tras borrar el nodo `deleted` (null si estaba dentro de lo borrado). */
export function pathAfterDelete(tabPath: string | null, deleted: string): string | null {
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

/** Ruta tras insertar un hijo en la posición `index` de la carpeta `parent` ("" = nivel raíz). */
export function pathAfterInsert(p: string, parent: string, index: number): string {
  const pp = parent === "" ? [] : parent.split("/");
  const tp = p.split("/");
  if (tp.length <= pp.length || !pp.every((s, i) => tp[i] === s)) return p;
  if (Number(tp[pp.length]) >= index) tp[pp.length] = String(Number(tp[pp.length]) + 1);
  return tp.join("/");
}

/** Posición de inserción: las carpetas van justo después de la última carpeta; las peticiones, al final. */
function insertionIndex(list: TreeNode[], child: TreeNode): number {
  if (child.type !== "folder") return list.length;
  let last = -1;
  list.forEach((n, i) => {
    if (n.type === "folder") last = i;
  });
  return last + 1;
}

function insertInto(nodes: TreeNode[], parent: string, child: TreeNode): { nodes: TreeNode[]; index: number } {
  if (parent === "") {
    const index = insertionIndex(nodes, child);
    return { nodes: [...nodes.slice(0, index), child, ...nodes.slice(index)], index };
  }
  const target = getAt(nodes, parent);
  const list = target && target.type === "folder" ? target.children : [];
  const index = insertionIndex(list, child);
  return {
    nodes: updateAt(nodes, parent, (t) =>
      t.type === "folder" ? { ...t, children: [...list.slice(0, index), child, ...list.slice(index)] } : t,
    ),
    index,
  };
}

/** Crea una carpeta dentro de `parent`, justo después de la última carpeta que ya tenga. */
export function addFolder(nodes: TreeNode[], parent: string, child: TreeNode) {
  const r = insertInto(nodes, parent, child);
  return { nodes: r.nodes, index: r.index, path: `${parent}/${r.index}` };
}

/** ¿Se puede soltar `from` dentro de `to` ("root" = nivel raíz)? */
export function canMove(from: string, to: string): boolean {
  if (!from.includes("/")) return false; // las colecciones no se mueven
  const parent = from.slice(0, from.lastIndexOf("/"));
  if (to === "root") return true;
  if (to === from || to.startsWith(`${from}/`)) return false;
  return to !== parent;
}

/** ¿Se puede colocar `from` justo antes/después de `target` (ambos dentro de una colección)? */
export function canMoveRelative(from: string, target: string): boolean {
  if (!from.includes("/") || !target.includes("/")) return false;
  return target !== from && !target.startsWith(`${from}/`);
}

/** Mueve `from` para que quede justo antes o después de `target`, en la carpeta que contiene a `target`. */
export function moveRelative(nodes: TreeNode[], from: string, target: string, pos: "before" | "after") {
  if (!canMoveRelative(from, target)) return null;
  const node = getAt(nodes, from);
  const adj = pathAfterDelete(target, from);
  if (!node || adj === null) return null;
  const segs = adj.split("/");
  const targetIdx = Number(segs.pop());
  const parent = segs.join("/");
  const index = targetIdx + (pos === "after" ? 1 : 0);
  const cut = (p: string) => p.slice(0, p.lastIndexOf("/"));
  if (cut(from) === cut(target) && index === Number(from.slice(from.lastIndexOf("/") + 1))) return null; // ya está ahí
  const removed = removeAt(nodes, from);
  const dest = getAt(removed, parent);
  if (!dest || dest.type !== "folder") return null;
  const out = updateAt(removed, parent, (t) =>
    t.type === "folder" ? { ...t, children: [...t.children.slice(0, index), node, ...t.children.slice(index)] } : t,
  );
  const newPath = `${parent}/${index}`;
  const mapPath = (p: string): string => {
    if (p === from || p.startsWith(`${from}/`)) return newPath + p.slice(from.length);
    const q = pathAfterDelete(p, from);
    return q === null ? p : pathAfterInsert(q, parent, index);
  };
  return { nodes: out, path: newPath, mapPath, parent };
}

/** Reordena las colecciones: pone `from` antes o después de `to` (ambas son índices del nivel raíz). */
export function moveCollection(nodes: TreeNode[], from: string, to: string, pos: "before" | "after") {
  const i = Number(from);
  const j = Number(to);
  if (!Number.isInteger(i) || !Number.isInteger(j) || i === j || !nodes[i] || !nodes[j]) return null;
  const order = nodes.map((_, k) => k).filter((k) => k !== i);
  const at = order.indexOf(j) + (pos === "after" ? 1 : 0);
  order.splice(at, 0, i);
  if (order.every((k, n) => k === n)) return null;
  const newIndex = new Map(order.map((k, n) => [k, n]));
  const mapPath = (p: string): string => {
    const [head, ...rest] = p.split("/");
    return [String(newIndex.get(Number(head)) ?? head), ...rest].join("/");
  };
  return { nodes: order.map((k) => nodes[k]), path: String(newIndex.get(i)), mapPath };
}

/** Mueve un nodo a otra carpeta (o al nivel raíz). Devuelve el árbol nuevo y cómo reubicar rutas abiertas. */
export function moveNode(nodes: TreeNode[], from: string, to: string) {
  if (!canMove(from, to)) return null;
  const node = getAt(nodes, from);
  if (!node) return null;
  const dest = to === "root" ? "" : (pathAfterDelete(to, from) as string);
  const removed = removeAt(nodes, from);
  const r = insertInto(removed, dest, node);
  const newPath = dest === "" ? String(r.index) : `${dest}/${r.index}`;
  const mapPath = (p: string): string => {
    if (p === from || p.startsWith(`${from}/`)) return newPath + p.slice(from.length);
    const q = pathAfterDelete(p, from);
    return q === null ? p : pathAfterInsert(q, dest, r.index);
  };
  return { nodes: r.nodes, path: newPath, mapPath };
}


/** Estado de la UI -> nodo guardable en la colección. */
export function nodeFromRequest(name: string, req: RequestState): RequestNode {
  return {
    type: "request",
    name,
    method: req.method,
    url: buildUrl(req.url, req.params),
    headers: req.headers,
    body: { ...req.body },
    auth: { ...req.auth },
    tests: req.tests ?? "",
  };
}

export function suggestName(req: RequestState): string {
  try {
    const u = new URL(buildUrl(req.url, []).replace(/\{\{[^}]*\}\}/g, "x"));
    return `${req.method} ${u.pathname === "/" ? u.host : u.pathname}`;
  } catch {
    return "Nueva petición";
  }
}
