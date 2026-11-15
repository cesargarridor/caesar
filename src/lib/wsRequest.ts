// Une una petición WebSocket de la UI (url, params, headers, auth, variables) con la sesión en memoria.
import type { AuthData, KV, RequestState } from "../types";
import { buildExecuteArgs } from "./request";
import { isWsUrl, normWsConfig, normalizeWsUrl } from "./ws";
import { SIGNED_TYPES } from "./authSign";
import { connectWs, sendWs } from "./wsStore";
import { t } from "./i18n";

/** URL ws(s) y headers del handshake con variables y autorización (bearer/basic/apikey) ya aplicadas. */
export function buildWsHandshake(req: RequestState, auth: AuthData, vars: KV[]) {
  const a = buildExecuteArgs({ ...req, auth }, vars);
  return {
    url: normalizeWsUrl(a.url),
    headers: a.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [h.key.trim(), h.value] as [string, string]),
  };
}

/** Autorizaciones que no se pueden aplicar a un handshake (necesitan firmar una petición HTTP concreta). */
export const wsAuthUnsupported = (auth: AuthData) => SIGNED_TYPES.includes(auth.type);

/** Conecta. Devuelve un mensaje de error si no se puede ni intentar. */
export function startWs(id: string, req: RequestState, auth: AuthData, vars: KV[]): string | null {
  const { url, headers } = buildWsHandshake(req, auth, vars);
  if (!isWsUrl(url)) return t("Escribe una URL ws:// o wss://");
  connectWs(id, url, headers, normWsConfig(req.ws));
  return null;
}

/** Envía el mensaje del compositor. */
export const sendDraft = (id: string, req: RequestState) => {
  const c = normWsConfig(req.ws);
  return sendWs(id, c.draftFormat, c.draft);
};
