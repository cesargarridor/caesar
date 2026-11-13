import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import KVEditor from "./KVEditor";
import { newProfileId } from "../lib/workspaces";
import type { ProfilesState, VarProfile } from "../types";
import { t } from "../lib/i18n";

interface Props {
  profiles: ProfilesState;
  onChange: (p: ProfilesState) => void;
}

/** Gestor de perfiles de variables (como los Environments de Postman): crear, renombrar, duplicar, borrar, activar y editar sus variables. */
export default function ProfilesPanel({ profiles, onChange }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const patch = (id: string, f: (p: VarProfile) => VarProfile) =>
    onChange({ ...profiles, list: profiles.list.map((p) => (p.id === id ? f(p) : p)) });
  const add = () => {
    const p: VarProfile = { id: newProfileId(), name: `${t("Perfil")} ${profiles.list.length + 1}`, vars: [] };
    onChange({ list: [...profiles.list, p], active: profiles.active ?? p.id });
    setOpenId(p.id);
  };
  const dup = (src: VarProfile) => {
    const p: VarProfile = { id: newProfileId(), name: `${src.name} (${t("copia")})`, vars: src.vars.map((v) => ({ ...v })) };
    onChange({ ...profiles, list: [...profiles.list, p] });
    setOpenId(p.id);
  };
  const del = (id: string) => {
    onChange({ list: profiles.list.filter((p) => p.id !== id), active: profiles.active === id ? null : profiles.active });
    setConfirmDel(null);
    if (openId === id) setOpenId(null);
  };

  return (
    <div className="space-y-1.5">
      {profiles.list.length === 0 && (
        <p className="px-1 py-1 text-xs text-slate">
          {t("Crea perfiles (Desarrollo, Pruebas, Producción…) y cambia entre ellos desde el selector junto a «Enviar».")}
        </p>
      )}
      {profiles.list.map((p) => {
        const open = openId === p.id;
        const on = profiles.active === p.id;
        return (
          <div key={p.id} className={`rounded-lg ring-1 ${on ? "ring-aqua/60" : "ring-fg/10"}`}>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button onClick={() => setOpenId(open ? null : p.id)} className="text-slate hover:text-mist" title={open ? t("Plegar") : t("Desplegar")}>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <input
                value={p.name}
                onChange={(e) => patch(p.id, (x) => ({ ...x, name: e.target.value }))}
                placeholder={t("Nombre del perfil")}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-sm text-mist outline-none"
              />
              <button
                onClick={() => onChange({ ...profiles, active: on ? null : p.id })}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.025em] ${on ? "bg-aqua/20 text-aqua" : "text-slate ring-1 ring-fg/15 hover:text-mist"}`}
                title={on ? t("Desactivar este perfil") : t("Usar este perfil")}
              >
                {on ? t("Activo") : t("Usar")}
              </button>
              <button onClick={() => dup(p)} className="text-slate hover:text-mist" title={t("Duplicar")}>
                <Copy size={13} />
              </button>
              {confirmDel === p.id ? (
                <button onClick={() => del(p.id)} onBlur={() => setConfirmDel(null)} autoFocus className="text-[10px] font-semibold uppercase text-rose">
                  {t("¿Seguro?")}
                </button>
              ) : (
                <button onClick={() => setConfirmDel(p.id)} className="text-slate hover:text-rose" title={t("Eliminar")}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {open && (
              <div className="border-t border-fg/10 p-2">
                <KVEditor rows={p.vars} onChange={(vars) => patch(p.id, (x) => ({ ...x, vars }))} keyPlaceholder="nombre" />
              </div>
            )}
          </div>
        );
      })}
      <button onClick={add} className="flex items-center gap-1 pt-0.5 text-xs text-silver hover:text-aqua">
        <Plus size={13} /> {t("Nuevo perfil")}
      </button>
    </div>
  );
}
