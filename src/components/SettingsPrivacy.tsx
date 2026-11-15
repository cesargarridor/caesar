import { AlertTriangle, ShieldCheck } from "lucide-react";
import { openUrl } from "../api";
import { t } from "../lib/i18n";
import { COOKIES_URL, DELETE_URL, LEGAL_URL, PRIVACY_URL, SUPPORT_URL, TERMS_URL, WEBSITE_URL } from "../lib/legal";
import CatLogo from "./CatLogo";

const ghost = "rounded-lg px-3 py-1.5 text-sm text-slate transition hover:bg-fg/10 hover:text-mist";
const open = (url: string) => () => void openUrl(url).catch(() => {});

/** Ajustes → Privacidad y licencia: cero telemetría, aviso de cifrado y datos legales de la app. */
export default function SettingsPrivacy({ version }: { version: string }) {
  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-start gap-3 rounded-xl border border-leaf/30 bg-leaf/10 p-4">
          <ShieldCheck size={22} className="mt-0.5 shrink-0 text-leaf" />
          <div>
            <span className="inline-block rounded-full bg-leaf/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-leaf">{t("Cero telemetría")}</span>
            <p className="mt-2 text-sm text-silver">{t("Caesar no rastrea tu uso. No hay herramientas de analítica ni telemetría integradas en esta aplicación.")}</p>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-saffron/30 bg-saffron/10 p-4" role="note">
          <AlertTriangle size={22} className="mt-0.5 shrink-0 text-saffron" />
          <p className="text-sm text-silver">
            <b className="text-mist">Caesar Sync. </b>
            {t("Tus colecciones se cifran localmente con AES-256-GCM. Caesar no tiene acceso a tu clave. Si pierdes el acceso a tus dispositivos, no podremos recuperar tus datos.")}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          <button className={ghost} onClick={open(PRIVACY_URL)}>{t("Política de privacidad")}</button>
          <button className={ghost} onClick={open(COOKIES_URL)}>{t("Cookies")}</button>
          <button className={ghost} onClick={open(DELETE_URL)}>{t("Borrar mis datos")}</button>
        </div>
      </section>

      <section>
        <div className="flex items-center gap-3">
          <CatLogo size={40} />
          <h3 className="text-lg text-mist">Caesar {version ? `v${version}` : ""}</h3>
        </div>
        <p className="mt-3 text-sm text-slate">
          {t("Caesar se distribuye bajo la licencia Fair Source (FSL-1.1-MIT). Está permitido su uso comercial interno, pero prohibida su reventa o uso para crear servicios competitivos.")}
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          <button className={ghost} onClick={open(WEBSITE_URL)}>{t("Sitio web")}</button>
          <button className={ghost} onClick={open(LEGAL_URL)}>{t("Aviso legal")}</button>
          <button className={ghost} onClick={open(TERMS_URL)}>{t("Términos")}</button>
          <button className={ghost} onClick={open(SUPPORT_URL)}>{t("Soporte")}</button>
        </div>
      </section>
    </div>
  );
}
