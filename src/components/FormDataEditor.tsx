import { useState } from "react";
import { FileUp, Plus, Trash2 } from "lucide-react";
import TextEditorModal from "./TextEditorModal";
import VarInput from "./VarInput";
import { pickFile } from "../api";
import type { KV } from "../types";
import { t } from "../lib/i18n";

interface Props {
  rows: KV[];
  onChange: (rows: KV[]) => void;
}

const CT_OPTIONS = [
  "",
  "application/json",
  "text/plain",
  "application/xml",
  "text/xml",
  "application/octet-stream",
  "application/x-www-form-urlencoded",
  "text/html",
  "text/csv",
  "application/pdf",
];

const cell ="w-full rounded-xl bg-kelp px-3 py-1.5 text-sm outline-none ring-1 ring-fg/10 focus:ring-aqua";

/** form-data: cada fila es Text o File. Text abre un editor grande al hacer clic en Value. */
export default function FormDataEditor({ rows, onChange }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<KV>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const choose = async (i: number) => {
    setFileError(null);
    try {
      const f = await pickFile();
      if (f) update(i, { kind: "file", value: f.name, path: f.path });
    } catch (e) {
      setFileError(String(e));
    }
  };

  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => {
        const isFile = row.kind === "file";
        return (
          <div key={i} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              className="accent-[var(--t-accent)]"
            />
            <VarInput className={cell} placeholder="Key" value={row.key} onChange={(e) => update(i, { key: e.target.value })} />
            <select
              value={isFile ? "file" : "text"}
              onChange={(e) =>
                update(i, e.target.value === "file" ? { kind: "file", value: "", path: "" } : { kind: "text", value: "", path: "" })
              }
              className="w-24 shrink-0 rounded-xl bg-kelp px-2 py-1.5 text-sm outline-none ring-1 ring-fg/10"
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>

            {isFile ? (
              <button
                onClick={() => choose(i)}
                className={`${cell} flex items-center gap-2 text-left ${row.value ? "text-mist" : "text-slate"} ${
                  row.value && !row.path ? "ring-lav/60" : ""
                }`}
                title={row.path || t("Seleccionar archivo")}
              >
                <FileUp size={14} className="shrink-0" />
                <span className="truncate">
                  {row.value ? row.value : t("Seleccionar archivo…")}
                  {row.value && !row.path ? "  (vuelve a seleccionarlo)" : ""}
                </span>
              </button>
            ) : (
              <input
                readOnly
                className={`${cell} cursor-pointer truncate`}
                placeholder={t("Value (clic para editar)")}
                value={oneLine(row.value)}
                onClick={() => setEditing(i)}
                onFocus={() => setEditing(i)}
              />
            )}

            <select
              value={row.contentType ?? ""}
              onChange={(e) => update(i, { contentType: e.target.value })}
              title={t("Content-Type de esta parte")}
              className="w-44 shrink-0 rounded-xl bg-kelp px-2 py-1.5 text-xs outline-none ring-1 ring-fg/10"
            >
              <option value="">{t("Content-Type: auto")}</option>
              {(row.contentType && !CT_OPTIONS.includes(row.contentType) ? [...CT_OPTIONS, row.contentType] : CT_OPTIONS)
                .filter(Boolean)
                .map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
            </select>

            <button
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="text-slate hover:text-rose"
              title={t("Eliminar")}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => onChange([...rows, { key: "", value: "", enabled: true, kind: "text" }])}
        className="flex items-center gap-1 pt-1 text-xs text-silver hover:text-mist"
      >
        <Plus size={14} /> {t("Añadir fila")}
      </button>
      {fileError && <p className="text-xs text-rose">{fileError}</p>}

      {editing !== null && rows[editing] && (
        <TextEditorModal
          initial={rows[editing].value}
          onCancel={() => setEditing(null)}
          onDone={(v) => {
            update(editing, { value: v, kind: "text" });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
