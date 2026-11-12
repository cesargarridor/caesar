import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { openUrl, syncDeleteAccount, syncBilling, syncCheckoutUrl, syncNow, syncSignIn, syncSignOut, syncStatus, vaultCreate, vaultRestore, type Billing, type SyncStatus } from "../api";
import SocialButtons from "./SocialButtons";
import { t } from "../lib/i18n";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));
const inputCls = "w-full rounded-xl bg-deep px-3 py-2 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua";
const btnCls = "rounded-xl bg-aqua px-4 py-2 text-sm font-medium text-ink disabled:opacity-50";
const ghostCls = "rounded-xl px-4 py-2 text-sm text-silver ring-1 ring-fg/15 hover:text-mist disabled:opacity-50";

export default function SyncSettings() {
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [bill, setBill] = useState<Billing | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => syncStatus().then(setSt).catch(() => {}), []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const signedIn = st?.signed_in ?? false;
  const billingOn = st?.billing ?? false;
  const checkBilling = useCallback(() => syncBilling().then(setBill).catch(() => {}), []);
  useEffect(() => {
    if (!signedIn || !billingOn) return;
    checkBilling();
    const id = setInterval(checkBilling, 60000);
    return () => clearInterval(id);
  }, [signedIn, billingOn, checkBilling]);

  if (!st) return <div className="px-1 py-1 text-sm text-slate">…</div>;
  if (!st.configured)
    return <div className="px-1 py-1 text-sm text-slate">{t("La sincronización no está configurada en esta versión.")}</div>;

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 py-1">
      {/* 1. Cuenta */}
      <section className="space-y-3">
        <h3 className="text-sm text-mist">{t("Cuenta")}</h3>
        {st.signed_in ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-silver">{st.email || t("Sesión iniciada")}</span>
            <button className={ghostCls} disabled={busy} onClick={() => run(async () => { await syncSignOut(); })}>
              {t("Cerrar sesión")}
            </button>
          </div>
        ) : (
          <form
            className="max-w-sm space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => { await syncSignIn(email, password, false); setPassword(""); });
            }}
          >
            <input className={inputCls} type="email" autoComplete="username" placeholder={t("Correo")} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={inputCls} type="password" autoComplete="current-password" placeholder={t("Contraseña")} value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              <button className={btnCls} disabled={busy} type="submit">{t("Iniciar sesión")}</button>
              <button
                className={ghostCls}
                disabled={busy}
                type="button"
                onClick={() => run(async () => { await syncSignIn(email, password, true); setPassword(""); })}
              >
                {t("Crear cuenta")}
              </button>
            </div>
          </form>
        )}
        {!st.signed_in && (
          <div className="max-w-sm">
            <SocialButtons st={st} busy={busy} run={run} />
          </div>
        )}
      </section>

      {/* 2. Clave de cifrado */}
      <section className="space-y-3">
        <h3 className="text-sm text-mist">{t("Cifrado de extremo a extremo")}</h3>
        {st.has_key ? (
          <p className="text-xs text-slate">{t("Este equipo tiene la clave. Tus datos se cifran aquí antes de salir; la nube solo guarda texto ilegible.")}</p>
        ) : (
          <div className="max-w-sm space-y-3">
            <p className="text-xs text-slate">
              {t("Primer equipo: crea la clave y guarda la clave de recuperación. Otro equipo: pega aquí la clave de recuperación del primero.")}
            </p>
            <button
              className={btnCls}
              disabled={busy}
              onClick={() => run(async () => { setShownKey(await vaultCreate()); })}
            >
              {t("Crear clave")}
            </button>
            <input className={inputCls} placeholder="CSR-XXXXX-XXXXX-…" value={recovery} onChange={(e) => setRecovery(e.target.value)} />
            <button
              className={ghostCls}
              disabled={busy || !recovery.trim()}
              onClick={() => run(async () => { await vaultRestore(recovery); setRecovery(""); })}
            >
              {t("Restaurar con clave de recuperación")}
            </button>
          </div>
        )}
        {shownKey && (
          <div className="max-w-md rounded-xl bg-deep p-4 ring-1 ring-fg/15">
            <p className="mb-2 text-xs text-slate">{t("Guárdala ahora en un gestor de contraseñas. No se volverá a mostrar.")}</p>
            <code className="block select-all break-all text-sm text-mist">{shownKey}</code>
            <button className={`${ghostCls} mt-3`} onClick={() => setShownKey(null)}>{t("Ya la he guardado")}</button>
          </div>
        )}
      </section>

      {/* Suscripción */}
      {st.signed_in && st.billing && (
        <section className="space-y-3">
          <h3 className="text-sm text-mist">{t("Suscripción")}</h3>
          {bill?.active ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-silver">
                {bill.status === "cancelled" && bill.ends_at
                  ? `${t("Cancelada: activa hasta")} ${new Date(bill.ends_at).toLocaleDateString()}`
                  : t("Activa")}
              </span>
              {bill.portal && (
                <button className={ghostCls} onClick={() => openUrl(bill.portal).catch(() => {})}>
                  {t("Gestionar suscripción")}
                </button>
              )}
            </div>
          ) : (
            <div className="max-w-md space-y-3">
              <p className="text-xs text-slate">
                {t("Para sincronizar entre equipos necesitas la suscripción. Tus colecciones locales y todo lo demás de Caesar siguen siendo gratis.")}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={btnCls}
                  disabled={busy}
                  onClick={() => run(async () => { openUrl(await syncCheckoutUrl()).catch(() => {}); })}
                >
                  {t("Suscribirme")}
                </button>
                <button className={ghostCls} onClick={() => checkBilling()}>{t("Ya he pagado, comprobar")}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. Estado */}
      {st.signed_in && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button className={ghostCls} disabled={busy || !st.has_key} onClick={() => run(syncNow)}>
              <RefreshCw size={14} className="mr-2 inline" />
              {t("Sincronizar ahora")}
            </button>
            <span className="text-xs text-slate">
              {st.dirty ? t("Cambios pendientes de subir (se suben solos cada 30 s).") : st.last_sync ? `${t("Última sincronización")}: ${new Date(st.last_sync).toLocaleTimeString()}` : t("Al día")}
            </span>
          </div>
          {st.error && <p className="text-xs text-red-400">{st.error}</p>}
        </section>
      )}
      {st.signed_in && (
        <section className="space-y-2 border-t border-fg/10 pt-4">
          {confirmDel ? (
            <div className="max-w-md space-y-3">
              <p className="text-xs text-slate">
                {t("Se borrarán tu cuenta y los datos cifrados de la nube. Tus colecciones en este equipo no se tocan. Si tienes suscripción, cancélala antes en «Gestionar suscripción».")}
              </p>
              <div className="flex gap-2">
                <button
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => run(async () => { await syncDeleteAccount(); setConfirmDel(false); setBill(null); })}
                >
                  {t("Sí, borrar mi cuenta")}
                </button>
                <button className={ghostCls} onClick={() => setConfirmDel(false)}>{t("Cancelar")}</button>
              </div>
            </div>
          ) : (
            <button className="text-xs text-slate underline hover:text-red-400" onClick={() => setConfirmDel(true)}>
              {t("Borrar mi cuenta y mis datos de la nube")}
            </button>
          )}
        </section>
      )}
      {msg && <p className="text-xs text-red-400">{msg}</p>}
    </div>
  );
}
