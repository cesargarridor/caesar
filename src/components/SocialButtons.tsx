import { useState } from "react";
import { openUrl, syncGithubBegin, syncGithubFinish, syncGoogleBegin, syncGoogleFinish, type DeviceCode, type SyncStatus } from "../api";
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
 * Botones «Continuar con Google / GitHub» (flujo de código de dispositivo). Solo aparecen los proveedores configurados.
 * `run` envuelve la acción (estado ocupado, errores y cierre de pantalla en quien lo usa).
 */
export default function SocialButtons({ st, busy, run }: { st: SyncStatus | null; busy: boolean; run: (fn: () => Promise<void>) => void | Promise<void> }) {
  const [device, setDevice] = useState<{ d: DeviceCode; name: string } | null>(null);
  if (!st || (!st.github && !st.google)) return null;

  const go = (name: string, begin: () => Promise<DeviceCode>, finish: (d: DeviceCode) => Promise<void>) => () =>
    void run(async () => {
      const d = await begin();
      setDevice({ d, name });
      openUrl(d.verification_uri).catch(() => {});
      try {
        await finish(d);
      } finally {
        setDevice(null);
      }
    });

  return (
    <div className="space-y-3">
      {st.google && (
        <button type="button" disabled={busy} className={btnCls} onClick={go("Google", syncGoogleBegin, syncGoogleFinish)}>
          <GoogleIcon /> {t("Continuar con Google")}
        </button>
      )}
      {st.github && (
        <button type="button" disabled={busy} className={btnCls} onClick={go("GitHub", syncGithubBegin, syncGithubFinish)}>
          <GithubIcon /> {t("Continuar con GitHub")}
        </button>
      )}
      {device && (
        <div className="rounded-xl bg-deep p-4 text-left ring-1 ring-fg/15">
          <p className="mb-2 text-xs text-slate">
            {t("Escribe este código en")} {device.name} {t("(se ha abierto la página) y autoriza Caesar:")}
          </p>
          <code className="block select-all text-xl tracking-widest text-mist">{device.d.user_code}</code>
        </div>
      )}
    </div>
  );
}
