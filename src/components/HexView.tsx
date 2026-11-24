import { t } from "../lib/i18n";

const LIMIT = 8192;

/** Vista hexadecimal de los primeros bytes de una respuesta binaria. */
export default function HexView({ b64, size, type }: { b64: string; size: number; type: string }) {
  let rows: { off: string; hex: string; ascii: string }[] = [];
  try {
    const bin = atob(b64.slice(0, Math.ceil((LIMIT * 4) / 3) + 4));
    const n = Math.min(bin.length, LIMIT);
    for (let o = 0; o < n; o += 16) {
      const chunk = Array.from(bin.slice(o, Math.min(o + 16, n)), (c) => c.charCodeAt(0));
      rows.push({
        off: o.toString(16).padStart(8, "0"),
        hex: chunk.map((b) => b.toString(16).padStart(2, "0")).join(" "),
        ascii: chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join(""),
      });
    }
  } catch {
    rows = [];
  }
  return (
    <div className="h-full overflow-auto p-3">
      <p className="mb-2 text-xs text-slate">
        {t("Respuesta binaria")} · {type || "application/octet-stream"} · {(size / 1024).toFixed(1)} KB · {t("Vista hexadecimal de los primeros 8 KB. Usa «Guardar archivo» para descargarla entera.")}
      </p>
      <pre className="font-mono text-[11px] leading-5 text-silver">
        {rows.map((r) => (
          <div key={r.off}>
            <span className="text-slate">{r.off}</span>  <span style={{ color: "var(--t-r-str)" }}>{r.hex.padEnd(47, " ")}</span>  <span className="text-lav">{r.ascii}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
