import { Check, Circle, X } from "lucide-react";
import type { StepState } from "../types";
import { t } from "../lib/i18n";

function StepIcon({ state }: { state: StepState["state"] }) {
  if (state === "active") return <span className="spinner" />;
  if (state === "done") return <Check size={15} className="text-leaf" />;
  if (state === "error") return <X size={15} className="text-rose" />;
  return <Circle size={11} className="text-slate" />;
}

/** Pasos de la petición en vivo. */
export default function StepList({ steps }: { steps: StepState[] }) {
  return (
    <ul className="space-y-3">
      {steps.map((s) => (
        <li key={s.id} className={`flex items-center gap-3 text-sm ${s.state === "pending" ? "text-slate" : "text-mist"}`}>
          <span className="flex w-5 justify-center"><StepIcon state={s.state} /></span>
          <span className="flex-1">{t(s.label)}</span>
          {s.detail && <span className={`text-xs ${s.state === "error" ? "text-rose" : "text-silver"}`}>{s.detail}</span>}
          {s.state !== "pending" && <span className="w-16 text-right font-mono text-xs text-lav">{s.ms} ms</span>}
        </li>
      ))}
    </ul>
  );
}
