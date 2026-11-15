import { Eye, Layers } from "lucide-react";
import type { ProfilesState } from "../types";
import { t } from "../lib/i18n";

/** Perfil de variables: cambia el contexto de todo el espacio, así que vive arriba a la derecha, junto a las pestañas. */
export default function ProfileBar({ profiles, onProfile, onManage, onShowResolved }: { profiles: ProfilesState; onProfile: (id: string | null) => void; onManage: () => void; onShowResolved?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 pb-1 text-xs text-slate">
      <Layers size={13} aria-hidden />
      <select
        value={profiles.active ?? ""}
        onChange={(e) => (e.target.value === "__manage__" ? onManage() : onProfile(e.target.value || null))}
        title={t("Perfil de variables que se usa al enviar")}
        aria-label={t("Perfil de variables")}
        className="max-w-[12rem] rounded-[10px] bg-kelp px-3 py-1.5 text-xs font-semibold text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
      >
        <option value="">{t("Sin perfil")}</option>
        {profiles.list.map((p) => (
          <option key={p.id} value={p.id}>{p.name || t("Sin nombre")}</option>
        ))}
        <option value="__manage__">{t("Gestionar perfiles…")}</option>
      </select>
      {onShowResolved && (
        <button onClick={onShowResolved} className="text-slate hover:text-aqua" title={t("Ver variables resueltas (globales + colección + perfil)")} aria-label={t("Ver variables resueltas (globales + colección + perfil)")}>
          <Eye size={15} />
        </button>
      )}
    </div>
  );
}
