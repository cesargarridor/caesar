// Cloudflare Worker: recibe los avisos (webhooks) de Lemon Squeezy y marca en Firestore si cada usuario tiene la
// suscripción activa. La app lo lee; las reglas de Firestore lo exigen para subir datos a la nube.
//
// Variables y secretos (Cloudflare → Workers → tu worker → Settings → Variables and Secrets):
//   LS_WEBHOOK_SECRET  (secreto)  el "signing secret" del webhook en Lemon Squeezy
//   FIREBASE_SA        (secreto)  el JSON completo de la clave de la cuenta de servicio de Google
//   FIREBASE_PROJECT   (texto)    caesar-sync-app
//   FIREBASE_API_KEY   (texto)    la apiKey web de Firebase (la de sync_config.json); solo valida el token del usuario al canjear un código
//   LS_API_KEY         (secreto)  API key de Lemon Squeezy (Settings → API): permite cancelar la suscripción al borrar la cuenta

const enc = new TextEncoder();

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (data) =>
  btoa(typeof data === "string" ? data : String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Comprueba la firma HMAC-SHA256 del cuerpo exacto que envía Lemon Squeezy. */
async function validSignature(raw, signature, secret) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  // Comparación en tiempo constante.
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return diff === 0;
}

const cached = {}; // por scope: { token, exp }

/** Token de acceso de Google a partir de la cuenta de servicio (JWT firmado con RS256). */
async function googleToken(sa, scope = "https://www.googleapis.com/auth/datastore") {
  const now = Math.floor(Date.now() / 1000);
  const c = cached[scope];
  if (c && c.token && c.exp - 60 > now) return c.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}`);
  const j = await res.json();
  cached[scope] = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached[scope].token;
}

/** ¿Debe tener acceso de pago ahora mismo según este estado de Lemon Squeezy? */
function isActive(attrs) {
  const status = attrs.status;
  const ends = attrs.ends_at ? Date.parse(attrs.ends_at) : null;
  if (status === "active" || status === "on_trial" || status === "past_due") return true; // past_due: periodo de gracia
  if (status === "cancelled") return ends !== null && ends > Date.now(); // cancelada pero pagada hasta ends_at
  return false; // expired, unpaid, paused
}

// ---------------------------------------------------------------------------------------------------------------------
// Limpieza horaria de cuentas de prueba caducadas (Cron Trigger).
// Borra de Firebase Auth las cuentas con más de 7 días que NO sean whitelist (users/{uid}.isWhitelistMember), ni Pro para siempre (users/{uid}.proForever, por código canjeado), ni tengan
// suscripción activa (users/{uid}/billing/status.active). La whitelist vive solo en Firestore.
// Variables extra: DRY_RUN="1" (solo loguea, no borra), MAX_DELETES (por defecto 2000),
// MAX_SUBREQUESTS (por defecto 45; plan gratis = 50 por invocación). Todo en lote: batchGet Auth, documents:batchGet, batchDelete.
// ---------------------------------------------------------------------------------------------------------------------

export const TRIAL_DAYS = 7;
export const DEFAULT_MAX_DELETES = 2000;
export const DEFAULT_MAX_SUBREQUESTS = 45;
const USERS_PER_READ = 100; // 200 docs (user + billing) por documents:batchGet
const WAVE = 500; // candidatas por ronda (lectura → relectura → borrado)
const DELETE_CHUNK = 500; // localIds por accounts:batchDelete (máx 1000)
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** ¿La cuenta se creó hace más de 7 días? */
export function isExpired(createdAtMs, now = Date.now()) {
  const c = Number(createdAtMs);
  if (!Number.isFinite(c) || c <= 0) return false; // sin fecha fiable: nunca caducada
  return c < now - TRIAL_DAYS * 86400000;
}

/** Decisión pura: ¿borrar? (caducada y ni whitelist, ni Pro para siempre, ni de pago). */
export function shouldDelete({ createdAtMs, isWhitelistMember, proForever, billingActive }, now = Date.now()) {
  return isExpired(createdAtMs, now) && isWhitelistMember !== true && proForever !== true && billingActive !== true;
}

/** Estado de un doc leído en lote. */
const billingIsActive = (f) => f.active?.booleanValue === true || f.status?.stringValue === "active";

/** Lista todos los usuarios de Firebase Auth paginando (1 subrequest por página de 1000). Para si se agota el presupuesto. */
async function listAllUsers(env, token, budget) {
  const users = [];
  let page = "";
  do {
    if (!budget.spend()) {
      console.warn("Presupuesto de subrequests agotado durante el listado; se continuará en la siguiente ejecución");
      break;
    }
    const url =
      `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/accounts:batchGet?maxResults=1000` +
      (page ? `&nextPageToken=${encodeURIComponent(page)}` : "");
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Auth batchGet ${res.status}`);
    const j = await res.json();
    users.push(...(j.users || []));
    page = j.nextPageToken || "";
  } while (page);
  return users;
}

/**
 * Lee users/{uid} y users/{uid}/billing/status de varios uids con Firestore documents:batchGet (1 subrequest por trozo).
 * Devuelve Map uid → {isWhitelistMember, billingActive} o {error}. Sin respuesta fiable → error (duda → no borrar).
 * Si el presupuesto no alcanza, los uids sin leer NO aparecen en el mapa.
 */
async function readExemptions(env, token, uids, budget) {
  const out = new Map();
  const base = `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;
  for (let i = 0; i < uids.length; i += USERS_PER_READ) {
    const chunk = uids.slice(i, i + USERS_PER_READ);
    if (!budget.spend()) break;
    try {
      const res = await fetch(`https://firestore.googleapis.com/v1/${base}:batchGet`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ documents: chunk.flatMap((u) => [`${base}/users/${u}`, `${base}/users/${u}/billing/status`]) }),
      });
      if (!res.ok) throw new Error(`Firestore batchGet ${res.status}`);
      const arr = await res.json();
      const docs = new Map(); // ruta relativa → fields ({} si no existe)
      for (const r of Array.isArray(arr) ? arr : []) {
        if (r.found?.name) docs.set(r.found.name.slice(base.length + 1), r.found.fields || {});
        else if (r.missing) docs.set(String(r.missing).slice(base.length + 1), {});
      }
      for (const u of chunk) {
        const user = docs.get(`users/${u}`);
        const bill = docs.get(`users/${u}/billing/status`);
        if (user === undefined || bill === undefined) out.set(u, { error: "respuesta incompleta" });
        else out.set(u, { isWhitelistMember: user.isWhitelistMember?.booleanValue === true, proForever: user.proForever?.booleanValue === true, billingActive: billingIsActive(bill) });
      }
    } catch (e) {
      for (const u of chunk) out.set(u, { error: e.message });
    }
  }
  return out;
}

/** Ejecuta la limpieza. Devuelve el resumen {revisados, exentos, borrados, errores[, restantes]}. */
export async function cleanupExpiredAccounts(env, now = Date.now()) {
  const dryRun = String(env.DRY_RUN || "") === "1";
  const max = Number(env.MAX_DELETES) > 0 ? Number(env.MAX_DELETES) : DEFAULT_MAX_DELETES;
  const limit = Number(env.MAX_SUBREQUESTS) > 0 ? Math.floor(Number(env.MAX_SUBREQUESTS)) : DEFAULT_MAX_SUBREQUESTS;
  const budget = { left: limit, spend() { if (this.left <= 0) return false; this.left--; return true; } };
  const summary = { revisados: 0, exentos: 0, borrados: 0, errores: 0 };
  const sa = JSON.parse(env.FIREBASE_SA);
  budget.spend(); // token OAuth
  const token = await googleToken(sa, CLOUD_SCOPE);
  const users = await listAllUsers(env, token, budget);
  summary.revisados = users.length;

  const candidates = users.filter((u) => u.localId && isExpired(u.createdAt, now));
  const resolved = new Set();
  const byId = new Map(candidates.map((u) => [u.localId, u]));
  const isDeletable = (u, ex) => !ex.error && shouldDelete({ createdAtMs: u.createdAt, ...ex }, now);

  let idx = 0;
  while (idx < candidates.length && summary.borrados < max && budget.left > 0) {
    const wave = candidates.slice(idx, idx + Math.min(WAVE, max - summary.borrados));
    idx += wave.length;
    const ids = wave.map((u) => u.localId);

    // 1ª lectura en lote
    const first = await readExemptions(env, token, ids, budget);
    const pending = [];
    for (const id of ids) {
      const ex = first.get(id);
      if (!ex) continue; // sin presupuesto: queda para la siguiente ejecución
      if (ex.error) { summary.errores++; resolved.add(id); console.error(`No se borra ${id}: ${ex.error}`); }
      else if (!isDeletable(byId.get(id), ex)) { summary.exentos++; resolved.add(id); }
      else pending.push(id);
    }
    if (!pending.length) continue;

    // Anti-carrera: relectura en lote justo antes de borrar (webhook de pago tardío)
    const second = await readExemptions(env, token, pending, budget);
    const toDelete = [];
    for (const id of pending) {
      const ex = second.get(id);
      if (!ex) continue;
      if (ex.error) { summary.errores++; resolved.add(id); console.error(`No se borra ${id}: ${ex.error}`); }
      else if (!isDeletable(byId.get(id), ex)) { summary.exentos++; resolved.add(id); }
      else toDelete.push(id);
    }

    // Borrado en lote
    for (let i = 0; i < toDelete.length; i += DELETE_CHUNK) {
      const chunk = toDelete.slice(i, i + DELETE_CHUNK);
      if (dryRun) {
        for (const id of chunk) console.log(`[DRY_RUN] borraría ${id} (${byId.get(id).email || "sin email"})`);
        summary.borrados += chunk.length;
        chunk.forEach((id) => resolved.add(id));
        continue;
      }
      if (!budget.spend()) break;
      try {
        const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/accounts:batchDelete`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ localIds: chunk, force: true }),
        });
        if (!res.ok) throw new Error(`Auth batchDelete ${res.status}`);
        const j = await res.json().catch(() => ({}));
        const failed = new Set();
        for (const e of j.errors || []) {
          const id = e.localId || chunk[Number(e.index)];
          if (id) failed.add(id);
          console.error(`No se borra ${id}: ${e.message || "error"}`);
        }
        for (const id of chunk) {
          resolved.add(id);
          if (failed.has(id)) summary.errores++;
          else { summary.borrados++; console.log(`Borrada ${id} (${byId.get(id).email || "sin email"})`); }
        }
      } catch (e) {
        for (const id of chunk) { resolved.add(id); summary.errores++; }
        console.error(`batchDelete fallido: ${e.message}`);
      }
    }
  }

  const restantes = candidates.filter((u) => !resolved.has(u.localId)).length;
  if (restantes > 0) {
    summary.restantes = restantes;
    console.warn(`Quedan ${restantes} candidatas sin procesar (límite de ${max} borrados o de ${limit} subrequests); se continuará en la siguiente ejecución`);
  }
  console.log(`Limpieza${dryRun ? " (DRY_RUN)" : ""}: ${JSON.stringify(summary)}`);
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------------
// Canjear código (Pro para siempre, plan «Compas»). POST /redeem  { idToken, code }
// El código es un documento codes/{CÓDIGO} = { max: n, uses: n } que se crea a mano en la consola de Firestore.
// Todo ocurre en una transacción: sube `uses` y marca users/{uid}.proForever. Un mismo usuario no gasta dos usos.
// ---------------------------------------------------------------------------------------------------------------------

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{6,38}[A-Z0-9]$/;
const REDEEM_MAX_BODY = 4 * 1024;

/** Normaliza lo que escribe el usuario: mayúsculas, sin espacios. null si no tiene pinta de código. */
export function normalizeCode(raw) {
  const c = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return CODE_RE.test(c) ? c : null;
}

/** Decisión pura. code/user = `fields` de Firestore (o null si no existe). → "invalid" | "exhausted" | "already" | "ok". */
export function decideRedeem(code, user) {
  if (user?.proForever?.booleanValue === true) return "already"; // ya es Pro para siempre: no gasta un uso
  if (!code) return "invalid";
  const max = Number(code.max?.integerValue ?? code.max?.doubleValue);
  const uses = Number(code.uses?.integerValue ?? code.uses?.doubleValue ?? 0);
  if (!Number.isFinite(max) || max <= 0) return "invalid";
  if (!Number.isFinite(uses) || uses >= max) return "exhausted";
  return "ok";
}

/** uid del dueño del token (Firebase accounts:lookup). null si el token no vale. */
async function uidFromToken(env, idToken) {
  if (!env.FIREBASE_API_KEY || typeof idToken !== "string" || idToken.length < 20 || idToken.length > 4096) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) return null;
  const uid = (await res.json().catch(() => ({})))?.users?.[0]?.localId;
  return typeof uid === "string" && /^[A-Za-z0-9]{10,64}$/.test(uid) ? uid : null;
}

/** Canjea el código para ese uid. Devuelve { status: "ok"|"already"|"invalid"|"exhausted" }; lanza si Firestore falla. */
export async function redeemCode(env, uid, code, now = Date.now()) {
  const sa = JSON.parse(env.FIREBASE_SA);
  const token = await googleToken(sa);
  const base = `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;
  const api = `https://firestore.googleapis.com/v1/${base}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const b = await fetch(`${api}:beginTransaction`, { method: "POST", headers, body: JSON.stringify({ options: { readWrite: {} } }) });
    if (!b.ok) throw new Error(`Firestore beginTransaction ${b.status}`);
    const { transaction } = await b.json();
    const read = async (path) => {
      const res = await fetch(`${api}/${path}?transaction=${encodeURIComponent(transaction)}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Firestore get ${res.status}`);
      return (await res.json()).fields || {};
    };
    const codeDoc = await read(`codes/${code}`);
    const userDoc = await read(`users/${uid}`);
    const decision = decideRedeem(codeDoc, userDoc);
    if (decision !== "ok") {
      // Se cierra la transacción sin escribir nada.
      await fetch(`${api}:rollback`, { method: "POST", headers, body: JSON.stringify({ transaction }) }).catch(() => {});
      return { status: decision };
    }
    const uses = Number(codeDoc.uses?.integerValue ?? 0);
    const c = await fetch(`${api}:commit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        transaction,
        writes: [
          { update: { name: `${base}/codes/${code}`, fields: { uses: { integerValue: String(uses + 1) } } }, updateMask: { fieldPaths: ["uses"] }, currentDocument: { exists: true } },
          {
            update: { name: `${base}/users/${uid}`, fields: { proForever: { booleanValue: true }, proCode: { stringValue: code }, proAt: { integerValue: String(now) } } },
            updateMask: { fieldPaths: ["proForever", "proCode", "proAt"] },
          },
        ],
      }),
    });
    if (c.ok) return { status: "ok" };
    if (c.status !== 409 && c.status !== 400 && c.status !== 429) throw new Error(`Firestore commit ${c.status}`);
    // 409/ABORTED: otro canje a la vez; se reintenta leyendo de nuevo.
  }
  throw new Error("Firestore: demasiada contención");
}

// Límite de intentos de canje por IP: 3 a la hora y 7 al día (cuenta TODOS los intentos con código bien formado, acierten o no).
// Se guarda en Firestore (redeemLimits/{hash de la IP}: attempts = lista de instantes en ms, expiresAt = ms en que ya no hace falta);
// la IP no se guarda en claro, solo su hash SHA-256. Los clientes no pueden leerlo ni escribirlo (regla por defecto: denegado).
// Un intento bloqueado NO se apunta, así que no alarga la espera. El Cron horario borra los documentos caducados (cleanupRateLimits).
export const REDEEM_MAX_PER_HOUR = 3;
export const REDEEM_MAX_PER_DAY = 7;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Id del documento de límite para una petición: hash de la IP (CF-Connecting-IP). Sin IP (no pasa en producción) cae al uid. */
export async function rateKey(ip, uid) {
  const raw = ip ? `ip:${String(ip).trim()}` : `uid:${uid}`;
  const d = await crypto.subtle.digest("SHA-256", enc.encode(`caesar-redeem:${raw}`));
  return hex(d).slice(0, 32);
}

/** Decisión pura. attempts = instantes (ms) de intentos anteriores. → { allowed, retryAfter (segundos), kept (lista podada, sin el intento actual) }. */
export function decideRate(attempts, now = Date.now()) {
  const kept = (Array.isArray(attempts) ? attempts : []).filter((t) => Number.isFinite(t) && t > now - DAY_MS && t <= now).sort((a, b) => a - b);
  const lastHour = kept.filter((t) => t > now - HOUR_MS);
  let wait = 0;
  if (kept.length >= REDEEM_MAX_PER_DAY) wait = Math.max(wait, kept[kept.length - REDEEM_MAX_PER_DAY] + DAY_MS - now);
  if (lastHour.length >= REDEEM_MAX_PER_HOUR) wait = Math.max(wait, lastHour[lastHour.length - REDEEM_MAX_PER_HOUR] + HOUR_MS - now);
  return { allowed: wait <= 0, retryAfter: Math.max(0, Math.ceil(wait / 1000)), kept };
}

/** Apunta un intento para esa clave (ver rateKey) si no ha superado el límite. Devuelve { allowed, retryAfter }; lanza si Firestore falla. */
export async function checkRateLimit(env, key, now = Date.now()) {
  const sa = JSON.parse(env.FIREBASE_SA);
  const token = await googleToken(sa);
  const base = `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;
  const api = `https://firestore.googleapis.com/v1/${base}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const path = `redeemLimits/${key}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const b = await fetch(`${api}:beginTransaction`, { method: "POST", headers, body: JSON.stringify({ options: { readWrite: {} } }) });
    if (!b.ok) throw new Error(`Firestore beginTransaction ${b.status}`);
    const { transaction } = await b.json();
    const res = await fetch(`${api}/${path}?transaction=${encodeURIComponent(transaction)}`, { headers });
    if (res.status !== 404 && !res.ok) throw new Error(`Firestore get ${res.status}`);
    const fields = res.status === 404 ? {} : (await res.json()).fields || {};
    const prev = (fields.attempts?.arrayValue?.values || []).map((v) => Number(v.integerValue));
    const d = decideRate(prev, now);
    if (!d.allowed) {
      await fetch(`${api}:rollback`, { method: "POST", headers, body: JSON.stringify({ transaction }) }).catch(() => {});
      return { allowed: false, retryAfter: d.retryAfter };
    }
    const values = [...d.kept, now].map((t) => ({ integerValue: String(t) }));
    const c = await fetch(`${api}:commit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        transaction,
        writes: [{ update: { name: `${base}/${path}`, fields: { attempts: { arrayValue: { values } }, expiresAt: { integerValue: String(now + DAY_MS) } } }, updateMask: { fieldPaths: ["attempts", "expiresAt"] } }],
      }),
    });
    if (c.ok) return { allowed: true, retryAfter: 0 };
    if (c.status !== 409 && c.status !== 400 && c.status !== 429) throw new Error(`Firestore commit ${c.status}`);
  }
  throw new Error("Firestore: demasiada contención");
}

/**
 * Borra los documentos de límite que ya no sirven (expiresAt < ahora: pasaron 24 h desde el último intento).
 * 2 llamadas como mucho (consulta + borrado en lote), hasta 300 por ejecución; el Cron es horario, así que no se acumulan.
 * DRY_RUN="1" solo cuenta. Devuelve { caducados, borrados }.
 */
export async function cleanupRateLimits(env, now = Date.now()) {
  const sa = JSON.parse(env.FIREBASE_SA);
  const token = await googleToken(sa, CLOUD_SCOPE);
  const base = `projects/${env.FIREBASE_PROJECT}/databases/(default)/documents`;
  const api = `https://firestore.googleapis.com/v1/${base}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const q = await fetch(`${api}:runQuery`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "redeemLimits" }],
        where: { fieldFilter: { field: { fieldPath: "expiresAt" }, op: "LESS_THAN", value: { integerValue: String(now) } } },
        limit: 300,
      },
    }),
  });
  if (!q.ok) throw new Error(`Firestore runQuery ${q.status}`);
  const names = ((await q.json()) || []).map((r) => r.document?.name).filter((n) => typeof n === "string" && n.startsWith(`${base}/redeemLimits/`));
  const summary = { caducados: names.length, borrados: 0 };
  if (!names.length || String(env.DRY_RUN || "") === "1") return summary;
  const c = await fetch(`${api}:commit`, { method: "POST", headers, body: JSON.stringify({ writes: names.map((name) => ({ delete: name })) }) });
  if (!c.ok) throw new Error(`Firestore commit ${c.status}`);
  summary.borrados = names.length;
  return summary;
}

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...extra } });

async function handleRedeem(request, env) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const raw = await readLimited(request, REDEEM_MAX_BODY);
  if (raw === null) return json({ error: "too_big" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const code = normalizeCode(body?.code);
  if (!code) return json({ error: "invalid" }, 400);
  try {
    const uid = await uidFromToken(env, body?.idToken);
    if (!uid) return json({ error: "auth" }, 401);
    const rate = await checkRateLimit(env, await rateKey(request.headers.get("cf-connecting-ip"), uid));
    if (!rate.allowed) return json({ error: "rate_limited", retryAfter: rate.retryAfter }, 429, { "retry-after": String(rate.retryAfter) });
    const { status } = await redeemCode(env, uid, code);
    if (status === "ok" || status === "already") return json({ ok: true, already: status === "already" });
    return json({ error: status }, status === "exhausted" ? 410 : 404);
  } catch (e) {
    console.error(`Canje fallido: ${e.message}`);
    return json({ error: "server" }, 502);
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// Cuenta: registro de aceptación de los términos (POST /account/terms) y cierre de cuenta (POST /account/close).
// Los dos validan el idToken de Firebase y escriben con la cuenta de servicio (las reglas de Firestore no dejan escribir a la app).
// /account/close cancela la suscripción en Lemon Squeezy (necesita el secreto LS_API_KEY) y borra el registro de aceptación.
// ---------------------------------------------------------------------------------------------------------------------

const TERMS_VERSION_RE = /^\d{4}-\d{2}-\d{2}$/;
const CANCELLABLE = new Set(["active", "on_trial", "past_due", "paused", "unpaid"]);

/** ¿Hay que cancelar algo en Lemon Squeezy? `fields` = users/{uid}/billing/status (o null). → id de suscripción o null. */
export function subscriptionToCancel(fields) {
  const id = fields?.subscriptionId?.stringValue;
  const status = fields?.status?.stringValue;
  return id && /^\d{1,20}$/.test(id) && CANCELLABLE.has(status) ? id : null;
}

/** Guarda que `uid` aceptó los términos `version` (y que tiene 14 años o más). Lanza si Firestore falla. */
export async function recordTerms(env, uid, version, now = Date.now()) {
  if (typeof version !== "string" || !TERMS_VERSION_RE.test(version)) return { status: "invalid" };
  const sa = JSON.parse(env.FIREBASE_SA);
  const token = await googleToken(sa);
  const fields = { version: { stringValue: version }, acceptedAt: { integerValue: String(now) }, age14: { booleanValue: true } };
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}/consent/terms?${mask}`;
  const res = await fetch(url, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`Firestore terms ${res.status}`);
  return { status: "ok" };
}

/**
 * Cancela la suscripción activa de `uid` en Lemon Squeezy y borra su registro de aceptación.
 * → { status: "ok", cancelled: boolean } | { status: "no_key" } (hay suscripción pero falta LS_API_KEY) | { status: "ls_error" }.
 * Lanza si Firestore falla.
 */
export async function closeAccount(env, uid) {
  const sa = JSON.parse(env.FIREBASE_SA);
  const token = await googleToken(sa);
  const api = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}`;
  const headers = { authorization: `Bearer ${token}` };
  const b = await fetch(`${api}/billing/status`, { headers });
  if (!b.ok && b.status !== 404) throw new Error(`Firestore billing ${b.status}`);
  const subId = b.ok ? subscriptionToCancel((await b.json()).fields || {}) : null;
  let cancelled = false;
  if (subId) {
    if (!env.LS_API_KEY) return { status: "no_key" };
    const r = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${env.LS_API_KEY}`, accept: "application/vnd.api+json" },
    });
    if (!r.ok && r.status !== 404) return { status: "ls_error" };
    cancelled = r.ok;
  }
  const d = await fetch(`${api}/consent/terms`, { method: "DELETE", headers });
  if (!d.ok && d.status !== 404) throw new Error(`Firestore consent ${d.status}`);
  return { status: "ok", cancelled };
}

async function handleAccount(request, env, kind) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const raw = await readLimited(request, REDEEM_MAX_BODY);
  if (raw === null) return json({ error: "too_big" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  try {
    const uid = await uidFromToken(env, body?.idToken);
    if (!uid) return json({ error: "auth" }, 401);
    if (kind === "terms") {
      const { status } = await recordTerms(env, uid, body?.version);
      return status === "ok" ? json({ ok: true }) : json({ error: status }, 400);
    }
    const r = await closeAccount(env, uid);
    if (r.status === "ok") return json({ ok: true, cancelled: r.cancelled });
    return json({ error: r.status }, r.status === "no_key" ? 501 : 502);
  } catch (e) {
    console.error(`Cuenta (${kind}) fallida: ${e.message}`);
    return json({ error: "server" }, 502);
  }
}

const MAX_BODY = 100 * 1024;

/** Lee el cuerpo con tope de bytes; devuelve null si lo supera. */
async function readLimited(request, limit) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try { console.log(`Límites de canje: ${JSON.stringify(await cleanupRateLimits(env))}`); } catch (e) { console.error(`Limpieza de límites fallida: ${e.message}`); }
        await cleanupExpiredAccounts(env).catch((e) => console.error(`Limpieza fallida: ${e.message}`));
      })(),
    );
  },

  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/redeem") return handleRedeem(request, env);
    if (path === "/account/terms") return handleAccount(request, env, "terms");
    if (path === "/account/close") return handleAccount(request, env, "close");
    if (request.method === "GET") return new Response("Caesar billing webhook", { status: 200 });
    if (request.method !== "POST") return new Response("Método no permitido", { status: 405, headers: { allow: "GET, POST" } });
    const len = Number(request.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_BODY) return new Response("Cuerpo demasiado grande", { status: 413 });

    const raw = await readLimited(request, MAX_BODY);
    if (raw === null) return new Response("Cuerpo demasiado grande", { status: 413 });
    // Sin llamadas a Firebase/Google antes de validar la firma.
    if (!(await validSignature(raw, request.headers.get("X-Signature") || "", env.LS_WEBHOOK_SECRET))) {
      return new Response("Firma no válida", { status: 401 });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("JSON no válido", { status: 400 });
    }

    const event = body?.meta?.event_name || "";
    if (!event.startsWith("subscription_")) return new Response("Ignorado", { status: 200 });

    // El uid de Firebase viaja en los datos personalizados del checkout (lo añade la app).
    const uid = body?.meta?.custom_data?.uid;
    if (typeof uid !== "string" || !/^[A-Za-z0-9]{10,64}$/.test(uid)) {
      return new Response("Sin uid válido", { status: 200 }); // 200: no tiene sentido que Lemon Squeezy reintente
    }

    const a = body?.data?.attributes || {};
    const fields = {
      active: { booleanValue: isActive(a) },
      status: { stringValue: String(a.status || "") },
      endsAt: { integerValue: String(a.ends_at ? Date.parse(a.ends_at) : 0) },
      renewsAt: { integerValue: String(a.renews_at ? Date.parse(a.renews_at) : 0) },
      portal: { stringValue: String(a.urls?.customer_portal || "") },
      subscriptionId: { stringValue: String(body?.data?.id || "") },
      updatedAt: { integerValue: String(Date.now()) },
    };
    const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join("&");

    try {
      const sa = JSON.parse(env.FIREBASE_SA);
      const token = await googleToken(sa);
      const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/databases/(default)/documents/users/${uid}/billing/status?${mask}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) return new Response(`Firestore ${res.status}`, { status: 502 }); // Lemon Squeezy reintentará
    } catch (e) {
      return new Response("Error interno", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  },
};
