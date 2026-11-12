import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { AuthData, AuthType } from "../types";
import { t } from "../lib/i18n";

interface Props {
  auth: AuthData;
  onChange: (a: AuthData) => void;
  /** false en la autorización de la colección (no tiene a quién heredar). */
  allowInherit?: boolean;
  /** Con "Inherit": la autorización que se está heredando (para mostrarla). */
  inherited?: AuthData | null;
}

/** Mismo orden y nombres que Bruno. */
export const AUTH_OPTIONS: { id: AuthType; label: string }[] = [
  { id: "awsv4", label: "AWS Sig v4" },
  { id: "basic", label: "Basic Auth" },
  { id: "bearer", label: "Bearer Token" },
  { id: "digest", label: "Digest Auth" },
  { id: "ntlm", label: "NTLM Auth" },
  { id: "oauth1", label: "OAuth 1.0" },
  { id: "oauth2", label: "OAuth 2.0" },
  { id: "wsse", label: "WSSE Auth" },
  { id: "apikey", label: "API Key" },
  { id: "akamai", label: "Akamai EdgeGrid" },
  { id: "inherit", label: "Inherit" },
  { id: "none", label: "No Auth" },
];
export const authLabel = (id: string) => AUTH_OPTIONS.find((o) => o.id === id)?.label ?? id;

const input =
  "w-full max-w-md bg-kelp border border-fg/10 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-aqua";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-36 shrink-0 text-silver">{label}</span>
      {children}
    </label>
  );
}

/** Campo secreto con ojo para mostrar/ocultar. */
function Secret({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block w-full max-w-md">
      <input
        type={show ? "text" : "password"}
        className={`${input} pr-8`}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate hover:text-mist" title={show ? t("Ocultar") : t("Mostrar")}>
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  );
}

export default function AuthEditor({ auth, onChange, allowInherit = true, inherited }: Props) {
  const set = (patch: Partial<AuthData>) => onChange({ ...auth, ...patch });
  const x = auth.extra ?? {};
  const setX = (k: string, v: string) => onChange({ ...auth, extra: { ...x, [k]: v } });
  const text = (k: string, label: string, placeholder?: string) => (
    <Field label={label}>
      <input className={input} value={x[k] ?? ""} placeholder={placeholder} onChange={(e) => setX(k, e.target.value)} />
    </Field>
  );
  const secret = (k: string, label: string) => (
    <Field label={label}>
      <Secret value={x[k] ?? ""} onChange={(v) => setX(k, v)} />
    </Field>
  );
  const options = AUTH_OPTIONS.filter((o) => allowInherit || o.id !== "inherit");

  return (
    <div className="space-y-3">
      <Field label={t("Tipo")}>
        <select value={auth.type} onChange={(e) => set({ type: e.target.value as AuthType })} className={input}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </Field>

      {auth.type === "none" && <p className="text-xs text-slate">{t("Esta petición no usa autorización.")}</p>}

      {auth.type === "inherit" && (
        <p className="text-xs text-slate">
          {inherited && inherited.type !== "none"
            ? t("Usa la autorización de la colección: {0}.", authLabel(inherited.type))
            : t("La colección no define autorización: la petición se envía sin ella. Puedes configurarla en la barra lateral, en «Autorización de la colección».")}
        </p>
      )}

      {auth.type === "bearer" && (
        <Field label="Token">
          <Secret value={auth.token} onChange={(token) => set({ token })} placeholder="{{token}}" />
        </Field>
      )}

      {(auth.type === "basic" || auth.type === "digest" || auth.type === "wsse") && (
        <>
          <Field label="Username">
            <input className={input} value={auth.username} onChange={(e) => set({ username: e.target.value })} />
          </Field>
          <Field label="Password">
            <Secret value={auth.password} onChange={(password) => set({ password })} />
          </Field>
          {auth.type === "digest" && <p className="text-xs text-slate">{t("Se pide primero la página sin credenciales y, con el desafío del servidor, se vuelve a enviar firmada.")}</p>}
        </>
      )}

      {auth.type === "ntlm" && (
        <>
          <Field label="Username">
            <input className={input} value={auth.username} onChange={(e) => set({ username: e.target.value })} placeholder="usuario o DOMINIO\usuario" />
          </Field>
          <Field label="Password">
            <Secret value={auth.password} onChange={(password) => set({ password })} />
          </Field>
          {text("domain", "Domain")}
          {text("workstation", "Workstation")}
          <p className="text-xs text-slate">{t("NTLMv2. Autentica la conexión: Caesar hace el intercambio de 3 pasos por la misma conexión.")}</p>
        </>
      )}

      {auth.type === "apikey" && (
        <>
          <Field label="Key">
            <input className={input} value={auth.key} onChange={(e) => set({ key: e.target.value })} placeholder="X-API-Key" />
          </Field>
          <Field label="Value">
            <Secret value={auth.value} onChange={(value) => set({ value })} />
          </Field>
          <Field label={t("Añadir a")}>
            <select value={auth.in} onChange={(e) => set({ in: e.target.value as "header" | "query" })} className={input}>
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </select>
          </Field>
        </>
      )}

      {auth.type === "awsv4" && (
        <>
          {text("accessKey", "Access Key ID")}
          {secret("secretKey", "Secret Access Key")}
          {secret("sessionToken", "Session Token")}
          {text("service", "Service", "execute-api")}
          {text("region", "Region", "us-east-1")}
          <p className="text-xs text-slate">{t("Si dejas Service y Region vacíos se deducen del host (servicio.región.amazonaws.com). Los cuerpos form-data se firman como UNSIGNED-PAYLOAD.")}</p>
        </>
      )}

      {auth.type === "oauth1" && (
        <>
          {text("consumerKey", "Consumer Key")}
          {secret("consumerSecret", "Consumer Secret")}
          {text("token", "Access Token")}
          {secret("tokenSecret", "Token Secret")}
          <Field label="Signature Method">
            <select value={x.signatureMethod || "HMAC-SHA1"} onChange={(e) => setX("signatureMethod", e.target.value)} className={input}>
              <option value="HMAC-SHA1">HMAC-SHA1</option>
              <option value="HMAC-SHA256">HMAC-SHA256</option>
              <option value="PLAINTEXT">PLAINTEXT</option>
            </select>
          </Field>
          {text("realm", "Realm")}
          {text("verifier", "Verifier")}
          <Field label={t("Añadir a")}>
            <select value={x.addTo === "query" ? "query" : "header"} onChange={(e) => setX("addTo", e.target.value)} className={input}>
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </select>
          </Field>
        </>
      )}

      {auth.type === "oauth2" && (
        <>
          <Field label="Grant Type">
            <select value={x.grantType || "manual"} onChange={(e) => setX("grantType", e.target.value)} className={input}>
              <option value="client_credentials">Client Credentials</option>
              <option value="password">Password Credentials</option>
              <option value="manual">{t("Token manual")}</option>
            </select>
          </Field>
          {(x.grantType || "manual") === "manual" ? (
            <>
              <Field label="Access Token">
                <Secret value={x.accessToken ?? ""} onChange={(v) => setX("accessToken", v)} placeholder="{{token}}" />
              </Field>
            </>
          ) : (
            <>
              {text("accessTokenUrl", "Access Token URL", "https://servidor/oauth/token")}
              {text("clientId", "Client ID")}
              {secret("clientSecret", "Client Secret")}
              {x.grantType === "password" && (
                <>
                  <Field label="Username">
                    <input className={input} value={auth.username} onChange={(e) => set({ username: e.target.value })} />
                  </Field>
                  <Field label="Password">
                    <Secret value={auth.password} onChange={(password) => set({ password })} />
                  </Field>
                </>
              )}
              {text("scope", "Scope")}
              <Field label={t("Credenciales de cliente")}>
                <select value={x.credentialsIn === "basic" ? "basic" : "body"} onChange={(e) => setX("credentialsIn", e.target.value)} className={input}>
                  <option value="body">{t("En el cuerpo")}</option>
                  <option value="basic">{t("Cabecera Basic Auth")}</option>
                </select>
              </Field>
              <p className="text-xs text-slate">{t("El token se pide al enviar y se reutiliza hasta que caduque.")}</p>
            </>
          )}
          {text("headerPrefix", "Prefix", "Bearer")}
          <Field label={t("Añadir token a")}>
            <select value={x.addTokenTo === "query" ? "query" : "header"} onChange={(e) => setX("addTokenTo", e.target.value)} className={input}>
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </select>
          </Field>
        </>
      )}

      {auth.type === "akamai" && (
        <>
          {secret("accessToken", "Access Token")}
          {text("clientToken", "Client Token")}
          {secret("clientSecret", "Client Secret")}
          {text("headersToSign", "Headers to Sign", "x-a,x-b")}
          {text("nonce", "Nonce")}
          {text("timestamp", "Timestamp")}
          {text("maxBody", "Max Body", "131072")}
        </>
      )}
    </div>
  );
}
