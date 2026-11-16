import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import type { KV } from "../types";
import { t } from "../lib/i18n";
import VarInput from "./VarInput";

interface Props {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Sugerencias para la columna Key (p. ej. headers comunes). */
  suggestions?: string[];
}

const input =
  "w-full rounded-md border border-gray-800 bg-transparent px-2 py-1 text-sm placeholder:text-gray-600 transition-colors hover:border-gray-700 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50";

export default function KVEditor({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value", suggestions }: Props) {
  const listId = useId();
  const update = (i: number, patch: Partial<KV>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-1.5">
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            className="accent-orange-500"
          />
          <VarInput
            className={input}
            list={suggestions ? listId : undefined}
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <VarInput className={input} placeholder={valuePlaceholder} value={row.value} onChange={(e) => update(i, { value: e.target.value })} />
          <button
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            className="text-slate hover:text-rose"
            title={t("Eliminar")}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, { key: "", value: "", enabled: true }])}
        className="flex items-center gap-1 pt-1 text-xs text-silver hover:text-aqua"
      >
        <Plus size={14} /> {t("Añadir fila")}
      </button>
    </div>
  );
}
