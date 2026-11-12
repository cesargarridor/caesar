import { useEffect, useState } from "react";
import { ArrowLeft, Check, Cloud, HardDrive } from "lucide-react";
import CatLogo from "./CatLogo";
import SocialButtons from "./SocialButtons";
import { openUrl, syncSignIn, syncStatus, type SyncStatus } from "../api";
import { openCheckout, useAccount } from "../lib/account";
import { t, useLang } from "../lib/i18n";
import { PRIVACY_URL, TERMS_URL, markOnboarded } from "../lib/legal";

type Mode = "signin" | "signup";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("Error desconocido"));
const inputCls = "w-full rounded-[10px] bg-kelp px-3 py-2.5 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua";

/** Pantalla de bienvenida a pantalla completa (primer arranque). Reutiliza la cuenta/sync existente. */
export default function Welcome({ onDone }: { onDone: () => void }) {
  useLang();
  const [mode, setMode] = useState<Mode | null>(null);
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cuenta creada pero sin pagar (limbo): aviso antes de entrar. */
  const [limbo, setLimbo] = useState(false);
  const { refresh } = useAccount();

  const finish = () => {
    markOnboarded();
    onDone();
  };

  // Si ya hay sesión de sync, no hace falta bienvenida.
  useEffect(() => {
    syncStatus()
      .then((s) => {
        setSt(s);
        if (s.signed_in) finish();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      const a = await refresh(); // modo real tras el login (también para Google/GitHub)
      const m = typeof r === "string" ? r : a.mode;
      if (m === "limbo" && !a.whitelisted && !a.is_pro) {
        setLimbo(true); // sin pagar: funciona solo en local 7 días
        openCheckout().catch(() => {});
        return;
      }
      finish(); // la sync arranca sola con la sesión (trabajador existente)
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const link = (label: string, url: string) => (
    <button type="button" onClick={() => void openUrl(url).catch(() => {})} className="underline hover:text-mist">
      {label}
    </button>
  );

  const up = mode === "signup";
  const accountsOn = st?.configured ?? true;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-deep p-8">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 w-fit">
          <CatLogo size={96} />
        </div>
        <h1 className="cosmic-text text-4xl font-normal tracking-[-0.02em]">Caesar</h1>
        <p className="mt-2 mb-8 text-sm text-slate">{t("Bienvenido. Elige cómo quieres empezar.")}</p>

        {mode ? (
          <form
            className="w-full space-y-3 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => syncSignIn(email, password, up));
            }}
          >
            <button type="button" onClick={() => { setMode(null); setError(null); }} className="mb-1 flex items-center gap-1 text-xs text-slate hover:text-mist">
              <ArrowLeft size={14} /> {t("Volver")}
            </button>
            <h3 className="text-lg text-mist">{up ? t("Crear cuenta") : t("Iniciar sesión")}</h3>
            <input type="email" autoFocus autoComplete="username" placeholder={t("Correo")} value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            <input type="password" autoComplete={up ? "new-password" : "current-password"} placeholder={t("Contraseña")} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            {error && <p className="text-xs text-rose">{error}</p>}
            <button type="submit" disabled={busy || !email.trim() || !password} className="btn-aurora w-full px-4 py-2.5 font-semibold disabled:opacity-50">
              {busy ? t("Un momento…") : up ? t("Crear cuenta") : t("Iniciar sesión")}
            </button>
            <SocialButtons st={st} busy={busy} run={run} reg={up} />
            <button type="button" onClick={() => setMode(up ? "signin" : "signup")} className="text-xs text-slate hover:text-mist">
              {up ? t("Ya tengo cuenta") : t("Crear una cuenta")}
            </button>
          </form>
        ) : limbo ? (
          <div className="space-y-4 text-left">
            <h3 className="text-lg text-mist">{t("Cuenta creada")}</h3>
            <p className="text-sm text-silver">
              {t("Se ha abierto tu navegador para activar el plan Pro. Mientras no lo actives, Caesar funciona solo en local durante 7 días; pasado ese plazo la cuenta se elimina y vuelves al modo Invitado.")}
            </p>
            <button onClick={() => void openCheckout().catch(() => {})} className="w-full rounded-[10px] bg-kelp px-4 py-2.5 text-sm text-mist ring-1 ring-fg/10 hover:ring-fg/30">
              {t("Abrir página de pago otra vez")}
            </button>
            <button onClick={finish} className="btn-aurora w-full px-4 py-2.5 font-semibold">{t("Entrar en modo local")}</button>
          </div>
        ) : (
          <div className="space-y-3 text-left">
            <button onClick={finish} className="w-full rounded-[14px] bg-kelp p-4 text-left ring-1 ring-fg/10 hover:ring-fg/30">
              <span className="flex items-center gap-2 text-sm font-semibold text-mist"><HardDrive size={16} /> {t("Continuar como Invitado (Local)")}</span>
              <span className="mt-1 block text-xs text-slate">
                {t("Sin cuenta. Tus datos se guardan solo en este dispositivo (si lo borras o cambias de equipo, los perderás). Un espacio de trabajo, sin compartir con equipos ni sincronizar.")}
              </span>
            </button>
            {accountsOn && (
              <div className="rounded-[14px] bg-kelp p-4 ring-1 ring-aqua/40">
                <span className="flex items-center gap-2 text-sm font-semibold text-mist"><Cloud size={16} /> {t("Cuenta Pro / Iniciar sesión")}</span>
                <ul className="mt-2 space-y-1 text-xs text-slate">
                  {[t("Sincronización cifrada entre tus equipos"), t("Espacios de trabajo ilimitados"), t("Compartir colecciones y espacios con tu equipo")].map((x) => (
                    <li key={x} className="flex items-center gap-1.5"><Check size={12} className="text-aqua" /> {x}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate">{t("Al crear la cuenta tienes 7 días para activar Pro; mientras tanto funciona en local.")}</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setMode("signin")} className="btn-aurora flex-1 px-4 py-2 text-sm font-semibold">{t("Iniciar sesión")}</button>
                  <button onClick={() => setMode("signup")} className="flex-1 rounded-[10px] bg-deep px-4 py-2 text-sm text-mist ring-1 ring-fg/10 hover:ring-fg/30">{t("Crear cuenta")}</button>
                </div>
                <div className="mt-3"><SocialButtons st={st} busy={busy} run={run} /></div>
                {error && <p className="mt-2 text-xs text-rose">{error}</p>}
              </div>
            )}
          </div>
        )}

        <p className="mt-8 text-xs text-slate">
          {t("Al continuar aceptas nuestros")} {link(t("Términos"), TERMS_URL)} {t("y reconoces nuestra")} {link(t("Política de privacidad"), PRIVACY_URL)}.
        </p>
      </div>
    </div>
  );
}
