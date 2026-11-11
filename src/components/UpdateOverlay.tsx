import CatLogo from "./CatLogo";
import { t } from "../lib/i18n";

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-deep p-8">
      <div className="w-full max-w-sm text-center">
        <div className="cat-bounce mx-auto mb-5 w-fit">
          <CatLogo size={112} />
        </div>
        <h2 className="cosmic-text text-3xl font-normal tracking-[-0.02em]">Caesar</h2>
        <p className="mt-2 text-sm text-mist">{t("Actualizando a la v{0}", version)}</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-kelp">
          <div
            className={`h-full rounded-full ${pct === null ? "bar-indeterminate w-1/3" : "transition-[width] duration-300"}`}
            style={{ width: pct === null ? undefined : `${pct}%`, background: "var(--t-iris)" }}
          />
        </div>
        <p className="mt-2 text-xs text-slate">
          {pct === null ? t("Descargando…") : `${pct}% · ${mb(downloaded)} / ${mb(total!)} MB`}
        </p>
        <p className="mt-4 text-xs text-slate">{t("Caesar se reiniciará solo. Tus pestañas y borradores se conservan.")}</p>
      </div>
    </div>
  );
}
