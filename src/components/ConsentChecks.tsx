import { useState } from "react";
import { openUrl } from "../api";
import { t, useLang } from "../lib/i18n";
import { PRIVACY_URL, TERMS_URL, acceptTerms } from "../lib/legal";

const link = (label: string, url: string) => (
  <button type="button" onClick={() => void openUrl(url).catch(() => {})} className="underline hover:text-mist">
    {label}
  </button>
);

/** Las dos casillas obligatorias (sin marcar de partida): aceptar Términos + Privacidad, y tener 14 años o más. */
export function ConsentChecks({ agree, age, onAgree, onAge }: { agree: boolean; age: boolean; onAgree: (v: boolean) => void; onAge: (v: boolean) => void }) {
  useLang();
  const box = "mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--t-iris)]";
  return (
    <fieldset className="space-y-2 text-left text-xs text-silver">
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className={box} checked={agree} onChange={(e) => onAgree(e.target.checked)} />
        <span>
          {t("He leído y acepto los")} {link(t("Términos"), TERMS_URL)} {t("y la")} {link(t("Política de privacidad"), PRIVACY_URL)}.
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className={box} checked={age} onChange={(e) => onAge(e.target.checked)} />
        <span>{t("Tengo 14 años o más.")}</span>
      </label>
    </fieldset>
  );
}

/** Pide aceptar de nuevo cuando cambia la versión de los términos (o a quien nunca los aceptó con casilla). */
export function TermsGate({ onAccepted }: { onAccepted: () => void }) {
  useLang();
  const [agree, setAgree] = useState(false);
  const [age, setAge] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true" aria-labelledby="terms-gate-title">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-deep p-6 ring-1 ring-fg/15">
        <h2 id="terms-gate-title" className="text-lg text-mist">{t("Términos actualizados")}</h2>
        <p className="text-sm text-silver">
          {t("Hemos actualizado los Términos y la Política de privacidad (ahora incluyen el plan Pro de pago, los reembolsos y los proveedores). Para seguir usando Caesar, léelos y acéptalos.")}
        </p>
        <ConsentChecks agree={agree} age={age} onAgree={setAgree} onAge={setAge} />
        <button
          autoFocus
          className="btn-aurora w-full px-4 py-2.5 font-semibold disabled:opacity-50"
          disabled={!agree || !age}
          onClick={() => { acceptTerms(); onAccepted(); }}
        >
          {t("Aceptar y continuar")}
        </button>
      </div>
    </div>
  );
}
