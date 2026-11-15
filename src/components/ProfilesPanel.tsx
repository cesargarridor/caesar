import { useEffect, useState } from "react";
import { Check, Copy, MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";
import VarTable from "./VarTable";
import { newProfileId } from "../lib/workspaces";
import { uniqueProfileName } from "../lib/vars";
import type { ProfilesState, VarProfile } from "../types";
import { t } from "../lib/i18n";

interface Props {
  profiles: ProfilesState;
  onChange: (p: ProfilesState) => void;
  /** Pestaña grande: lista a la izquierda y tabla a la derecha. Sin esto (sidebar), la tabla va debajo de la lista. */
  wide?: boolean;
  /** Perfil seleccionado al abrir. */
  initialId?: string | null;
}

/** Gestor de perfiles de variables (como los Environments de Postman): crear, renombrar, duplicar, borrar, activar y editar sus variables. */
export default function ProfilesPanel({ profiles, onChange, wide = false, initialId = null }: Props) {
  const [selId, setSelId] = useState<string | null>(initialId && profiles.list.some((p) => p.id === initialId) ? initialId : (profiles.active ?? profiles.list[0]?.id ?? null));
  const [menu, setMenu] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const sel = profiles.list.find((p) => p.id === selId) ?? null;

  useEffect(() => {
    if (selId && !profiles.list.some((p) => p.id === selId)) setSelId(profiles.list[0]?.id ?? null);
  }, [profiles.list, selId]);

  const patch = (id: string, f: (p: VarProfile) => VarProfile) => onChange({ ...profiles, list: profiles.list.map((p) => (p.id === id ? f(p) : p)) });
  const names = (skip?: string) => profiles.list.filter((p) => p.id !== skip).map((p) => p.name);
  const add = () => {
    const p: VarProfile = { id: newProfileId(), name: uniqueProfileName(`${t("Perfil")} ${profiles.list.length + 1}`, names()), vars: [] };
    onChange({ list: [...profiles.list, p], active: profiles.active });
    setSelId(p.id);
    setRenaming(p.id);
  };
  const dup = (src: VarProfile) => {
    const p: VarProfile = { id: newProfileId(), name: uniqueProfileName(`${src.name} (${t("copia")})`, names()), vars: src.vars.map((v) => ({ ...v })) };
    onChange({ ...profiles, list: [...profiles.list, p] });
    setSelId(p.id);
  };
  const del = (id: string) => {
    onChange({ list: profiles.list.filter((p) => p.id !== id), active: profiles.active === id ? null : profiles.active });
    setConfirmDel(null);
  };
  const toggleActive = (id: string) => onChange({ ...profiles, active: profiles.active === id ? null : id });

  const list = (
    <div className="space-y-1" role="listbox" aria-label={t("Perfiles de variables")}>
      {profiles.list.map((p) => {
        const on = profiles.active === p.id;
        const isSel = sel?.id === p.id;
        return (
          <div key={p.id} role="option" aria-selected={isSel} className={`relative rounded-lg ring-1 ${isSel ? "bg-fg/5 ring-iris/60" : "ring-fg/10"}`}>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button
                onClick={() => toggleActive(p.id)}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-aqua ${on ? "bg-aqua text-ink ring-aqua" : "text-transparent ring-fg/30 hover:text-slate"}`}
                title={on ? t("Perfil activo: clic para desactivarlo") : t("Activar este perfil")}
                aria-label={on ? t("Desactivar este perfil") : t("Activar este perfil")}
                aria-pressed={on}
              >
                <Check size={10} />
              </button>
              {renaming === p.id ? (
                <input
                  autoFocus
                  defaultValue={p.name}
                  spellCheck={false}
                  aria-label={t("Nombre del perfil")}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v && v !== p.name) patch(p.id, (x) => ({ ...x, name: uniqueProfileName(v, names(p.id)) }));
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") {
                      e.currentTarget.value = p.name;
                      e.currentTarget.blur();
                    }
                  }}
                  className="min-w-0 flex-1 rounded bg-deep px-1 text-sm text-mist outline-none ring-1 ring-aqua"
                />
              ) : (
                <button onClick={() => setSelId(p.id)} onDoubleClick={() => setRenaming(p.id)} className="min-w-0 flex-1 truncate text-left text-sm text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-aqua" title={t("Doble clic para renombrar")}>
                  {p.name || t("Sin nombre")}
                </button>
              )}
              {on && <span className="rounded-md bg-aqua/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.025em] text-aqua">{t("Activo")}</span>}
              <span className="text-[10px] text-slate">{p.vars.filter((v) => v.key).length}</span>
              <button onClick={() => setMenu(menu === p.id ? null : p.id)} className="text-slate hover:text-mist" title={t("Acciones del perfil")} aria-label={t("Acciones del perfil")} aria-haspopup="menu" aria-expanded={menu === p.id}>
                <MoreHorizontal size={15} />
              </button>
            </div>
            {confirmDel === p.id && (
              <div className="flex items-center gap-2 border-t border-fg/10 px-2 py-1.5 text-xs" role="alert">
                <span className="flex-1 text-slate">{t("¿Eliminar este perfil y sus variables?")}</span>
                <button autoFocus onClick={() => del(p.id)} className="font-semibold uppercase text-rose">{t("Eliminar")}</button>
                <button onClick={() => setConfirmDel(null)} className="uppercase text-slate hover:text-mist">{t("Cancelar")}</button>
              </div>
            )}
            {menu === p.id && (
              <>
                <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
                <div role="menu" className="absolute right-1 top-8 z-50 min-w-[10rem] rounded-lg bg-kelp p-1 text-sm shadow-lg ring-1 ring-fg/15">
                  {[
                    { icon: <Power size={13} />, label: on ? t("Desactivar") : t("Activar"), run: () => toggleActive(p.id) },
                    { icon: <Pencil size={13} />, label: t("Renombrar"), run: () => { setSelId(p.id); setRenaming(p.id); } },
                    { icon: <Copy size={13} />, label: t("Duplicar"), run: () => dup(p) },
                    { icon: <Trash2 size={13} />, label: t("Eliminar"), run: () => setConfirmDel(p.id), danger: true },
                  ].map((a) => (
                    <button
                      key={a.label}
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        a.run();
                      }}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fg/10 ${a.danger ? "text-rose" : "text-silver hover:text-mist"}`}
                    >
                      {a.icon} {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
      <button onClick={add} className="flex items-center gap-1 pt-0.5 text-xs text-silver hover:text-aqua focus-visible:outline focus-visible:outline-2 focus-visible:outline-aqua">
        <Plus size={13} /> {t("Nuevo perfil")}
      </button>
    </div>
  );

  const editor = sel ? (
    <div className="space-y-1.5">
      <p className="eyebrow truncate px-1" title={sel.name}>{t("Variables de")} «{sel.name}»</p>
      <VarTable compact={!wide} rows={sel.vars} onChange={(vars) => patch(sel.id, (x) => ({ ...x, vars }))} />
    </div>
  ) : null;

  const empty = (
    <p className="px-1 py-1 text-xs text-slate">
      {t("Crea perfiles (Desarrollo, Pruebas, Producción…) y cambia entre ellos desde el selector junto a «Enviar». También puedes importar un entorno de Postman con «Importar».")}
    </p>
  );

  return wide ? (
    <div className="grid min-h-0 grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] gap-4">
      <div className="space-y-2">
        {profiles.list.length === 0 && empty}
        {list}
      </div>
      <div>{editor ?? (profiles.list.length > 0 ? <p className="text-xs text-slate">{t("Selecciona un perfil para editar sus variables.")}</p> : null)}</div>
    </div>
  ) : (
    <div className="space-y-2">
      {profiles.list.length === 0 && empty}
      {list}
      {editor}
    </div>
  );
}
