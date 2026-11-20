import { Braces, Plug, Plus } from "lucide-react";
import CatLogo from "./CatLogo";
import { t } from "../lib/i18n";

interface Props {
  onNew: () => void;
  onNewWs: () => void;
  onNewGql?: () => void;
  /** Atajo actual de «Nueva pestaña» (ya formateado), si tiene. */
  newCombo?: string;
}

/** Pantalla sin pestañas abiertas: gato en gris casi invisible al fondo, título y atajos de inicio. */
export default function EmptyTabs({ onNew, onNewWs, onNewGql, newCombo }: Props) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
        style={{ filter: "grayscale(1)", opacity: 0.04 }}
      >
        <CatLogo size={420} />
      </div>
      <div className="relative">
        <h2 className="text-2xl font-semibold text-mist">{t("Empieza cuando quieras")}</h2>
        <p className="mt-2 text-sm text-slate">{t("Abre una petición de tus colecciones o crea una nueva.")}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button onClick={onNew} className="btn-aurora flex items-center gap-2 px-5 py-2 text-sm font-semibold">
            <Plus size={15} aria-hidden="true" />
            {t("Nueva petición")}
            {newCombo && <kbd className="rounded bg-fg/15 px-1.5 py-0.5 font-sans text-[11px] font-normal">{newCombo}</kbd>}
          </button>
          {onNewGql && (
            <button
              onClick={onNewGql}
              className="flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm text-slate hover:bg-fg/10 hover:text-mist"
            >
              <Braces size={15} aria-hidden="true" />
              {t("Nueva GraphQL")}
            </button>
          )}
          <button
            onClick={onNewWs}
            className="flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm text-slate hover:bg-fg/10 hover:text-mist"
          >
            <Plug size={15} aria-hidden="true" />
            {t("Nueva WebSocket")}
          </button>
        </div>
      </div>
    </div>
  );
}
