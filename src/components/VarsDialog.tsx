import { useEffect, useMemo, useState } from "react";
import { Globe, KeyRound, Layers, Library, ListChecks, X } from "lucide-react";
import VarTable from "./VarTable";
import ProfilesPanel from "./ProfilesPanel";
import AuthEditor from "./AuthEditor";
import type { AuthData, KV, ProfilesState } from "../types";
import { t } from "../lib/i18n";
import { resolveVars, type VarScope } from "../lib/vars";

export type VarsSection = "globals" | "profiles" | "collection" | "resolved";

interface Props {
  section: VarsSection;
  /** Pestaña inicial de la colección. */
  collTab?: "vars" | "auth";
  vars: KV[];
  onVars: (v: KV[]) => void;
  profiles: ProfilesState;
  onProfiles: (p: ProfilesState) => void;
  /** Colección elegida (null = ninguna): nombre, variables y autorización. */
  collName: string | null;
  collVars: KV[];
  onCollVars: (v: KV[]) => void;
  collAuth: AuthData | null;
  onCollAuth: (a: AuthData) => void;
  onClose: () => void;
}

const SCOPE_LABEL: Record<VarScope, string> = { global: "Global", collection: "De la colección", profile: "Perfil" };

/** Editor grande (como las pestañas Globals / Environments / Collection de Postman) para variables, perfiles y autorización de colección. */
export default function VarsDialog({ section, collTab = "vars", vars, onVars, profiles, onProfiles, collName, collVars, onCollVars, collAuth, onCollAuth, onClose }: Props) {
  const [sec, setSec] = useState<VarsSection>(section);
  const [tab, setTab] = useState<"vars" | "auth">(collTab);
  const active = profiles.list.find((p) => p.id === profiles.active) ?? null;
  const resolved = useMemo(() => resolveVars(vars, collVars, active?.vars ?? []), [vars, collVars, active]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);

  const nav = (id: VarsSection, icon: React.ReactNode, label: string, count?: number) => (
    <button
      key={id}
      onClick={() => setSec(id)}
      aria-current={sec === id ? "page" : undefined}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-aqua ${sec === id ? "bg-iris/15 text-mist" : "text-silver hover:bg-fg/5 hover:text-mist"}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] text-slate">{count}</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/90 p-4 sm:p-8" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("Variables y perfiles")} className="glass flex h-full max-h-[48rem] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-kelp" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-fg/10 px-5 py-3">
          <h2 className="text-lg text-mist">{t("Variables y perfiles")}</h2>
          <button onClick={onClose} className="text-slate hover:text-mist" title={t("Cerrar (Esc)")} aria-label={t("Cerrar (Esc)")}>
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav className="shrink-0 space-y-1 border-b border-fg/10 p-3 sm:w-56 sm:border-b-0 sm:border-r" aria-label={t("Secciones")}>
            {nav("globals", <Globe size={15} />, t("Variables globales"), vars.filter((v) => v.key).length)}
            {nav("profiles", <Layers size={15} />, t("Perfiles de variables"), profiles.list.length)}
            {nav("collection", <Library size={15} />, collName ?? t("Colección"))}
            {nav("resolved", <ListChecks size={15} />, t("Variables resueltas"), resolved.length)}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {sec === "globals" && (
              <div className="space-y-3">
                <p className="text-xs text-slate">{t("Las variables globales valen para todo el espacio de trabajo. Las de la colección y las del perfil activo las pisan.")}</p>
                <VarTable rows={vars} onChange={onVars} />
              </div>
            )}
            {sec === "profiles" && <ProfilesPanel wide profiles={profiles} onChange={onProfiles} />}
            {sec === "collection" &&
              (collName === null || collAuth === null ? (
                <p className="text-sm text-slate">{t("Abre una colección para editar sus variables y su autorización.")}</p>
              ) : (
                <div className="space-y-3">
                  <p className="eyebrow truncate" title={collName}>{collName}</p>
                  <div role="tablist" className="flex gap-1 border-b border-fg/10">
                    {([["vars", t("Variables")], ["auth", t("Autorización")]] as const).map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-aqua ${tab === id ? "border-aqua text-mist" : "border-transparent text-slate hover:text-mist"}`}
                      >
                        {id === "auth" && <KeyRound size={13} />}
                        {label}
                      </button>
                    ))}
                  </div>
                  {tab === "vars" ? (
                    <>
                      <p className="text-xs text-slate">{t("Variables de esta colección. Pisan a las globales; el perfil activo pisa a estas.")}</p>
                      <VarTable rows={collVars} onChange={onCollVars} />
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-slate">{t("Las peticiones con «Inherit» usan esta autorización.")}</p>
                      <AuthEditor auth={collAuth} onChange={onCollAuth} allowInherit={false} />
                    </>
                  )}
                </div>
              ))}
            {sec === "resolved" && (
              <div className="space-y-3">
                <p className="text-xs text-slate">
                  {t("Valores que se usan al enviar ahora: perfil activo > colección > globales.")}{" "}
                  {active ? `${t("Perfil activo")}: ${active.name}.` : t("Sin perfil activo.")}{collName ? ` ${t("Colección")}: ${collName}.` : ""}
                </p>
                {resolved.length === 0 ? (
                  <p className="text-sm text-slate">{t("No hay variables activas.")}</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-[10px] uppercase tracking-[0.025em] text-slate">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">{t("Variable")}</th>
                        <th className="py-1 pr-3 font-semibold">{t("Valor")}</th>
                        <th className="py-1 font-semibold">{t("Ámbito")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resolved.map((r) => (
                        <tr key={r.key} className="border-t border-fg/10">
                          <td className="py-1.5 pr-3 font-mono text-xs" style={{ color: "var(--t-hl)" }}>{`{{${r.key}}}`}</td>
                          <td className="max-w-[18rem] truncate py-1.5 pr-3 font-mono text-xs text-mist">{r.secret ? "••••••••" : r.value}</td>
                          <td className="py-1.5 text-xs text-slate">
                            {t(SCOPE_LABEL[r.scope])}
                            {r.shadowed.length > 0 && <span title={t("Pisa a")}> · {t("pisa a")} {r.shadowed.map((s) => t(SCOPE_LABEL[s])).join(", ")}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
