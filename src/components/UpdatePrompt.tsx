import CatLogo from "./CatLogo";
import { t } from "../lib/i18n";

interface Props {
  current: string;
  version: string;
  notes: string | null;
  onInstall: () => void;
  onLater: () => void;
}

/** Aviso de actualización: qué versión llega y qué trae; el usuario decide si instala ya o más tarde. */
export default function UpdatePrompt({ current, version, notes, onInstall, onLater }: Props) {
  const lines = (notes ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-deep/90 p-8" onMouseDown={onLater}>
      <div
        className="w-full max-w-md rounded-2xl bg-kelp p-7 glass"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <CatLogo size={44} />
          <div>
            <h2 className="text-lg text-mist">{t("Hay una versión nueva")}</h2>
            <p className="text-xs text-slate">
              v{current} → <span className="text-mist">v{version}</span>
            </p>
          </div>
        </div>
        <h3 className="mt-4 text-xs uppercase tracking-wide text-slate">{t("Novedades")}</h3>
        <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-lg bg-deep p-3 text-sm text-silver">
          {lines.length === 0 && <p className="text-slate">{t("Mejoras y correcciones.")}</p>}
          {lines.map((l, i) => {
            const bullet = /^[-*•]\s+/.test(l);
            const head = /^#+\s+/.test(l);
            const txt = l.replace(/^([-*•]|#+)\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1");
            return head ? (
              <p key={i} className="pt-1 text-mist">{txt}</p>
            ) : (
              <p key={i} className={bullet ? "pl-4 -indent-3" : ""}>
                {bullet ? "• " : ""}
                {txt}
              </p>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate">{t("Caesar se reiniciará solo. Tus pestañas y borradores se conservan.")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onLater} className="rounded-[10px] px-4 py-2 text-sm text-silver ring-1 ring-fg/15 hover:text-mist hover:ring-fg/40">
            {t("Más tarde")}
          </button>
          <button onClick={onInstall} className="rounded-[10px] px-4 py-2 text-sm text-white" style={{ background: "var(--t-iris)" }}>
            {t("Actualizar ahora")}
          </button>
        </div>
      </div>
    </div>
  );
}
