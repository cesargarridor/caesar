import { useCallback, useState } from "react";
import { Check, Copy, Maximize2, Minimize2 } from "lucide-react";
import StepList from "./StepList";
import JsonView from "./JsonView";
import { openUrl } from "../api";
import type { ResponseData, StepState } from "../types";
import type { ScriptResult } from "../lib/script";

interface Props {
  response: ResponseData | null;
  error: string | null;
  sending: boolean;
  steps: StepState[];
  /** Resultado del script de Tests de la última ejecución (null = la petición no tiene script). */
  script?: ScriptResult | null;
}

type Tab = "body" | "headers" | "timeline" | "tests";

// Correcto = verde, redirección = ámbar, error (4xx/5xx) = rojo
const statusColor = (s: number) =>
  s < 300 ? "bg-leaf/15 text-leaf" : s < 400 ? "bg-lav/15 text-lav" : "bg-rose/15 text-rose";

export default function ResponsePanel({ response, error, sending, steps, script }: Props) {
  const [rawTab, setTab] = useState<Tab>("body");
  const tab: Tab = rawTab === "tests" && !script ? "body" : rawTab; // sin script no hay pestaña Tests
  const [view, setView] = useState<"pretty" | "raw">("pretty");
  const [copied, setCopied] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const open = useCallback((url: string) => {
    setLinkError(null);
    openUrl(url).catch((e) => setLinkError(String(e)));
  }, []);

  // Altura del panel (px), redimensionable arrastrando el asa superior; se recuerda entre sesiones.
  const maxH = () => Math.max(200, window.innerHeight - 140);
  const clamp = (n: number) => Math.min(maxH(), Math.max(110, n));
  const [height, setHeight] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("caesar.respHeight"));
      return v > 0 ? clamp(v) : 384;
    } catch {
      return 384;
    }
  });
  const [prevHeight, setPrevHeight] = useState(384);
  const persist = (h: number) => {
    try {
      localStorage.setItem("caesar.respHeight", String(Math.round(h)));
    } catch {
      /* sin almacenamiento */
    }
  };
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startY = e.clientY;
    const startH = height;
    let last = height;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      last = clamp(startH + (startY - ev.clientY));
      setHeight(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      persist(last);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const toggleMax = () => {
    if (height >= maxH() - 4) {
      setHeight(prevHeight);
      persist(prevHeight);
    } else {
      setPrevHeight(height);
      setHeight(maxH());
      persist(maxH());
    }
  };

  const showPretty = view === "pretty" && response?.pretty != null;
  const text = response ? (showPretty ? response.pretty! : response.body) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* portapapeles no disponible */
    }
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] ${
        tab === id ? "border-aqua text-mist" : "border-transparent text-slate hover:text-silver"
      }`}
    >
      {label}
    </button>
  );

  const passed = script ? script.tests.filter((t) => t.ok).length : 0;
  const testsLabel = script
    ? script.tests.length
      ? `Tests ${passed}/${script.tests.length}`
      : script.errors.length
        ? "Tests ⚠"
        : "Tests"
    : "Tests";

  const total = response ? Math.max(1, response.timeline.reduce((a, s) => a + s.ms, 0)) : 1;

  return (
    <div
      style={{ height }}
      className="relative flex shrink-0 flex-col border-t border-fg/10 bg-deep"
    >
      {/* Asa para arrastrar hacia arriba y agrandar el panel (doble clic = maximizar/restaurar) */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={toggleMax}
        title="Arrastra para redimensionar · doble clic para maximizar"
        className="group absolute -top-2 left-0 right-0 z-20 flex h-4 cursor-row-resize items-center justify-center"
      >
        <span className="h-1 w-14 rounded-full bg-fg/25 group-hover:bg-iris" />
      </div>
      <div className="flex items-center gap-4 border-b border-fg/10 px-3 text-sm">
        {tabBtn("body", "Body")}
        {tabBtn("headers", response ? `Headers ${response.headers.length}` : "Headers")}
        {tabBtn("timeline", "Timeline")}
        {script && tabBtn("tests", testsLabel)}
        {tab === "body" && response && (
          <span className="flex overflow-hidden rounded-md border border-fg/10 text-xs">
            {(["pretty", "raw"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-1 capitalize ${view === v ? "bg-kelp text-mist" : "text-silver hover:text-mist"}`}
              >
                {v}
              </button>
            ))}
          </span>
        )}
        {tab === "body" && response && (
          <button onClick={copy} className="flex items-center gap-1 text-xs text-silver hover:text-aqua">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copiado" : "Copy"}
          </button>
        )}
        {response && !sending && (
          <span className="ml-auto flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              Status
              <b className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(response.status)}`}>
                {response.status} {response.statusText}
              </b>
            </span>
            <span>Time <b className="ml-1 text-sm text-lav">{response.timeMs} ms</b></span>
            <span>Size <b className="ml-1 text-sm text-lav">{(response.sizeBytes / 1024).toFixed(1)} KB</b></span>
            {response.truncated && <span className="text-lav">Truncada (10 MB)</span>}
          </span>
        )}
        <button
          onClick={toggleMax}
          title={height >= maxH() - 4 ? "Restaurar" : "Maximizar panel"}
          className={`text-silver hover:text-mist ${response && !sending ? "" : "ml-auto"}`}
        >
          {height >= maxH() - 4 ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>

      {linkError && <p className="bg-rose/10 px-4 py-1 text-xs text-rose">{linkError}</p>}

      <div className="relative flex-1 overflow-auto">
        {sending ? (
          <p className="p-4 text-sm text-slate">Enviando…</p>
        ) : error ? (
          <div className="mx-auto max-w-xl p-6">
            <p className="eyebrow mb-3 text-rose">La petición falló</p>
            {steps.length > 0 && <div className="mb-4"><StepList steps={steps} /></div>}
            <p className="whitespace-pre-wrap text-sm text-rose">{error}</p>
          </div>
        ) : !response ? (
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <p className="eyebrow">Response</p>
            <p className="text-sm text-slate">Pulsa Send para ver la respuesta.</p>
          </div>
        ) : tab === "body" ? (
          <JsonView text={text} json={showPretty} onOpen={open} />
        ) : tab === "tests" && script ? (
          <div className="mx-auto max-w-3xl space-y-5 p-5 text-xs">
            {script.tests.length > 0 && (
              <section>
                <p className="eyebrow mb-2">Resultados</p>
                {script.tests.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5">
                    <span className={`shrink-0 rounded px-1.5 font-semibold ${t.ok ? "bg-leaf/15 text-leaf" : "bg-rose/15 text-rose"}`}>
                      {t.ok ? "PASS" : "FAIL"}
                    </span>
                    <span className="text-mist">{t.name}</span>
                    {t.error && <span className="text-rose">— {t.error}</span>}
                  </div>
                ))}
              </section>
            )}
            {(script.sets.length > 0 || script.unsets.length > 0) && (
              <section>
                <p className="eyebrow mb-2">Variables actualizadas</p>
                {script.sets.map((s) => (
                  <div key={s.key} className="flex gap-2 py-0.5 font-mono">
                    <span className="shrink-0 text-lav">{s.key}</span>
                    <span className="text-slate">=</span>
                    <span className="truncate text-silver" title={s.value}>{s.value}</span>
                  </div>
                ))}
                {script.unsets.map((k) => (
                  <div key={k} className="py-0.5 font-mono text-slate">
                    <span className="text-lav">{k}</span> eliminada
                  </div>
                ))}
              </section>
            )}
            {script.logs.length > 0 && (
              <section>
                <p className="eyebrow mb-2">Console</p>
                {script.logs.map((l, i) => (
                  <pre key={i} className="whitespace-pre-wrap break-all font-mono text-silver">{l}</pre>
                ))}
              </section>
            )}
            {script.errors.length > 0 && (
              <section>
                <p className="eyebrow mb-2 text-rose">Avisos del script</p>
                {script.errors.map((e, i) => (
                  <p key={i} className="py-0.5 text-rose">{e}</p>
                ))}
              </section>
            )}
            {!script.tests.length && !script.sets.length && !script.unsets.length && !script.logs.length && !script.errors.length && (
              <p className="text-slate">El script se ejecutó sin resultados.</p>
            )}
          </div>
        ) : tab === "headers" ? (
          <table className="w-full text-xs">
            <tbody>
              {response.headers.map(([k, v], i) => (
                <tr key={i} className="border-b border-fg/5 align-top">
                  <td className="w-56 whitespace-nowrap px-4 py-1.5 font-medium" style={{ color: "var(--t-r-key)" }}>{k}</td>
                  <td className="break-all px-2 py-1.5 font-mono" style={{ color: "var(--t-r-str)" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3 p-6">
            {response.timeline.map((s) => (
              <div key={s.id} className="text-xs">
                <div className="mb-1 flex justify-between">
                  <span className="text-mist">{s.label} <span className="text-slate">{s.detail}</span></span>
                  <span className="font-mono text-lav">{s.ms} ms</span>
                </div>
                <div className="h-1.5 rounded-sm bg-kelp">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(2, (s.ms / total) * 100)}%`,
                      background: "var(--t-iris)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
