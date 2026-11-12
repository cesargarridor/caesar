import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import CatLogo from "./CatLogo";
import SocialButtons from "./SocialButtons";
import { openUrl, syncSignIn, syncStatus, type SyncStatus } from "../api";
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

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
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
            {!up && <SocialButtons st={st} busy={busy} run={run} />}
            <button type="button" onClick={() => setMode(up ? "signin" : "signup")} className="text-xs text-slate hover:text-mist">
              {up ? t("Ya tengo cuenta") : t("Crear una cuenta")}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            {accountsOn && (
              <>
                <button onClick={() => setMode("signin")} className="btn-aurora w-full px-4 py-2.5 font-semibold">
                  {t("Iniciar sesión")}
                </button>
                <button onClick={() => setMode("signup")} className="w-full rounded-[10px] bg-kelp px-4 py-2.5 text-sm text-mist ring-1 ring-fg/10 hover:ring-fg/30">
                  {t("Registrarse")}
                </button>
                <SocialButtons st={st} busy={busy} run={run} />
              </>
            )}
            <button onClick={finish} className={accountsOn ? "w-full rounded-[10px] px-4 py-2.5 text-sm text-silver hover:text-mist" : "btn-aurora w-full px-4 py-2.5 font-semibold"}>
              {t("Continuar como invitado")}
            </button>
            <p className="px-2 text-xs text-slate">
              {t("Como invitado, tus datos se guardan solo en este dispositivo. Si lo borras o cambias de equipo, los perderás.")}
            </p>
          </div>
        )}

        <p className="mt-8 text-xs text-slate">
          {t("Al continuar aceptas nuestros")} {link(t("Términos"), TERMS_URL)} {t("y reconoces nuestra")} {link(t("Política de privacidad"), PRIVACY_URL)}.
        </p>
      </div>
    </div>
  );
}
