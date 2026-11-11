import type { AuthData, AuthType } from "../types";
import { t } from "../lib/i18n";

interface Props {
  auth: AuthData;
  onChange: (a: AuthData) => void;
}

const input =
  "w-full max-w-md bg-kelp border border-fg/10 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-aqua";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-silver">{label}</span>
      {children}
    </label>
  );
}

export default function AuthEditor({ auth, onChange }: Props) {
  const set = (patch: Partial<AuthData>) => onChange({ ...auth, ...patch });
  return (
    <div className="space-y-3">
      <Field label={t("Tipo")}>
        <select value={auth.type} onChange={(e) => set({ type: e.target.value as AuthType })} className={input}>
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apikey">API Key</option>
        </select>
      </Field>

      {auth.type === "none" && <p className="text-xs text-slate">{t("Esta petición no usa autorización.")}</p>}

      {auth.type === "bearer" && (
        <Field label="Token">
          <input className={input} value={auth.token} onChange={(e) => set({ token: e.target.value })} placeholder="{{token}}" />
        </Field>
      )}

      {auth.type === "basic" && (
        <>
          <Field label="Username">
            <input className={input} value={auth.username} onChange={(e) => set({ username: e.target.value })} />
          </Field>
          <Field label="Password">
            <input type="password" className={input} value={auth.password} onChange={(e) => set({ password: e.target.value })} />
          </Field>
        </>
      )}

      {auth.type === "apikey" && (
        <>
          <Field label="Key">
            <input className={input} value={auth.key} onChange={(e) => set({ key: e.target.value })} placeholder="X-API-Key" />
          </Field>
          <Field label="Value">
            <input className={input} value={auth.value} onChange={(e) => set({ value: e.target.value })} />
          </Field>
          <Field label={t("Añadir a")}>
            <select value={auth.in} onChange={(e) => set({ in: e.target.value as "header" | "query" })} className={input}>
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </select>
          </Field>
        </>
      )}
    </div>
  );
}
