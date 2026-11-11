import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Search } from "lucide-react";
import FindBar from "./FindBar";
import { findAll, MAX_MATCHES, wrapIndex } from "../lib/find";

interface Props {
  text: string;
  /** true = visor JSON con colores, líneas y plegado; false = texto plano (solo enlaces clicables). */
  json: boolean;
  onOpen: (url: string) => void;
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;
const URL_RE = /(https?:\/\/[^\s"'<>\\]+)/g;
const MAX_HIGHLIGHT = 600_000; // por encima, texto plano para no congelar la UI

/** Coincidencia de búsqueda en coordenadas locales del texto que se renderiza; `i` = índice global. */
interface Range { s: number; e: number; i: number }

/** Parte `text` (que empieza en `off`) resaltando las coincidencias que lo solapan. */
function markText(text: string, off: number, ranges: Range[], cur: number, kb: string): ReactNode[] {
  if (!ranges.length || !text) return [text];
  const out: ReactNode[] = [];
  const end = off + text.length;
  let pos = 0;
  for (const r of ranges) {
    if (r.e <= off || r.s >= end) continue;
    const a = Math.max(r.s, off) - off;
    const b = Math.min(r.e, end) - off;
    if (a > pos) out.push(text.slice(pos, a));
    const isCur = r.i === cur;
    out.push(
      <mark
        key={`${kb}-${r.i}-${a}`}
        data-cur-match={isCur ? "" : undefined}
        style={{
          color: "inherit",
          borderRadius: 2,
          background: isCur ? "color-mix(in srgb, var(--t-hl) 75%, transparent)" : "color-mix(in srgb, var(--t-hl) 35%, transparent)",
          outline: isCur ? "1px solid var(--t-hl)" : undefined,
        }}
      >
        {text.slice(a, b)}
      </mark>,
    );
    pos = b;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

// Todo se renderiza como nodos React (nunca innerHTML): el contenido remoto no puede inyectar HTML.
function linkify(text: string, keyBase: string, onOpen: (u: string) => void, off = 0, ranges: Range[] = [], cur = -1): ReactNode[] {
  let o = off;
  return text.split(URL_RE).map((part, i) => {
    const start = o;
    o += part.length;
    if (i % 2 === 0) return markText(part, start, ranges, cur, `${keyBase}-${i}`);
    const m = part.match(/^(.*?)([.,;:)\]]*)$/);
    const url = m ? m[1] : part;
    const tail = m ? m[2] : "";
    return (
      <span key={`${keyBase}-${i}`}>
        <span
          role="link"
          tabIndex={0}
          title="Abrir en el navegador"
          onClick={() => onOpen(url)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(url)}
          style={{ color: "var(--t-r-link)" }} className="cursor-pointer font-normal underline decoration-1 underline-offset-2 hover:decoration-2"
        >
          {markText(url, start, ranges, cur, `${keyBase}-${i}u`)}
        </span>
        {markText(tail, start + url.length, ranges, cur, `${keyBase}-${i}t`)}
      </span>
    );
  });
}

type Kind = "key" | "str" | "num" | "bool" | "null" | "punc" | "raw";
interface Tok { k: Kind; s: string }

function tokenizeLine(line: string): { indent: number; toks: Tok[] } {
  const lead = line.match(/^ */)![0].length;
  const body = line.slice(lead);
  const toks: Tok[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) toks.push({ k: "raw", s: body.slice(last, i) });
    const t = m[0];
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        toks.push({ k: "key", s: m[1] });
        toks.push({ k: "punc", s: m[2] });
      } else toks.push({ k: "str", s: m[1] });
    } else if (t === "true" || t === "false") toks.push({ k: "bool", s: t });
    else if (t === "null") toks.push({ k: "null", s: t });
    else if (/^[{}[\],:]$/.test(t)) toks.push({ k: "punc", s: t });
    else toks.push({ k: "num", s: t });
    last = i + t.length;
  }
  if (last < body.length) toks.push({ k: "raw", s: body.slice(last) });
  return { indent: Math.floor(lead / 2), toks };
}

const COLOR: Record<Kind, string> = {
  key: "var(--t-r-key)",   // clave
  str: "var(--t-r-str)",   // valor texto
  num: "var(--t-r-num)",
  bool: "var(--t-r-bool)",
  null: "var(--t-r-nul)",
  punc: "var(--t-r-punc)",
  raw: "var(--t-silver)",
};

function renderTok(t: Tok, i: number, onOpen: (u: string) => void, off: number, ranges: Range[], cur: number): ReactNode {
  if (t.k === "str") {
    const inner = t.s.slice(1, -1);
    return (
      <span key={i} style={{ color: COLOR.str }}>
        {markText('"', off, ranges, cur, `q${i}`)}
        {linkify(inner, `s${i}`, onOpen, off + 1, ranges, cur)}
        {markText('"', off + 1 + inner.length, ranges, cur, `e${i}`)}
      </span>
    );
  }
  return <span key={i} style={{ color: COLOR[t.k] }}>{markText(t.s, off, ranges, cur, `t${i}`)}</span>;
}

export default function JsonView({ text, json, onOpen }: Props) {
  const big = text.length > MAX_HIGHLIGHT;

  const model = useMemo(() => {
    if (!json || big) return null;
    const lines = text.split("\n");
    const ends = new Map<number, number>();
    const stack: number[] = [];
    lines.forEach((l, i) => {
      const t = l.trim();
      if (/^[}\]]/.test(t) && stack.length) ends.set(stack.pop()!, i);
      if (/[{[]$/.test(t)) stack.push(i);
    });
    return { lines, ends, toks: lines.map(tokenizeLine) };
  }, [text, json, big]);

  const [copied, setCopied] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => setCollapsed(new Set()), [text]);

  const toggle = useCallback((i: number) => {
    setCollapsed((cur) => {
      const n = new Set(cur);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }, []);

  // ── búsqueda (Ctrl+F) ──
  const box = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cur, setCur] = useState(0);
  const [focusKey, setFocusKey] = useState(0);

  const info = useMemo(() => {
    const empty = { total: 0, base: [] as number[], lineRanges: [] as Range[][], all: [] as Range[] };
    if (!findOpen || !query) return empty;
    const n = query.length;
    if (model) {
      let total = 0;
      const base: number[] = [];
      const lineRanges: Range[][] = [];
      model.lines.forEach((l) => {
        base.push(total);
        const body = l.slice(l.match(/^ */)![0].length); // las sangrías se dibujan como guías: no se buscan
        const starts = total >= MAX_MATCHES ? [] : findAll(body, query, MAX_MATCHES - total);
        lineRanges.push(starts.map((s, k) => ({ s, e: s + n, i: total + k })));
        total += starts.length;
      });
      return { total, base, lineRanges, all: [] as Range[] };
    }
    const starts = findAll(text, query);
    return { total: starts.length, base: [] as number[], lineRanges: [] as Range[][], all: starts.map((s, k) => ({ s, e: s + n, i: k })) };
  }, [findOpen, query, model, text]);
  const idx = wrapIndex(cur, info.total);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const open = () => {
      const sel = window.getSelection()?.toString() ?? "";
      if (sel && sel.length <= 100 && !sel.includes("\n")) {
        setQuery(sel);
        setCur(0);
      }
      setFindOpen(true);
      setFocusKey((k) => k + 1);
    };
    el.addEventListener("caesar-find", open);
    return () => el.removeEventListener("caesar-find", open);
  }, []);

  // Al cambiar de coincidencia: desplegar los bloques plegados que la contienen y centrarla.
  useEffect(() => {
    if (!findOpen || !info.total) return;
    if (model) {
      let L = 0;
      while (L + 1 < info.base.length && info.base[L + 1] <= idx) L++;
      setCollapsed((c) => {
        const n = new Set(c);
        let changed = false;
        for (const s of c) {
          const e = model.ends.get(s);
          if (e !== undefined && s < L && L <= e) {
            n.delete(s);
            changed = true;
          }
        }
        return changed ? n : c;
      });
    }
    const t = setTimeout(() => box.current?.querySelector("[data-cur-match]")?.scrollIntoView({ block: "center" }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, query, findOpen]);

  const findBar = findOpen ? (
    <FindBar
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setCur(0);
      }}
      index={idx}
      total={info.total}
      onNext={() => setCur((c) => c + 1)}
      onPrev={() => setCur((c) => c - 1)}
      onClose={() => setFindOpen(false)}
      focusKey={focusKey}
    />
  ) : null;

  const wrapKeys = (e: React.KeyboardEvent) => {
    if (!findOpen) return;
    if (e.key === "Escape") setFindOpen(false);
    else if (e.key === "F3") {
      e.preventDefault();
      setCur((c) => c + (e.shiftKey ? -1 : 1));
    }
  };

  if (!model) {
    return (
      <div ref={box} data-find-scope="response" tabIndex={-1} onKeyDown={wrapKeys} className="outline-none">
        {findBar && <div className="sticky top-0 z-10 flex justify-end bg-deep px-4 py-1">{findBar}</div>}
        <pre
          style={{ fontSize: "var(--fs-resp, 13px)", lineHeight: 1.6 }}
          className="whitespace-pre-wrap break-words p-4 font-mono text-silver"
        >
          {big ? markText(text, 0, info.all, idx, "b") : linkify(text, "p", onOpen, 0, info.all, idx)}
        </pre>
      </div>
    );
  }

  /** Valor "copiable" de una línea (clave: valor, o elemento de array): sin comillas ni escapes. */
  const valueOf = (lt: Tok[]): string | null => {
    const first = lt.find((t) => t.k !== "raw");
    if (!first) return null;
    const v = first.k === "key" ? lt.slice(lt.indexOf(first) + 2).find((t) => t.k !== "raw") : first;
    if (!v || !["str", "num", "bool", "null"].includes(v.k)) return null;
    if (v.k !== "str") return v.s;
    try {
      return JSON.parse(v.s) as string;
    } catch {
      return v.s.slice(1, -1);
    }
  };

  const copyValue = async (i: number, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 2000);
    } catch {
      /* sin permiso de portapapeles */
    }
  };

  const { lines, ends, toks } = model;
  const rows: ReactNode[] = [];
  for (let n = 0; n < lines.length; ) {
    const i = n; // constante por iteración: los onClick no deben ver el avance del bucle
    const end = ends.get(i);
    const isFolded = end !== undefined && collapsed.has(i);
    const { indent, toks: lt } = toks[i];
    const foldable = end !== undefined;
    const closing = isFolded ? lines[end!].trim() : "";

    rows.push(
      <div key={i} className="group relative flex hover:bg-fg/5">
        <span className="w-12 shrink-0 select-none pr-3 text-right text-[0.85em] leading-[inherit] text-slate/70">{i + 1}</span>
        <span className="flex w-5 shrink-0 items-center justify-center">
          {foldable && (
            <button onClick={() => toggle(i)} className="text-slate hover:text-mist" title={isFolded ? "Expandir" : "Plegar"}>
              {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
          {Array.from({ length: indent }, (_, g) => (
            <span key={g} className="inline-block w-[2ch] border-l border-fg/10 align-top">&nbsp;</span>
          ))}
          {(() => {
            let off = 0;
            const ranges = info.lineRanges[i] ?? [];
            return lt.map((t, ti) => {
              const node = renderTok(t, ti, onOpen, off, ranges, idx);
              off += t.s.length;
              return node;
            });
          })()}
          {!isFolded && (() => {
            const v = valueOf(lt);
            if (v === null) return null;
            const done = copied === i;
            return (
              <button
                onClick={() => copyValue(i, v)}
                title={done ? "Copiado" : "Copiar solo el valor"}
                className={`ml-2 inline-flex h-5 w-5 items-center justify-center rounded align-middle hover:bg-fg/10 ${
                  done ? "text-leaf opacity-100" : "text-slate opacity-0 hover:text-mist group-hover:opacity-100"
                }`}
              >
                {done ? <Check size={13} /> : <Copy size={13} />}
              </button>
            );
          })()}
          {isFolded && (
            <>
              <button onClick={() => toggle(i)} className="mx-1 rounded bg-fg/10 px-1.5 text-[0.85em] text-silver hover:bg-fg/20">
                …
              </button>
              <span style={{ color: COLOR.punc }}>{closing}</span>
            </>
          )}
        </span>
      </div>,
    );
    n = isFolded ? end! + 1 : i + 1;
  }

  const foldStarts = [...ends.keys()].filter((k) => k !== 0);

  return (
    <div
      ref={box}
      data-find-scope="response"
      tabIndex={-1}
      onKeyDown={wrapKeys}
      style={{ fontSize: "var(--fs-resp, 13px)", lineHeight: "calc(var(--fs-resp, 13px) * 1.846)" }}
      className="font-mono outline-none"
    >
      <div className="sticky top-0 z-10 flex items-center gap-4 whitespace-nowrap bg-deep px-4 py-1 text-[11px] text-slate">
        <span>{lines.length} líneas</span>
        <button onClick={() => setCollapsed(new Set(foldStarts))} className="flex items-center gap-1 hover:text-mist">
          <ChevronsDownUp size={13} /> Plegar todo
        </button>
        <button onClick={() => setCollapsed(new Set())} className="flex items-center gap-1 hover:text-mist">
          <ChevronsUpDown size={13} /> Expandir todo
        </button>
        <button
          onClick={() => {
            setFindOpen(true);
            setFocusKey((k) => k + 1);
          }}
          className="flex items-center gap-1 hover:text-mist"
          title="Buscar (Ctrl+F)"
        >
          <Search size={13} /> Buscar
        </button>
        {findBar && <span className="ml-auto font-sans text-xs">{findBar}</span>}
      </div>
      <div className="px-2 pb-4">{rows}</div>
    </div>
  );
}
