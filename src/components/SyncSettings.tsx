import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, LogOut, RefreshCw, X } from "lucide-react";
import { checkTrialAndWhitelist, redeemCode, openUrl, saveTextFile, syncDeleteAccount, localWipe, syncBilling, syncCheckoutUrl, syncNow, syncCancel, syncSignIn, syncResetPassword, syncSignOut, syncStatus, syncRole, syncActivate, syncEnterKey, syncMakeMaster, syncShowKey, syncRegenerateKey, type Billing, type SyncRole, type SyncStatus } from "../api";
import { passwordStrength, STRENGTH_COLORS, STRENGTH_LABELS, type Strength } from "../lib/passwordStrength";
import SocialButtons from "./SocialButtons";
import PlanNotice from "./PlanNotice";
import { acceptedTerms, clearTermsSent } from "../lib/legal";
import { t } from "../lib/i18n";
import { onAccountChanged } from "../api";
import { openCheckout, planError, useAccount } from "../lib/account";
import { markWiping } from "../lib/workspaces";

/** Tierra quemada local: borra datos.json en Rust, vacía lo que Caesar guarda en el navegador y recarga en blanco. */
const wipeLocalAndReload = async () => {
  markWiping();
  try { await localWipe(); } catch { /* aunque falle en disco, se vacía el almacenamiento de la interfaz */ }
  try {
    const ks: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("caesar.")) ks.push(k); }
    ks.forEach((k) => localStorage.removeItem(k));
  } catch { /* sin almacenamiento */ }
  window.location.reload();
};
const DEL_PHRASE = "borrar mi cuenta";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));
/** Mensajes claros para los errores de plan y de clave que devuelve Rust. */
const keyError = (e: unknown) => {
  const m = typeof e === "string" ? e : "";
  if (m.startsWith("KEY_INVALID")) return t("La clave no es válida. Revísala y vuelve a pegarla completa.");
  return planError(e) ?? errText(e);
};
const inputCls = "w-full rounded-xl bg-deep px-3 py-2 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua";
/** Compra del plan Empresas (asientos a elegir, mínimo 10): una clave que luego se canjea en «Canjear código». */
const EMPRESAS_URL = "https://buy.polar.sh/polar_cl_Q2tRO132aFIjoUwZZdF0Xld4Q97YjVESuXq8Z2aGnEM";
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
  const [roleErr, setRoleErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const { account, refresh: refreshAccount, setAccount } = useAccount();
  const [copied, setCopied] = useState(false);
  const [bill, setBill] = useState<Billing | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [wipeOut, setWipeOut] = useState(false);
  const [wipeDel, setWipeDel] = useState(false);
  const [delPhrase, setDelPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  /** Pestaña de acceso abierta. Con sesión iniciada solo se ve si el usuario pulsa una (para entrar con otra cuenta). */
  const [mode, setMode] = useState<"login" | "register" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** Fuerza mostrada: se recalcula 1 s después de que el usuario deje de escribir. */
  const [strength, setStrength] = useState<Strength | null>(null);
  /** Pantalla «restaurar contraseña» (solo con la pestaña de inicio de sesión). */
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    void refreshAccount();
    syncRole().then((r) => { setRole(r); setRoleErr(null); }).catch((e) => setRoleErr(errText(e)));
    return syncStatus().then(setSt).catch(() => {});
  }, [refreshAccount]);
  // Sin sondeo: se lee al abrir, al volver a la ventana y cuando Rust avisa de que el plan o la sesión cambiaron (más tras cada acción).
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const un = onAccountChanged(() => refresh());
    return () => { window.removeEventListener("focus", onFocus); void un.then((f) => f()).catch(() => {}); };
  }, [refresh]);
  // Mientras se sincroniza: estado cada segundo (qué paso va y cuánto lleva).
  const working = !!st?.phase;
  // Se mira el estado local (sin red) mientras hay una acción en curso o la sincronización de fondo está trabajando.
  const watching = busy || working;
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => { setNow(Date.now()); void syncStatus().then(setSt).catch(() => {}); }, 1000);
    return () => clearInterval(id);
  }, [watching]);

  useEffect(() => {
    if (!password) { setStrength(null); return; }
    const id = setTimeout(() => setStrength(passwordStrength(password)), 1000);
    return () => clearTimeout(id);
  }, [password]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      const m = keyError(e);
      setMsg(m === "Sincronización cancelada." ? t(m) : m);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Portabilidad (RGPD): guarda en un JSON la cuenta, el plan, la aceptación de términos y todo lo que Caesar guarda en este equipo. */
  const downloadData = async () => {
    const local: Record<string, unknown> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("caesar.")) continue;
        const v = localStorage.getItem(k) ?? "";
        try { local[k] = JSON.parse(v); } catch { local[k] = v; }
      }
    } catch { /* sin almacenamiento */ }
    const data = {
      app: "Caesar",
      exportedAt: new Date().toISOString(),
      account: { email: account.email, plan: account.mode, pro: account.is_pro, proForever: account.forever, proEmpresa: account.empresa, whitelisted: account.whitelisted },
      subscription: bill ? { active: bill.active, status: bill.status, endsAt: bill.ends_at || null } : null,
      termsAcceptance: acceptedTerms(),
      local,
    };
    const path = await saveTextFile("caesar-mis-datos.json", JSON.stringify(data, null, 2), "json");
    if (path) setSavedMsg(`${t("Datos guardados en")} ${path}`);
  };

  const signedIn = st?.signed_in ?? false;
  const billingOn = st?.billing ?? false;
  // Si el cobro ya consta como activo pero la cuenta sigue en limbo, se reevalúa el plan contra la red (account_state es solo caché).
  const checkBilling = useCallback(
    () =>
      syncBilling()
        .then((b) => setBill(b))
        .catch(() => {})
        // Reevalúa el plan siempre que no sea Pro: cubre tanto un pago como un alta en la lista blanca.
        .then(async () => {
          if (account.mode !== "pro") setAccount(await checkTrialAndWhitelist());
        })
        .catch(() => {}),
    [account.mode, setAccount],
  );
  // Una sola lectura al abrir (y otra al pulsar «Ya he pagado»); el resto lo avisa Rust cuando el plan cambia.
  useEffect(() => {
    if (!signedIn || !billingOn) return;
    void checkBilling();
  }, [signedIn, billingOn, account.mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
                  <span className={`inline-block h-2 w-2 rounded-full ${st.error ? "bg-red-400" : !account.is_pro ? "bg-slate-400" : st.dirty ? "bg-amber-400" : "bg-emerald-400"}`} />
                  {st.error ? t("Con problemas de sincronización") : !account.is_pro ? t("Solo local (sin Pro)") : st.dirty ? t("Subiendo cambios…") : t("Sesión iniciada")}
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
                <p className="text-sm font-medium text-mist">{t("¿Cerrar sesión en Caesar?")}</p>
                <p className="text-xs text-silver">{t("Tus colecciones sincronizadas se eliminarán de este dispositivo (seguirán a salvo en la nube).")}</p>
                <ul className="space-y-1 text-xs text-slate">
                  <li>
                    <b className="text-mist">{t("Se quitan de este equipo")}:</b>{" "}
                    {sharedCount > 0 ? t("{0} colección(es) compartida(s). Siguen en la nube para su equipo.", String(sharedCount)) : t("no tienes colecciones compartidas.")}
                  </li>
                  <li>
                    <b className="text-mist">{t("Se quedan")}:</b> {t("tus colecciones locales, variables y ajustes.")}
                  </li>
                </ul>
                <label className="flex cursor-pointer items-start gap-2 text-xs text-silver">
                  <input type="checkbox" className="mt-0.5" checked={wipeOut} disabled={busy} onChange={(e) => setWipeOut(e.target.checked)} />
                  <span>
                    {t("Eliminar también mis colecciones locales")}{" "}
                    <span className="text-red-400">{t("(Atención: no tienen copia de seguridad y se perderán para siempre). Márcalo si compartes este ordenador.")}</span>
                  </span>
                </label>
                <div className="flex gap-2">
                  <button
                    className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (wipeOut) markWiping();
                        try { await onBeforeSignOut(); } catch { /* sin red: no bloquea el cierre */ }
                        await syncSignOut();
                        if (wipeOut) { await wipeLocalAndReload(); return; }
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
                    {busy ? t("Cerrando sesión…") : t("Cerrar sesión")}
                  </button>
                  <button className={ghostCls} disabled={busy} onClick={() => { setConfirmOut(false); setWipeOut(false); }}>{t("Cancelar")}</button>
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
                onClick={() => { setMode(m); setMsg(null); setForgot(false); setResetSent(false); }}
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
              {forgot && !reg ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!email.trim()) return setMsg(t("Escribe tu correo."));
                    run(async () => { await syncResetPassword(email); setResetSent(true); });
                  }}
                >
                  <p className="text-xs text-slate">{t("Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.")}</p>
                  <input className={inputCls} type="email" autoComplete="username" placeholder={t("Correo")} value={email} onChange={(e) => { setEmail(e.target.value); setResetSent(false); }} />
                  {resetSent && <p className="text-xs text-green-400">{t("Si existe una cuenta con ese correo, te hemos enviado un enlace para restablecer la contraseña. Revisa también el spam.")}</p>}
                  <div className="flex gap-2">
                    <button className={btnCls} disabled={busy || !email.trim()} type="submit">{busy ? t("Un momento…") : resetSent ? t("Enviar de nuevo") : t("Enviar enlace")}</button>
                    <button type="button" className={ghostCls} disabled={busy} onClick={() => { setForgot(false); setResetSent(false); setMsg(null); }}>{t("Volver")}</button>
                  </div>
                </form>
              ) : (<>
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
                {reg && strength !== null && (
                  <div className="space-y-1" aria-live="polite">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= Math.max(1, strength) ? STRENGTH_COLORS[strength] : "bg-fg/15"}`} />
                      ))}
                    </div>
                    <p className="text-xs text-slate">{t("Seguridad de la contraseña")}: <span className="text-mist">{t(STRENGTH_LABELS[strength])}</span></p>
                  </div>
                )}
                {!reg && (
                  <button type="button" className="text-xs text-slate underline hover:text-mist" onClick={() => { setForgot(true); setResetSent(false); setMsg(null); }}>
                    {t("¿Olvidaste tu contraseña?")}
                  </button>
                )}
                <button className={btnCls} disabled={busy || !email.trim() || !password} type="submit">
                  {busy ? t("Un momento…") : reg ? t("Crear cuenta") : t("Iniciar sesión")}
                </button>
              </form>
              {(st.google || st.github) && <p className="text-center text-xs text-slate">{t("o")}</p>}
              <SocialButtons st={st} busy={busy} run={run} reg={reg} onSuccess={done} />
              </>)}
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
          <PlanNotice />
          <div className="flex flex-wrap gap-2">
            <button className={btnCls} disabled={busy} onClick={() => run(openCheckout)}>{t("Activar Pro")}</button>
            <button className={btnCls} onClick={() => { openUrl(EMPRESAS_URL).catch(() => {}); }}>{t("Activar Pro Empresa")}</button>
          </div>
        </div>
      )}

      {st.signed_in && account.forever && (
        <div className="max-w-md space-y-1 rounded-xl bg-deep p-4 ring-1 ring-aqua/40">
          {account.empresa ? (
            <>
              <p className="text-sm font-medium text-mist">{t("Plan Pro EMPRESA")}</p>
              <p className="text-xs text-slate">{t("Tu cuenta usa una licencia de empresa: Pro con sincronización, equipos y espacios ilimitados.")}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-mist">{t("Plan Compas · Pro para siempre")}</p>
              <p className="text-xs text-slate">{t("Tu cuenta es Pro de por vida: no hay suscripción ni caducidad. A Nemo le haces feliz.")}</p>
            </>
          )}
        </div>
      )}
      {st.signed_in && !account.is_pro && (
        <section className="space-y-2">
          <h3 className="text-sm text-mist">{t("Canjear código")}</h3>
          <p className="max-w-md text-xs text-slate">{t("¿Te han pasado un código o una licencia de empresa? Pégalo aquí para desbloquear Pro.")}</p>
          <form
            className="flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!code.trim()) return;
              setBusy(true);
              setCodeMsg(null);
              redeemCode(code)
                .then((a) => {
                  setAccount(a);
                  setCode("");
                  setCodeMsg({ ok: true, text: a.empresa ? t("¡Listo! Tu cuenta ya es Pro EMPRESA.") : t("¡Listo! Ya eres Pro para siempre.") });
                })
                .catch((err) => setCodeMsg({ ok: false, text: errText(err) }))
                .finally(() => {
                  setBusy(false);
                  refresh();
                });
            }}
          >
            <input className={`${inputCls} font-mono`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CAESAR-XXXX-XXXX-XXXX…" spellCheck={false} autoComplete="off" />
            <button type="submit" className={btnCls} disabled={busy || !code.trim()}>{t("Canjear")}</button>
          </form>
          {codeMsg && <p className={`text-xs ${codeMsg.ok ? "text-emerald-400" : "text-rose"}`}>{codeMsg.text}</p>}
        </section>
      )}

      {/* Aviso bien visible: falta la clave de cifrado en este equipo */}
      {st.signed_in && account.mode === "pro" && role && (role.role === "needs_key" || role.role === "revoked") && (
        <div className="flex max-w-md items-start gap-3 rounded-xl bg-deep p-4 ring-1 ring-amber-400/50" role="alert">
          <KeyRound size={18} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-mist">{role.role === "revoked" ? t("La clave de cifrado ha cambiado") : t("Falta la clave de cifrado en este equipo")}</p>
            <p className="text-xs text-slate">{t("Pégala abajo, en «Clave de cifrado». Hasta entonces este equipo no sincroniza.")}</p>
          </div>
        </div>
      )}
      {st.signed_in && account.mode === "pro" && !role && roleErr && (
        <p className="max-w-md text-xs text-red-400">{t("No se pudo comprobar la clave de cifrado")}: {roleErr}</p>
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
      {st.signed_in && account.whitelisted && !account.forever && !bill?.active && (
        <section className="space-y-3">
          <h3 className="text-sm text-mist">{t("Suscripción")}</h3>
          <div className="max-w-md space-y-1 rounded-xl bg-deep p-4 ring-1 ring-fg/15">
            <p className="text-sm text-mist">{t("Plan Pro concedido")}</p>
            <p className="text-xs text-slate">{t("Tienes acceso Pro sin coste: no necesitas suscribirte.")}</p>
          </div>
        </section>
      )}
      {st.signed_in && st.billing && !account.forever && !(account.whitelisted && !bill?.active) && (
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
              <PlanNotice />
              <div className="flex flex-wrap gap-2">
                <button
                  className={btnCls}
                  disabled={busy}
                  onClick={() => run(async () => { openUrl(await syncCheckoutUrl()).catch(() => {}); })}
                >
                  {t("Suscribirme")}
                </button>
                <button className={ghostCls} disabled={busy} onClick={() => run(async () => { await checkBilling(); })}>{t("Ya he pagado, comprobar")}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. Estado */}
      {st.signed_in && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button className={ghostCls} disabled={busy || working || account.mode !== "pro"} onClick={() => run(syncNow)}>
              <RefreshCw size={14} className={`mr-2 inline ${working ? "animate-spin" : ""}`} />
              {working ? t("Sincronizando…") : t("Sincronizar ahora")}
            </button>
            {working && (
              <button className={ghostCls} onClick={() => { void syncCancel().catch(() => {}); }} title={t("Cancelar")} aria-label={t("Cancelar sincronización")}>
                <X size={14} className="mr-1 inline" />
                {t("Cancelar")}
              </button>
            )}
            {!working && (
              <span className="text-xs text-slate">
                {!account.is_pro ? t("Sin Pro no se sincroniza: tus datos quedan solo en este equipo.") : !st.has_key ? t("Falta la clave de cifrado en este equipo.") : st.error ? t("La última sincronización falló.") : st.dirty ? t("Cambios pendientes de subir (se suben solos cada 30 s).") : st.last_sync ? `${t("Última sincronización")}: ${new Date(st.last_sync).toLocaleTimeString()}` : t("Al día")}
              </span>
            )}
          </div>
          {working && (
            <div className="max-w-md space-y-1" role="status" aria-live="polite">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10">
                <div className="h-full w-1/3 animate-[caesar-sync-slide_1.2s_ease-in-out_infinite] rounded-full bg-[var(--t-iris)]" />
              </div>
              <p className="text-xs text-slate">
                {t(st.phase ?? "")}{st.phase_since ? ` · ${Math.max(0, Math.round((now - st.phase_since) / 1000))} s` : ""}
              </p>
            </div>
          )}
          {st.error && <p className="text-xs text-red-400">{st.error}</p>}
        </section>
      )}
      {st.signed_in && (
        <section className="space-y-2 border-t border-fg/10 pt-4">
          <h3 className="text-sm text-mist">{t("Tus datos")}</h3>
          <p className="max-w-md text-xs text-slate">{t("Descarga un JSON con tu cuenta, tu plan, el registro de aceptación y tu contenido local.")}</p>
          <button className={ghostCls} disabled={busy} onClick={() => run(downloadData)}>{t("Descargar mis datos")}</button>
          {savedMsg && <p className="break-all text-xs text-aqua">{savedMsg}</p>}
        </section>
      )}
      {st.signed_in && (
        <section className="space-y-2 border-t border-fg/10 pt-4">
          {confirmDel ? (
            <div className="max-w-md space-y-3">
              <p className="text-sm font-medium text-mist">{t("Eliminar cuenta permanentemente")}</p>
              <p className="text-xs text-slate">
                {t("Esta acción destruirá todos tus datos en la nube y cancelará tu suscripción activa. No se puede deshacer.")}
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-silver">
                <input type="checkbox" className="mt-0.5" checked={wipeDel} disabled={busy} onChange={(e) => setWipeDel(e.target.checked)} />
                <span>{t("Destruir también mi base de datos local en este equipo.")}</span>
              </label>
              <label className="block space-y-1 text-xs text-slate">
                <span>{t("Para confirmar, escribe")} «{DEL_PHRASE}»:</span>
                <input className={inputCls} value={delPhrase} disabled={busy} onChange={(e) => setDelPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
              </label>
              <div className="flex gap-2">
                <button
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy || delPhrase.trim().toLowerCase() !== DEL_PHRASE}
                  onClick={() => run(async () => {
                    if (wipeDel) markWiping();
                    await syncDeleteAccount();
                    clearTermsSent();
                    if (wipeDel) { await wipeLocalAndReload(); return; }
                    setConfirmDel(false); setDelPhrase(""); setBill(null); setShownKey(null); setRole(null);
                  })}
                >
                  {t("Eliminar cuenta")}
                </button>
                <button className={ghostCls} disabled={busy} onClick={() => { setConfirmDel(false); setDelPhrase(""); setWipeDel(false); }}>{t("Cancelar")}</button>
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
