import { useEffect, useState } from "react";
import { openUrl, syncGithubBegin, syncGithubFinish, syncGoogle, syncLinkCancel, syncLinkConfirm, syncLinkIdp, onLinkGithubCode, type DeviceCode, type SyncStatus } from "../api";
import { t } from "../lib/i18n";

export const GoogleIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

export const GithubIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
  </svg>
);

const btnCls =
  "flex w-full items-center justify-center gap-2.5 rounded-[10px] bg-kelp px-4 py-2.5 text-sm text-mist ring-1 ring-fg/10 hover:ring-fg/30 disabled:opacity-50";

/**
 * Botones «Continuar con Google / GitHub» con su icono. Solo salen los proveedores configurados.
 * Si el correo ya existe con otro método, pide confirmar para vincular las cuentas (con la contraseña de la cuenta existente).
 * `run` envuelve la acción (estado ocupado y errores en quien lo usa); `onSuccess` se llama al entrar.
 */
export default function SocialButtons({
  st, busy, run, reg = false, onSuccess,
}: {
  st: SyncStatus | null;
  busy: boolean;
  run: (fn: () => Promise<void>) => void | Promise<void>;
  reg?: boolean;
  onSuccess?: () => void;
}) {
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [link, setLink] = useState<{ email: string; providers: string[] } | null>(null);
  const [pw, setPw] = useState("");
  const [idpNote, setIdpNote] = useState<string | null>(null);
  // Vinculación vía GitHub (LINK_VIA_IDP): Rust emite el código mientras espera la autorización.
  useEffect(() => {
    const un = onLinkGithubCode((d) => {
      setDevice(d);
      openUrl(d.verification_uri).catch(() => {});
    });
    return () => { void un.then((f) => f()).catch(() => {}); };
  }, []);
  if (!st || (!st.github && !st.google)) return null;

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onSuccess?.();
    } catch (e) {
      const m = typeof e === "string" ? e : "";
      if (m.startsWith("LINK_VIA_IDP|")) {
        // Esa cuenta existe con otro proveedor: se lanza su flujo y se vinculan solas (Rust avisa con `account-linked`).
        const [, email, prov] = m.split("|");
        const provider = (prov ?? "").startsWith("github") ? "github.com" : "google.com";
        setIdpNote(t("Esa cuenta ({0}) ya existe con {1}. Inicia sesión con ese proveedor para vincularlas.", email, provider.replace(".com", "")));
        try {
          await syncLinkIdp(provider);
          onSuccess?.();
          return;
        } finally {
          setIdpNote(null);
          setDevice(null);
        }
      }
      if (m.startsWith("LINK_REQUIRED|")) {
        const [, email, prov] = m.split("|");
        setLink({ email, providers: prov ? prov.split(",") : [] });
        throw new Error(""); // el panel de vinculación sustituye al mensaje de error
      }
      throw e;
    }
  };

  if (link) {
    const canPw = link.providers.includes("password");
    const others = link.providers.filter((p) => p !== "password").map((p) => p.replace(".com", ""));
    const cancel = () => { void syncLinkCancel(); setPw(""); setLink(null); };
    return (
      <div className="space-y-3 rounded-xl bg-deep p-4 text-left ring-1 ring-fg/15">
        <p className="text-sm text-mist">{t("Esa cuenta ya existe")}: <b>{link.email}</b></p>
        <p className="text-xs text-slate">{t("Puedes continuar: se vincularán las cuentas y, a partir de ahora, podrás iniciar sesión con las dos.")}</p>
        {canPw ? (
          <>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={t("Contraseña de esa cuenta")}
              autoComplete="current-password"
              className="w-full rounded-[10px] bg-kelp px-3 py-2.5 text-sm text-mist outline-none ring-1 ring-fg/10 focus:ring-aqua"
            />
            <div className="flex gap-2">
              <button type="button" disabled={busy || !pw} className="btn-aurora flex-1 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => void run(async () => { await syncLinkConfirm(pw); setPw(""); setLink(null); onSuccess?.(); })}>
                {t("Vincular y continuar")}
              </button>
              <button type="button" className="rounded-[10px] px-4 py-2 text-sm text-silver hover:text-mist" onClick={cancel}>{t("Cancelar")}</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-slate">{t("Para vincular, inicia sesión primero con")} {others.join(", ")}.</p>
            <button type="button" className="rounded-[10px] px-4 py-2 text-sm text-silver hover:text-mist" onClick={cancel}>{t("Cancelar")}</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {idpNote && <p className="rounded-xl bg-deep p-3 text-xs text-silver ring-1 ring-fg/15">{idpNote}</p>}
      {st.google && (
        <>
          <button type="button" disabled={busy} className={btnCls} onClick={() => void run(() => guard(() => syncGoogle()))}>
            <GoogleIcon /> {busy ? t("Esperando al navegador…") : reg ? t("Registrarse con Google") : t("Continuar con Google")}
          </button>
          {busy && <p className="text-xs text-slate">{t("Se ha abierto tu navegador: elige tu cuenta de Google y vuelve aquí.")}</p>}
        </>
      )}
      {st.github && (
        <>
          <button
            type="button"
            disabled={busy}
            className={btnCls}
            onClick={() =>
              void run(() =>
                guard(async () => {
                  const d = await syncGithubBegin();
                  setDevice(d);
                  openUrl(d.verification_uri).catch(() => {});
                  try {
                    await syncGithubFinish(d);
                  } finally {
                    setDevice(null);
                  }
                }),
              )
            }
          >
            <GithubIcon /> {reg ? t("Registrarse con GitHub") : t("Continuar con GitHub")}
          </button>
          {device && (
            <div className="rounded-xl bg-deep p-4 text-left ring-1 ring-fg/15">
              <p className="mb-2 text-xs text-slate">{t("Escribe este código en GitHub (se ha abierto la página) y autoriza Caesar:")}</p>
              <code className="block select-all text-xl tracking-widest text-mist">{device.user_code}</code>
              <p className="mt-2 break-all text-xs text-slate">{device.verification_uri}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
