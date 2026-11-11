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

export const newFolderNode = (name = "Nueva carpeta"): TreeNode => ({ type: "folder", name, children: [] });

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
