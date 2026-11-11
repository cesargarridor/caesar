import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy } from "lucide-react";

interface Props {
  text: string;
  /** true = visor JSON con colores, líneas y plegado; false = texto plano (solo enlaces clicables). */
  json: boolean;
  onOpen: (url: string) => void;
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;
const URL_RE = /(https?:\/\/[^\s"'<>\\]+)/g;
const MAX_HIGHLIGHT = 600_000; // por encima, texto plano para no congelar la UI

// Todo se renderiza como nodos React (nunca innerHTML): el contenido remoto no puede inyectar HTML.
function linkify(text: string, keyBase: string, onOpen: (u: string) => void): ReactNode[] {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part;
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
          {url}
        </span>
        {tail}
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

function renderTok(t: Tok, i: number, onOpen: (u: string) => void): ReactNode {
  if (t.k === "str") {
    return (
      <span key={i} style={{ color: COLOR.str }}>
        {'"'}
        {linkify(t.s.slice(1, -1), `s${i}`, onOpen)}
        {'"'}
      </span>
    );
  }
  return <span key={i} style={{ color: COLOR[t.k] }}>{t.s}</span>;
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

  if (!model) {
    return (
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-silver">
        {big ? text : linkify(text, "p", onOpen)}
      </pre>
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
        <span className="w-12 shrink-0 select-none pr-3 text-right text-[11px] leading-6 text-slate/70">{i + 1}</span>
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
          {lt.map((t, ti) => renderTok(t, ti, onOpen))}
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
              <button onClick={() => toggle(i)} className="mx-1 rounded bg-fg/10 px-1.5 text-[11px] text-silver hover:bg-fg/20">
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
    <div className="font-mono text-[13px] leading-6">
      <div className="sticky top-0 z-10 flex items-center gap-4 bg-deep px-4 py-1 text-[11px] text-slate">
        <span>{lines.length} líneas</span>
        <button onClick={() => setCollapsed(new Set(foldStarts))} className="flex items-center gap-1 hover:text-mist">
          <ChevronsDownUp size={13} /> Plegar todo
        </button>
        <button onClick={() => setCollapsed(new Set())} className="flex items-center gap-1 hover:text-mist">
          <ChevronsUpDown size={13} /> Expandir todo
        </button>
      </div>
      <div className="px-2 pb-4">{rows}</div>
    </div>
  );
}
