import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy, Pause, Play, RotateCcw, Search, Trash2 } from "lucide-react";
import JsonView from "./JsonView";
import { openUrl } from "../api";
import {
  closeCodeName, filterMsgs, fmtSize, fmtTime, hexDump, isBinaryType, msgBytes, prettyJson, bytesToText, type WsFilter, type WsMsg,
} from "../lib/ws";
import { clearWs, sendWs, useWsSession } from "../lib/wsStore";
import { t } from "../lib/i18n";

interface Props {
  id: string;
}

const PAGE = 300;
const MAX_RENDER_CHARS = 200_000;

const TYPE_STYLE: Record<string, string> = {
  text: "bg-fg/10 text-silver",
  binary: "bg-iris/20 text-lav",
  ping: "bg-lav/15 text-lav",
  pong: "bg-lav/15 text-lav",
};

/** Texto que se muestra de un mensaje: binario como volcado hex+ASCII, JSON con sangría. */
function body(m: WsMsg): { text: string; json: boolean } {
  if (isBinaryType(m.type)) return { text: m.size ? hexDump(msgBytes(m)) : "", json: false };
  const p = prettyJson(m.data);
  return p ? { text: p, json: true } : { text: m.data, json: false };
}

function preview(m: WsMsg): string {
  if (isBinaryType(m.type)) {
    const b = msgBytes(m).subarray(0, 48);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ") + (m.size > 48 ? " …" : "");
  }
  return m.data.slice(0, 240).replace(/\s+/g, " ");
}

function eventText(m: WsMsg): { text: string; tone: string } {
  if (m.type === "open") return { text: t("Conectado a {0}", m.data), tone: "text-leaf" };
  if (m.type === "error") return { text: `${t("Error")}: ${m.data}`, tone: "text-rose" };
  let code = 0;
  let reason = "";
  try {
    ({ code, reason } = JSON.parse(m.data) as { code: number; reason: string });
  } catch {
    /* sin detalle */
  }
  const name = closeCodeName(code);
  return { text: `${t("Conexión cerrada")} · ${code}${name ? ` ${name}` : ""}${reason ? ` · ${reason}` : ""}`, tone: "text-lav" };
}

const Row = memo(function Row({ m, open, onToggle, onResend, canResend }: { m: WsMsg; open: boolean; onToggle: (id: number) => void; onResend: (m: WsMsg) => void; canResend: boolean }) {
  const [copied, setCopied] = useState(false);
  if (m.dir === "event") {
    const e = eventText(m);
    return (
      <div className={`flex items-center gap-3 border-b border-fg/5 px-3 py-1.5 text-xs ${e.tone}`}>
        <span className="w-24 shrink-0 font-mono text-slate">{fmtTime(m.ts)}</span>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
        <span className="min-w-0 break-all">{e.text}</span>
      </div>
    );
  }
  const sent = m.dir === "sent";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(isBinaryType(m.type) ? bytesToText(msgBytes(m)) : m.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* portapapeles no disponible */
    }
  };
  const b = open ? body(m) : null;
  const shown = b && b.text.length > MAX_RENDER_CHARS ? b.text.slice(0, MAX_RENDER_CHARS) : b?.text;
  return (
    <div className="group border-b border-fg/5 text-xs">
      <div className="flex items-center gap-3 px-3 py-1.5 hover:bg-fg/5">
        <button onClick={() => onToggle(m.id)} aria-expanded={open} title={open ? t("Contraer") : t("Expandir")} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {open ? <ChevronDown size={13} className="shrink-0 text-slate" /> : <ChevronRight size={13} className="shrink-0 text-slate" />}
          <span className={`flex shrink-0 items-center ${sent ? "text-[#5ab0ff]" : "text-leaf"}`} title={sent ? t("Enviado") : t("Recibido")} aria-label={sent ? t("Enviado") : t("Recibido")}>
            {sent ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </span>
          <span className="w-24 shrink-0 font-mono text-slate">{fmtTime(m.ts)}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${TYPE_STYLE[m.type] ?? ""}`}>{m.type}</span>
          <span className="w-16 shrink-0 text-right text-slate">{fmtSize(m.size)}</span>
          {!open && <span className="min-w-0 flex-1 truncate font-mono text-mist">{preview(m) || <span className="text-slate">{t("(vacío)")}</span>}</span>}
        </button>
        <span className="flex shrink-0 items-center gap-2 opacity-60 group-hover:opacity-100">
          <button onClick={copy} title={t("Copiar mensaje")} aria-label={t("Copiar mensaje")} className="text-silver hover:text-aqua">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {sent && (m.type === "text" || m.type === "binary") && (
            <button
              onClick={() => onResend(m)}
              disabled={!canResend}
              title={canResend ? t("Reenviar este mensaje") : t("Conecta primero para poder enviar")}
              aria-label={t("Reenviar este mensaje")}
              className="text-silver hover:text-aqua disabled:opacity-40"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </span>
      </div>
      {open && b && (
        <div className="mx-3 mb-2 max-h-72 overflow-auto rounded-md bg-kelp p-2 font-mono">
          {b.json ? <JsonView text={shown ?? ""} json onOpen={(u) => void openUrl(u).catch(() => {})} /> : <pre className="whitespace-pre-wrap break-all text-mist">{shown || t("(vacío)")}</pre>}
          {m.truncated && <p className="mt-1 text-lav">{t("Contenido recortado en pantalla; el tamaño real es {0}.", fmtSize(m.size))}</p>}
        </div>
      )}
    </div>
  );
});

/** Panel inferior: línea de tiempo de mensajes con filtro, búsqueda, copia, reenvío y detalle del handshake. */
export default function WsMessages({ id }: Props) {
  const session = useWsSession(id);
  const [filter, setFilter] = useState<WsFilter>("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [showHs, setShowHs] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // Altura redimensionable (arrastrar el asa superior), recordada entre sesiones.
  const clampH = (n: number) => Math.min(Math.max(200, window.innerHeight - 160), Math.max(120, n));
  const [height, setHeight] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("caesar.wsHeight"));
      return v > 0 ? clampH(v) : 320;
    } catch {
      return 320;
    }
  });
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const y0 = e.clientY;
    const h0 = height;
    let last = height;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setHeight((last = clampH(h0 + (y0 - ev.clientY))));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      try {
        localStorage.setItem("caesar.wsHeight", String(Math.round(last)));
      } catch {
        /* sin almacenamiento */
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const filtered = useMemo(() => filterMsgs(session.msgs, filter, query), [session.msgs, filter, query]);
  const visible = filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
  const hidden = filtered.length - visible.length;

  // Auto-scroll al final salvo pausa; subir con la rueda pausa solo y volver abajo reanuda.
  useEffect(() => {
    const el = list.current;
    if (el && !paused) el.scrollTop = el.scrollHeight;
  }, [visible.length, paused, session.msgs]);
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setPaused((p) => (atEnd ? false : p || el.scrollHeight - el.scrollTop - el.clientHeight > 80));
  };

  const toggle = (mid: number) =>
    setOpenIds((s) => {
      const n = new Set(s);
      if (!n.delete(mid)) n.add(mid);
      return n;
    });
  const connected = session.status === "connected";
  const resend = (m: WsMsg) => {
    setErr(null);
    sendWs(id, m.type === "binary" ? "base64" : "text", m.data).catch((e) => setErr(String((e as Error)?.message ?? e)));
  };
  const counts = useMemo(() => {
    let s = 0;
    let r = 0;
    for (const m of session.msgs) m.dir === "sent" ? s++ : m.dir === "received" && r++;
    return { s, r };
  }, [session.msgs]);

  const seg = (v: WsFilter, label: string) => (
    <button
      key={v}
      role="radio"
      aria-checked={filter === v}
      onClick={() => setFilter(v)}
      className={`px-2.5 py-1 ${filter === v ? "bg-kelp text-mist" : "text-silver hover:text-mist"}`}
    >
      {label}
    </button>
  );
  const hs = session.handshake;

  return (
    <div style={{ height }} className="relative flex shrink-0 flex-col border-t border-fg/10 bg-deep">
      <div
        onPointerDown={startDrag}
        title={t("Arrastra para redimensionar")}
        className="group absolute -top-2 left-0 right-0 z-20 flex h-4 cursor-row-resize items-center justify-center"
      >
        <span className="h-1 w-14 rounded-full bg-fg/25 group-hover:bg-iris" />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-fg/10 px-3 py-1.5 text-xs">
        <span className="font-medium uppercase tracking-[0.12em] text-mist">{t("Mensajes")}</span>
        <span className="flex items-center gap-2 text-slate">
          <span className="flex items-center gap-0.5 text-[#5ab0ff]"><ArrowUp size={12} />{counts.s}</span>
          <span className="flex items-center gap-0.5 text-leaf"><ArrowDown size={12} />{counts.r}</span>
        </span>
        <span role="radiogroup" aria-label={t("Filtrar mensajes")} className="flex overflow-hidden rounded-md border border-fg/10">
          {seg("all", t("Todos"))}
          {seg("sent", t("Enviados"))}
          {seg("received", t("Recibidos"))}
        </span>
        <label className="flex items-center gap-1.5 rounded-md border border-fg/10 bg-kelp px-2 py-1 focus-within:border-aqua">
          <Search size={12} className="text-slate" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Buscar en los mensajes")}
            aria-label={t("Buscar en los mensajes")}
            className="w-40 bg-transparent outline-none"
          />
        </label>
        <span className="flex-1" />
        <button
          onClick={() => {
            setPaused((p) => !p);
          }}
          title={paused ? t("Reanudar el desplazamiento automático") : t("Pausar el desplazamiento automático")}
          aria-pressed={paused}
          className={`flex items-center gap-1 ${paused ? "text-lav" : "text-silver hover:text-aqua"}`}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t("Reanudar") : t("Pausar")}
        </button>
        <button
          onClick={() => {
            clearWs(id);
            setOpenIds(new Set());
            setLimit(PAGE);
          }}
          disabled={session.msgs.length === 0}
          title={t("Borrar todos los mensajes")}
          className="flex items-center gap-1 text-silver hover:text-rose disabled:opacity-40"
        >
          <Trash2 size={13} /> {t("Limpiar")}
        </button>
      </div>
      {hs && (
        <div className="border-b border-fg/10 px-3 py-1 text-xs">
          <button onClick={() => setShowHs((v) => !v)} aria-expanded={showHs} className="flex items-center gap-1.5 text-silver hover:text-mist">
            {showHs ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t("Handshake")} · <span className="text-leaf">{hs.status}</span>
            {hs.protocol && <span className="text-slate">· {t("Subprotocolo")}: <span className="text-mist">{hs.protocol}</span></span>}
          </button>
          {showHs && (
            <dl className="mt-1 grid max-h-32 grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 overflow-auto pb-1 font-mono">
              {hs.headers.map(([k, v], i) => (
                <div key={i} className="contents">
                  <dt className="text-slate">{k}</dt>
                  <dd className="break-all text-mist">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {err && <p role="alert" className="border-b border-fg/10 px-3 py-1 text-xs text-rose">{err}</p>}
      <div ref={list} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="off" aria-label={t("Mensajes")}>
        {session.msgs.length === 0 && (
          <p className="p-6 text-center text-sm text-slate">{connected ? t("Aún no hay mensajes. Envía uno desde la pestaña Mensaje.") : t("Conecta para empezar a enviar y recibir mensajes.")}</p>
        )}
        {session.msgs.length > 0 && filtered.length === 0 && <p className="p-6 text-center text-sm text-slate">{t("Ningún mensaje coincide con el filtro.")}</p>}
        {hidden > 0 && (
          <button onClick={() => setLimit((l) => l + PAGE)} className="block w-full border-b border-fg/5 py-1.5 text-xs text-silver hover:text-aqua">
            {t("Mostrar {0} anteriores", Math.min(hidden, PAGE))} ({hidden})
          </button>
        )}
        {visible.map((m) => (
          <Row key={m.id} m={m} open={openIds.has(m.id)} onToggle={toggle} onResend={resend} canResend={connected} />
        ))}
      </div>
    </div>
  );
}
