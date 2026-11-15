import { AlertTriangle } from "lucide-react";
import { t } from "../lib/i18n";

export interface ConflictItem {
  /** Clave estable (código de la colección o "ws"). */
  key: string;
  /** Nombre de la colección o del espacio afectado. */
  name: string;
  onKeepCloud: () => void;
  onForce: () => void;
}

/** Aviso fijo cuando la nube tiene cambios de otro miembro más nuevos que la versión sobre la que se editó. */
export function ConflictBanner({ items }: { items: ConflictItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="absolute inset-x-4 top-3 z-40 flex flex-col gap-2" role="alert">
      {items.map((it) => (
        <div key={it.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-kelp px-4 py-2.5 text-xs text-amber-300 shadow-lg ring-1 ring-amber-400/60">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 text-mist">
            {t("Se han detectado cambios de otro miembro en la nube en «{0}». Tus cambios actuales entrarán en conflicto.", it.name)}
          </span>
          <button onClick={it.onKeepCloud} className="rounded-xl px-3 py-1.5 text-mist ring-1 ring-white/20 hover:bg-white/10">
            {t("Sobrescribir mis cambios")}
          </button>
          <button onClick={it.onForce} className="rounded-xl bg-amber-500/20 px-3 py-1.5 text-amber-300 ring-1 ring-amber-400/60 hover:bg-amber-500/30">
            {t("Forzar subida")}
          </button>
        </div>
      ))}
    </div>
  );
}
