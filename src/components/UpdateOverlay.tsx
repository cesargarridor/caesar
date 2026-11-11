import { Download } from "lucide-react";

interface Props {
  version: string;
  downloaded: number;
  total: number | null;
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/** Pantalla bloqueante mientras se descarga e instala una actualización (la app se reinicia sola). */
export default function UpdateOverlay({ version, downloaded, total }: Props) {
  const pct = total ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-deep/95 p-8">
      <div className="glass w-full max-w-sm rounded-2xl bg-kelp p-8 text-center">
        <Download size={28} className="mx-auto mb-3 text-aqua" />
        <h2 className="text-xl text-mist">Actualizando a la v{version}</h2>
        <p className="mt-1 text-sm text-slate">Caesar se reiniciará solo al terminar. Tus pestañas y borradores se conservan.</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-deep">
          <div
            className={`h-full rounded-full ${pct === null ? "w-1/3 animate-pulse" : ""}`}
            style={{ width: pct === null ? undefined : `${pct}%`, background: "var(--t-iris)" }}
          />
        </div>
        <p className="mt-2 text-xs text-slate">
          {pct === null ? "Descargando…" : `${pct}% · ${mb(downloaded)} / ${mb(total!)} MB`}
        </p>
      </div>
    </div>
  );
}
