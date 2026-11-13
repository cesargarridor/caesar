import { openUrl } from "../api";
import { t, useLang } from "../lib/i18n";
import { REFUND_URL, TERMS_URL } from "../lib/legal";

/** Aviso obligatorio junto a cualquier botón que lleve a pagar: renovación automática, precio final, cancelación y reembolso. */
export default function PlanNotice({ className = "" }: { className?: string }) {
  useLang();
  const open = (u: string) => void openUrl(u).catch(() => {});
  return (
    <div className={`space-y-1 text-xs text-slate ${className}`}>
      <p>{t("Suscripción con renovación automática: se cobra cada periodo (mensual o anual, según el plan que elijas) hasta que la canceles. El precio final, con impuestos incluidos, se muestra en la página de pago antes de pagar; no hay cargos ocultos.")}</p>
      <p>{t("Cancelas cuando quieras en «Gestionar suscripción» y conservas Pro hasta el final del periodo pagado. Reembolso en 14 días desde cualquier cobro.")}</p>
      <p>
        <button type="button" className="underline hover:text-mist" onClick={() => open(REFUND_URL)}>{t("Política de reembolsos")}</button>
        {" · "}
        <button type="button" className="underline hover:text-mist" onClick={() => open(TERMS_URL)}>{t("Términos")}</button>
      </p>
    </div>
  );
}
