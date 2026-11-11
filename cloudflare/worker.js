// Cloudflare Worker: recibe los avisos (webhooks) de Lemon Squeezy y marca en Firestore si cada usuario tiene la
// suscripción activa. La app lo lee; las reglas de Firestore lo exigen para subir datos a la nube.
//
// Variables y secretos (Cloudflare → Workers → tu worker → Settings → Variables and Secrets):
//   LS_WEBHOOK_SECRET  (secreto)  el "signing secret" del webhook en Lemon Squeezy
//   FIREBASE_SA        (secreto)  el JSON completo de la clave de la cuenta de servicio de Google
//   FIREBASE_PROJECT   (texto)    caesar-sync-app

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

let cached = { token: "", exp: 0 };

/** Token de acceso de Google a partir de la cuenta de servicio (JWT firmado con RS256). */
async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 60 > now) return cached.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
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
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}

/** ¿Debe tener acceso de pago ahora mismo según este estado de Lemon Squeezy? */
function isActive(attrs) {
  const status = attrs.status;
  const ends = attrs.ends_at ? Date.parse(attrs.ends_at) : null;
  if (status === "active" || status === "on_trial" || status === "past_due") return true; // past_due: periodo de gracia
  if (status === "cancelled") return ends !== null && ends > Date.now(); // cancelada pero pagada hasta ends_at
  return false; // expired, unpaid, paused
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Caesar billing webhook", { status: 200 });

    const raw = await request.text();
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
