import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Plus, Search } from "lucide-react";
import { t } from "../lib/i18n";
import { rootTypeName, searchSchema, userTypes, type GqlField, type GqlSchema, type RootKind } from "../lib/graphqlSchema";

interface Props {
  schema: GqlSchema;
  /** Campo raíz -> añade una operación completa a la query. */
  onInsertOp: (kind: RootKind, f: GqlField) => void;
  /** Campo anidado -> lo inserta en la posición del cursor. */
  onInsertField: (f: GqlField) => void;
}

type View = { t: "home" } | { t: "type"; name: string } | { t: "field"; parent: string; name: string };

const ROOTS: { kind: RootKind; label: string; hint: string }[] = [
  { kind: "query", label: "Consultas (Query)", hint: "Piden datos al servidor sin modificarlos." },
  { kind: "mutation", label: "Mutaciones (Mutation)", hint: "Crean, cambian o borran datos." },
  { kind: "subscription", label: "Suscripciones (Subscription)", hint: "Reciben datos en vivo cuando algo cambia." },
];

const row = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-fg/5";
const chip = "rounded bg-fg/10 px-1.5 py-px text-[10px] text-slate";

export default function GraphqlSchemaPanel({ schema, onInsertOp, onInsertField }: Props) {
  const [view, setView] = useState<View>({ t: "home" });
  const [hist, setHist] = useState<View[]>([]);
  const [q, setQ] = useState("");
  const go = (v: View) => {
    setHist((h) => [...h, view]);
    setView(v);
    setQ("");
  };
  const back = () => {
    setView(hist[hist.length - 1] ?? { t: "home" });
    setHist((h) => h.slice(0, -1));
  };
  const hits = useMemo(() => searchSchema(schema, q), [schema, q]);
  const types = useMemo(() => userTypes(schema), [schema]);
  const rootOf = (typeName: string): RootKind | null => (ROOTS.find((r) => rootTypeName(schema, r.kind) === typeName)?.kind ?? null);

  const fieldDetail = (parent: string, name: string) => {
    const f = schema.types[parent]?.fields.find((x) => x.name === name);
    if (!f) return null;
    const root = rootOf(parent);
    return (
      <div className="flex flex-col gap-2 text-xs">
        <p className="font-mono text-sm text-aqua break-all">{f.name}</p>
        <p className="text-slate">
          {t("Devuelve")}{" "}
          {schema.types[f.typeName] ? (
            <button className="font-mono text-aqua hover:underline" onClick={() => go({ t: "type", name: f.typeName })} title={t("Ver este tipo")}>
              {f.type}
            </button>
          ) : (
            <span className="font-mono">{f.type}</span>
          )}
        </p>
        {f.description && <p className="whitespace-pre-wrap text-silver">{f.description}</p>}
        {f.deprecated && <p className="text-rose">{t("Obsoleto: el servidor recomienda no usarlo.")}</p>}
        <div>
          <p className="mb-1 text-slate">{f.args.length ? t("Argumentos") : t("Sin argumentos.")}</p>
          <ul className="flex flex-col gap-1">
            {f.args.map((a) => (
              <li key={a.name} className="rounded border border-fg/10 p-1.5">
                <span className="font-mono text-silver">{a.name}</span>: <span className="font-mono text-aqua">{a.type}</span>
                {a.required && <span className={`${chip} ml-1`}>{t("obligatorio")}</span>}
                {a.defaultValue !== null && <span className="ml-1 text-slate">= {a.defaultValue}</span>}
                {a.description && <p className="mt-0.5 text-slate">{a.description}</p>}
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => (root ? onInsertOp(root, f) : onInsertField(f))}
          className="flex items-center justify-center gap-1 rounded-md border border-aqua/50 px-2 py-1.5 text-aqua hover:bg-aqua/10"
          title={root ? t("Añade una operación completa con este campo al final de la query") : t("Inserta este campo en la query, en la posición del cursor")}
        >
          <Plus size={13} /> {root ? t("Añadir a la query") : t("Insertar en la query")}
        </button>
      </div>
    );
  };

  const typeDetail = (name: string) => {
    const ty = schema.types[name];
    if (!ty) return <p className="text-xs text-slate">{t("Tipo no encontrado.")}</p>;
    return (
      <div className="flex flex-col gap-2 text-xs">
        <p>
          <span className="font-mono text-sm text-aqua">{ty.name}</span> <span className={chip}>{ty.kind.toLowerCase().replace("_", " ")}</span>
        </p>
        {ty.description && <p className="whitespace-pre-wrap text-silver">{ty.description}</p>}
        {ty.fields.length > 0 && (
          <div>
            <p className="mb-1 text-slate">{t("Campos")}</p>
            {ty.fields.map((f) => (
              <button key={f.name} className={row} onClick={() => go({ t: "field", parent: ty.name, name: f.name })} title={f.description}>
                <span className="font-mono text-silver">{f.name}</span>
                <span className="ml-auto truncate font-mono text-slate">{f.type}</span>
                <ChevronRight size={12} className="shrink-0 text-slate" />
              </button>
            ))}
          </div>
        )}
        {ty.inputFields.length > 0 && (
          <div>
            <p className="mb-1 text-slate">{t("Campos de entrada")}</p>
            {ty.inputFields.map((f) => (
              <p key={f.name} className="px-2 py-0.5" title={f.description}>
                <span className="font-mono text-silver">{f.name}</span>: <span className="font-mono text-aqua">{f.type}</span>
              </p>
            ))}
          </div>
        )}
        {ty.enumValues.length > 0 && (
          <div>
            <p className="mb-1 text-slate">{t("Valores posibles")}</p>
            {ty.enumValues.map((v) => (
              <p key={v.name} className="px-2 py-0.5 font-mono text-silver" title={v.description}>{v.name}</p>
            ))}
          </div>
        )}
        {ty.possibleTypes.length > 0 && (
          <div>
            <p className="mb-1 text-slate">{t("Puede ser")}</p>
            {ty.possibleTypes.map((p) => (
              <button key={p} className={row} onClick={() => go({ t: "type", name: p })}>
                <span className="font-mono text-silver">{p}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 rounded-[10px] bg-kelp p-2 ring-1 ring-fg/10 glass">
      <p className="text-[11px] leading-snug text-slate">
        {t("El esquema es la lista de lo que el servidor permite pedir. Haz clic en un campo para ver sus argumentos y añadirlo a la query.")}
      </p>
      <div className="flex items-center gap-1.5 rounded-md border border-fg/10 px-2 py-1 focus-within:border-aqua">
        <Search size={13} className="shrink-0 text-slate" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Buscar campo o tipo…")}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate/60"
        />
      </div>
      {view.t !== "home" && !q && (
        <button onClick={back} className="flex items-center gap-1 self-start text-xs text-slate hover:text-aqua" title={t("Volver")}>
          <ArrowLeft size={13} /> {t("Volver")}
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {q.trim() ? (
          hits.length ? (
            hits.map((h, i) => (
              <button key={i} className={row} onClick={() => go(h.kind === "type" ? { t: "type", name: h.name } : { t: "field", parent: h.parent!, name: h.name })}>
                <span className={chip}>{h.kind === "type" ? t("tipo") : t("campo")}</span>
                <span className="font-mono text-silver">{h.name}</span>
                <span className="ml-auto truncate font-mono text-slate">{h.detail}</span>
              </button>
            ))
          ) : (
            <p className="p-2 text-xs text-slate">{t("Sin resultados.")}</p>
          )
        ) : view.t === "field" ? (
          fieldDetail(view.parent, view.name)
        ) : view.t === "type" ? (
          typeDetail(view.name)
        ) : (
          <div className="flex flex-col gap-3">
            {ROOTS.map((r) => {
              const rt = rootTypeName(schema, r.kind);
              const fields = (rt && schema.types[rt]?.fields) || [];
              if (!fields.length) return null;
              return (
                <div key={r.kind}>
                  <p className="px-2 text-xs font-semibold text-silver" title={t(r.hint)}>{t(r.label)}</p>
                  <p className="px-2 pb-1 text-[11px] text-slate">{t(r.hint)}</p>
                  {fields.map((f) => (
                    <button key={f.name} className={row} onClick={() => go({ t: "field", parent: rt!, name: f.name })} title={f.description}>
                      <span className="font-mono text-silver">{f.name}</span>
                      <span className="ml-auto truncate font-mono text-slate">{f.type}</span>
                      <ChevronRight size={12} className="shrink-0 text-slate" />
                    </button>
                  ))}
                </div>
              );
            })}
            <details>
              <summary className="cursor-pointer px-2 text-xs font-semibold text-silver">{t("Tipos ({0})", types.length)}</summary>
              {types.map((ty) => (
                <button key={ty.name} className={row} onClick={() => go({ t: "type", name: ty.name })} title={ty.description}>
                  <span className="font-mono text-silver">{ty.name}</span>
                  <span className={`${chip} ml-auto`}>{ty.kind.toLowerCase().replace("_", " ")}</span>
                </button>
              ))}
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
