import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, LogOut, RefreshCw } from "lucide-react";
import { openUrl, syncDeleteAccount, syncBilling, syncCheckoutUrl, syncNow, syncSignIn, syncSignOut, syncStatus, syncRole, syncActivate, syncEnterKey, syncMakeMaster, syncShowKey, syncRegenerateKey, type Billing, type SyncRole, type SyncStatus } from "../api";
import SocialButtons from "./SocialButtons";
import { t } from "../lib/i18n";
import { openCheckout, planError, useAccount } from "../lib/account";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));
/** Mensajes claros para los errores de plan y de clave que devuelve Rust. */
const keyError = (e: unknown) => {
  const m = typeof e === "string" ? e : "";
  if (m.startsWith("KEY_INVALID")) return t("La clave no es válida. Revísala y vuelve a pegarla completa.");
  return planError(e) ?? errText(e);
};
const inputCls = "w-full rounded-xl bg-deep px-3 py-2 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua";
const btnCls = "rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50 bg-[var(--t-iris)]";
const ghostCls = "rounded-xl px-4 py-2 text-sm font-medium text-mist ring-1 ring-fg/30 hover:ring-fg/60 disabled:opacity-50";

interface Props {
  /** Colecciones compartidas en este equipo (se van al cerrar sesión). */
  sharedCount: number;
  onBeforeSignOut: () => Promise<void> | void;
  onSignedOut: () => void;
}

export default function SyncSettings({ sharedCount, onBeforeSignOut, onSignedOut }: Props) {
  const [confirmOut, setConfirmOut] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmMaster, setConfirmMaster] = useState(false);
  const [role, setRole] = useState<SyncRole | null>(null);
  const { account, refresh: refreshAccount } = useAccount();
  const [copied, setCopied] = useState(false);
  const [bill, setBill] = useState<Billing | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Pestaña de acceso abierta. Con sesión iniciada solo se ve si el usuario pulsa una (para entrar con otra cuenta). */
  const [mode, setMode] = useState<"login" | "register" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void refreshAccount();
    syncRole().then(setRole).catch(() => {});
    return syncStatus().then(setSt).catch(() => {});
  }, [refreshAccount]);
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
      setMsg(keyError(e));
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
      <section className="space-y-4">
        <h3 className="text-sm text-mist">{t("Cuenta")}</h3>
        {st.signed_in && (
          <div className="space-y-3 rounded-xl bg-deep p-4 ring-1 ring-fg/10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--t-iris)] text-base font-semibold uppercase text-white" aria-hidden>
                {(st.email || "?").replace(/^GitHub:\s*/, "").charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-mist">{st.email || "—"}</div>
                <div className="flex items-center gap-1.5 text-xs text-slate">
                  <span className={`inline-block h-2 w-2 rounded-full ${st.error ? "bg-red-400" : st.dirty ? "bg-amber-400" : "bg-emerald-400"}`} />
                  {st.error ? t("Con problemas de sincronización") : st.dirty ? t("Subiendo cambios…") : t("Sesión iniciada")}
                </div>
              </div>
              {!confirmOut && (
                <button className={ghostCls} disabled={busy} onClick={() => setConfirmOut(true)}>
                  <LogOut size={14} className="mr-2 inline" />
                  {t("Cerrar sesión")}
                </button>
              )}
            </div>
            {confirmOut && (
              <div className="space-y-3 rounded-xl bg-kelp p-3 ring-1 ring-fg/15" role="alertdialog" aria-label={t("Cerrar sesión")}>
                <p className="text-xs text-silver">{t("Se cerrará la sesión en este equipo. Antes se sube lo que tengas pendiente.")}</p>
                <ul className="space-y-1 text-xs text-slate">
                  <li>
                    <b className="text-mist">{t("Se quitan de este equipo")}:</b>{" "}
                    {sharedCount > 0 ? t("{0} colección(es) compartida(s). Siguen en la nube para su equipo.", String(sharedCount)) : t("no tienes colecciones compartidas.")}
                  </li>
                  <li>
                    <b className="text-mist">{t("Se quedan")}:</b> {t("tus colecciones locales, variables y ajustes.")}
                  </li>
                </ul>
                <div className="flex gap-2">
                  <button
                    className={btnCls}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        try { await onBeforeSignOut(); } catch { /* sin red: no bloquea el cierre */ }
                        await syncSignOut();
                        setConfirmOut(false);
                        setMode(null);
                        setConfirmDel(false);
                        setBill(null);
                        setShownKey(null);
                        setPassword("");
                        onSignedOut();
                      })
                    }
                  >
                    {busy ? t("Cerrando sesión…") : t("Sí, cerrar sesión")}
                  </button>
                  <button className={ghostCls} disabled={busy} onClick={() => setConfirmOut(false)}>{t("Cancelar")}</button>
                </div>
              </div>
            )}
          </div>
        )}
        {!st.signed_in && (
        <>
        <div className="flex gap-1 border-b border-fg/10">
          {(["login", "register"] as const).map((m) => {
            const open = (mode ?? "login") === m;
            return (
              <button
                key={m}
                onClick={() => { setMode(m); setMsg(null); }}
                className={`-mb-px border-b-2 px-4 py-2 text-sm ${open ? "border-aqua text-mist" : "border-transparent text-slate hover:text-silver"}`}
              >
                {m === "login" ? t("Iniciar sesión") : t("Registrarse")}
              </button>
            );
          })}
        </div>
        {(() => {
          const reg = (mode ?? "login") === "register";
          const done = () => { setPassword(""); setMode(null); };
          return (
            <div className="max-w-sm space-y-4">
              <p className="text-xs text-slate">
                {reg ? t("Crea una cuenta para sincronizar tus colecciones y compartirlas con tu equipo.") : t("Inicia sesión para sincronizar y volver a ver tus colecciones compartidas. Sin sesión, Caesar sigue funcionando en local.")}
              </p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!email.trim() || !password) return setMsg(t("Escribe tu correo y tu contraseña."));
                  run(async () => { await syncSignIn(email, password, reg); done(); });
                }}
              >
                <input className={inputCls} type="email" autoComplete="username" placeholder={t("Correo")} value={email} onChange={(e) => setEmail(e.target.value)} />
                <div className="relative">
                  <input className={`${inputCls} pr-10`} type={showPw ? "text" : "password"} autoComplete={reg ? "new-password" : "current-password"} placeholder={t("Contraseña")} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate hover:text-mist"
                    title={showPw ? t("Ocultar") : t("Mostrar")}
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button className={btnCls} disabled={busy || !email.trim() || !password} type="submit">
                  {busy ? t("Un momento…") : reg ? t("Crear cuenta") : t("Iniciar sesión")}
                </button>
              </form>
              {(st.google || st.github) && <p className="text-xs text-slate">{t("o")}</p>}
              <SocialButtons st={st} busy={busy} run={run} reg={reg} onSuccess={done} />
            </div>
          );
        })()}
        </>
        )}
      </section>

      {/* Aviso de plan */}
      {account.mode === "guest" && (
        <div className="max-w-md space-y-2 rounded-xl bg-deep p-4 ring-1 ring-fg/15">
          <p className="text-sm text-mist">{t("Sincronización desactivada (modo Invitado)")}</p>
          <p className="text-xs text-slate">{t("La sincronización cifrada entre equipos es parte del plan Pro. Crea una cuenta abajo para empezar; tus datos locales se conservan.")}</p>
        </div>
      )}
      {st.signed_in && account.mode === "limbo" && (
        <div className="max-w-md space-y-2 rounded-xl bg-deep p-4 ring-1 ring-amber-400/40">
          <p className="text-sm text-mist">{t("Cuenta pendiente de activar Pro")}</p>
          <p className="text-xs text-slate">
            {t("Funciona solo en local. Te quedan {0} día(s); después la cuenta se elimina y vuelves al modo Invitado.", String(account.days_left))}
          </p>
          <button className={btnCls} disabled={busy} onClick={() => run(openCheckout)}>{t("Activar Pro")}</button>
        </div>
      )}

      {/* 2. Clave de cifrado (según el rol de este equipo) */}
      {st.signed_in && account.mode === "pro" && role && (
      <section className="space-y-3">
        <h3 className="text-sm text-mist">{t("Clave de cifrado")}</h3>
        {role.role === "none" && (
          <div className="max-w-md space-y-3">
            <p className="text-xs text-slate">{t("Todavía no hay sincronización en esta cuenta. Al activarla, este equipo será el Principal y generará la clave de cifrado.")}</p>
            <button className={btnCls} disabled={busy} onClick={() => run(async () => { setRole(await syncActivate()); })}>{t("Activar sincronización")}</button>
          </div>
        )}
        {role.role === "master" && (
          <div className="max-w-md space-y-3">
            <p className="text-xs text-slate">{t("Este equipo es el Principal: tiene la clave. Tus datos se cifran aquí antes de salir; la nube solo guarda texto ilegible.")}</p>
            <div className="flex flex-wrap gap-2">
              <button className={ghostCls} disabled={busy} onClick={() => run(async () => { setShownKey(await syncShowKey()); setCopied(false); })}>
                {t("Mostrar clave de sincronización")}
              </button>
              <button className={ghostCls} disabled={busy} onClick={() => setConfirmNew((v) => !v)}>{t("Regenerar clave")}</button>
            </div>
            {confirmNew && (
              <div className="space-y-3 rounded-xl bg-deep p-4 ring-1 ring-fg/15">
                <p className="text-xs text-silver">
                  {t("Se crea una clave nueva y se vuelve a cifrar todo con ella. Los demás equipos dejarán de sincronizar y te pedirán la clave nueva.")}
                </p>
                <div className="flex gap-2">
                  <button className={btnCls} disabled={busy} onClick={() => run(async () => { setShownKey(await syncRegenerateKey()); setCopied(false); setConfirmNew(false); })}>
                    {t("Sí, regenerar clave")}
                  </button>
                  <button className={ghostCls} onClick={() => setConfirmNew(false)}>{t("Cancelar")}</button>
                </div>
              </div>
            )}
          </div>
        )}
        {(role.role === "needs_key" || role.role === "member" || role.role === "revoked") && (
          <div className="max-w-md space-y-3">
            <p className="text-xs text-slate">
              {role.role === "revoked"
                ? t("La clave de esta cuenta ha cambiado. Pega la clave nueva (cópiala desde el equipo Principal) para volver a sincronizar.")
                : t("Pega la clave de sincronización del equipo Principal para sincronizar este equipo.")}
            </p>
            <input className={inputCls} placeholder={t("Clave de sincronización")} value={recovery} onChange={(e) => setRecovery(e.target.value)} />
            <button
              className={btnCls}
              disabled={busy || !recovery.trim()}
              onClick={() => run(async () => { setRole(await syncEnterKey(recovery.trim())); setRecovery(""); await syncNow().catch(() => {}); })}
            >
              {t("Pegar clave")}
            </button>
            <div>
              <button className="text-xs text-slate underline hover:text-mist" disabled={busy} onClick={() => setConfirmMaster((v) => !v)}>
                {t("Convertir este equipo en Principal")}
              </button>
            </div>
            {confirmMaster && (
              <div className="space-y-3 rounded-xl bg-deep p-4 ring-1 ring-fg/15">
                <p className="text-xs text-silver">{t("Este equipo pasará a ser el Principal y los datos de la nube se cifrarán con su clave. El Principal anterior y los demás equipos tendrán que volver a pegar la clave.")}</p>
                <div className="flex gap-2">
                  <button className={btnCls} disabled={busy} onClick={() => run(async () => { setRole(await syncMakeMaster()); setConfirmMaster(false); })}>{t("Sí, convertir")}</button>
                  <button className={ghostCls} onClick={() => setConfirmMaster(false)}>{t("Cancelar")}</button>
                </div>
              </div>
            )}
          </div>
        )}
        {shownKey && (
          <div className="max-w-md rounded-xl bg-deep p-4 ring-1 ring-fg/15">
            <p className="mb-2 text-xs text-silver">{t("Guárdala en un gestor de contraseñas y pégala en tus otros equipos. Puedes volver a verla con «Mostrar clave de sincronización».")}</p>
            <code className="block select-all break-all text-sm text-mist">{shownKey}</code>
            <div className="mt-3 flex gap-2">
              <button
                className={ghostCls}
                onClick={() => { navigator.clipboard.writeText(shownKey).then(() => setCopied(true)).catch(() => {}); }}
              >
                {copied ? t("Copiada") : t("Copiar")}
              </button>
              <button className={ghostCls} onClick={() => setShownKey(null)}>{t("Ocultar")}</button>
            </div>
          </div>
        )}
      </section>
      )}

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
            <button className={ghostCls} disabled={busy || !st.has_key || account.mode !== "pro"} onClick={() => run(syncNow)}>
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
                {t("Se borrarán tu cuenta y los datos cifrados de la nube. Las colecciones compartidas saldrán de este equipo; tus colecciones locales no se tocan. Si tienes suscripción, cancélala antes en «Gestionar suscripción».")}
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
