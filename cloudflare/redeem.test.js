import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import worker, { checkRateLimit, cleanupRateLimits, decideRate, rateKey, decideRedeem, normalizeCode, redeemCode, shouldDelete } from "./worker.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = () => ({
  FIREBASE_PROJECT: "p",
  FIREBASE_API_KEY: "key",
  FIREBASE_SA: JSON.stringify({ client_email: "sa@p.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
});
const int = (n) => ({ integerValue: String(n) });
const PRE = "projects/p/databases/(default)/documents/";
const UID = "Ty4SnLdeIlMD6v5ZOtLjW21RMJa2";
const CODE = "CAESAR-ABCD-EFGH-JKLM";

/** docs: ruta → fields. commitStatus: lista de estados HTTP a devolver en los commits sucesivos. */
function mock({ docs, commitStatus = [200], lookup = { users: [{ localId: UID }] } }) {
  const calls = { commits: [], rollbacks: 0, begins: 0 };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "t", expires_in: 3600 });
    if (url.includes("accounts:lookup")) return lookup ? json(lookup) : json({}, 400);
    if (url.endsWith(":beginTransaction")) { calls.begins++; return json({ transaction: "tx" + calls.begins }); }
    if (url.endsWith(":rollback")) { calls.rollbacks++; return json({}); }
    if (url.endsWith(":commit")) {
      calls.commits.push(JSON.parse(opts.body));
      return json({}, commitStatus[Math.min(calls.commits.length - 1, commitStatus.length - 1)]);
    }
    const m = url.match(/documents\/([^?]+)\?transaction=/);
    if (m) {
      const f = docs[decodeURIComponent(m[1])];
      return f === undefined ? json({}, 404) : json({ fields: f });
    }
    throw new Error("url inesperada " + url);
  };
  calls.restore = () => (globalThis.fetch = orig);
  return calls;
}
let calls;
beforeEach(() => calls?.restore());
console.log = console.warn = console.error = () => {};

test("normalizeCode", () => {
  assert.equal(normalizeCode("  caesar-abcd-efgh-jklm "), CODE);
  assert.equal(normalizeCode("caesar abcd efgh jklm"), "CAESARABCDEFGHJKLM");
  assert.equal(normalizeCode("../users/x"), null);
  assert.equal(normalizeCode("abc"), null);
  assert.equal(normalizeCode(undefined), null);
});

test("decideRedeem", () => {
  assert.equal(decideRedeem(null, null), "invalid");
  assert.equal(decideRedeem({ max: int(6), uses: int(0) }, null), "ok");
  assert.equal(decideRedeem({ max: int(6), uses: int(5) }, {}), "ok");
  assert.equal(decideRedeem({ max: int(6), uses: int(6) }, {}), "exhausted");
  assert.equal(decideRedeem({ max: int(0), uses: int(0) }, {}), "invalid");
  assert.equal(decideRedeem({ uses: int(0) }, {}), "invalid");
  assert.equal(decideRedeem({ max: int(6), uses: int(6) }, { proForever: { booleanValue: true } }), "already");
  assert.equal(decideRedeem(null, { proForever: { booleanValue: true } }), "already");
});

test("shouldDelete: proForever está exento", () => {
  const old = { createdAtMs: 1000, isWhitelistMember: false, billingActive: false };
  assert.equal(shouldDelete(old, Date.now()), true);
  assert.equal(shouldDelete({ ...old, proForever: true }, Date.now()), false);
});

test("canje correcto: sube uses y marca proForever en una sola escritura atómica", async () => {
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(6), uses: int(2) } } });
  assert.deepEqual(await redeemCode(env(), UID, CODE, 123), { status: "ok" });
  assert.equal(calls.commits.length, 1);
  const w = calls.commits[0].writes;
  assert.equal(calls.commits[0].transaction, "tx1");
  assert.equal(w[0].update.name, PRE + `codes/${CODE}`);
  assert.equal(w[0].update.fields.uses.integerValue, "3");
  assert.deepEqual(w[0].currentDocument, { exists: true });
  assert.equal(w[1].update.name, PRE + `users/${UID}`);
  assert.equal(w[1].update.fields.proForever.booleanValue, true);
  assert.deepEqual(w[1].updateMask.fieldPaths, ["proForever", "proCode", "proAt"]); // no pisa isWhitelistMember ni nada más
});

test("código agotado, inexistente o ya canjeado: no se escribe nada", async () => {
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(6), uses: int(6) } } });
  assert.deepEqual(await redeemCode(env(), UID, CODE), { status: "exhausted" });
  assert.deepEqual(await redeemCode(env(), UID, "CAESAR-NOPE-NOPE-NOPE"), { status: "invalid" });
  calls.restore();
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(6), uses: int(6) }, [`users/${UID}`]: { proForever: { booleanValue: true } } } });
  assert.deepEqual(await redeemCode(env(), UID, CODE), { status: "already" });
  assert.equal(calls.commits.length, 0);
});

test("contención (409): relee y reintenta; si sigue fallando lanza", async () => {
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(6), uses: int(0) } }, commitStatus: [409, 200] });
  assert.deepEqual(await redeemCode(env(), UID, CODE), { status: "ok" });
  assert.equal(calls.commits.length, 2);
  assert.equal(calls.begins, 2);
  calls.restore();
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(6), uses: int(0) } }, commitStatus: [409] });
  await assert.rejects(redeemCode(env(), UID, CODE));
  calls.restore();
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(6), uses: int(0) } }, commitStatus: [500] });
  await assert.rejects(redeemCode(env(), UID, CODE));
});

const req = (body, method = "POST") => new Request("https://w.example/redeem", { method, body: method === "POST" ? JSON.stringify(body) : undefined });

test("endpoint /redeem: respuestas HTTP", async () => {
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(1), uses: int(0) } } });
  const tok = "x".repeat(40);
  let r = await worker.fetch(req({ idToken: tok, code: CODE.toLowerCase() }), env());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, already: false });
  r = await worker.fetch(req({ idToken: tok, code: "basura/../" }), env());
  assert.equal(r.status, 400);
  r = await worker.fetch(req({}, "GET"), env());
  assert.equal(r.status, 405);
  r = await worker.fetch(req({ idToken: tok, code: "CAESAR-NOPE-NOPE-NOPE" }), env());
  assert.equal(r.status, 404);
  calls.restore();
  calls = mock({ docs: { [`codes/${CODE}`]: { max: int(1), uses: int(1) } } });
  r = await worker.fetch(req({ idToken: tok, code: CODE }), env());
  assert.equal(r.status, 410);
  calls.restore();
  calls = mock({ docs: {}, lookup: null });
  r = await worker.fetch(req({ idToken: tok, code: CODE }), env());
  assert.equal(r.status, 401); // token no válido
  assert.equal(calls.commits.length, 0);
});

const H = 3600 * 1000;
const D = 24 * H;

test("decideRate: 3 a la hora y 7 al día", () => {
  const now = 1_000_000_000_000;
  assert.equal(decideRate([], now).allowed, true);
  assert.equal(decideRate([now - 10 * 60000, now - 20 * 60000], now).allowed, true); // 2 en la última hora
  let d = decideRate([now - 50 * 60000, now - 20 * 60000, now - 10 * 60000], now); // 3 en la última hora
  assert.equal(d.allowed, false);
  assert.equal(d.retryAfter, 10 * 60); // el más antiguo sale de la ventana en 10 min
  // 3 intentos hace más de 1 h no bloquean por hora
  assert.equal(decideRate([now - 2 * H, now - 3 * H, now - 4 * H], now).allowed, true);
  // 7 en el día (ninguna racha de 3 en una hora): bloquea hasta que el más antiguo cumpla 24 h
  const seven = [1, 2, 3, 5, 7, 9, 11].map((h) => now - h * H - 5 * 60000);
  d = decideRate(seven, now);
  assert.equal(d.allowed, false);
  assert.equal(d.retryAfter, Math.ceil((now - 11 * H - 5 * 60000 + D - now) / 1000));
  // lo de hace más de 24 h se olvida
  assert.equal(decideRate([now - D - 1, now - D - 2, now - D - 3, now - D - 4, now - D - 5, now - D - 6, now - D - 7], now).allowed, true);
  assert.equal(decideRate("basura", now).allowed, true);
});

test("checkRateLimit: apunta el intento; bloqueado no escribe", async () => {
  const now = 1_000_000_000_000;
  const att = (...ts) => ({ attempts: { arrayValue: { values: ts.map(int) } } });
  calls = mock({ docs: { [`redeemLimits/${UID}`]: att(now - 5000, now - 4000) } });
  assert.deepEqual(await checkRateLimit(env(), UID, now), { allowed: true, retryAfter: 0 });
  assert.equal(calls.commits.length, 1);
  const w = calls.commits[0].writes[0];
  assert.equal(w.update.name, PRE + `redeemLimits/${UID}`);
  assert.equal(w.update.fields.expiresAt.integerValue, String(now + D)); // caduca 24 h después del último intento
  assert.deepEqual(w.updateMask.fieldPaths, ["attempts", "expiresAt"]);
  assert.deepEqual(w.update.fields.attempts.arrayValue.values.map((v) => v.integerValue), [String(now - 5000), String(now - 4000), String(now)]);
  calls.restore();
  calls = mock({ docs: { [`redeemLimits/${UID}`]: att(now - 5000, now - 4000, now - 3000) } });
  const r = await checkRateLimit(env(), UID, now);
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfter > 3500 && r.retryAfter <= 3600);
  assert.equal(calls.commits.length, 0);
  assert.equal(calls.rollbacks, 1);
  calls.restore();
  calls = mock({ docs: {} }); // primer intento: el documento no existe
  assert.equal((await checkRateLimit(env(), UID, now)).allowed, true);
});

test("endpoint /redeem: el 4.º intento en una hora da 429 con Retry-After y no llega a mirar el código", async () => {
  const store = {};
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return j({ access_token: "t", expires_in: 3600 });
    if (url.includes("accounts:lookup")) return j({ users: [{ localId: UID }] });
    if (url.endsWith(":beginTransaction")) return j({ transaction: "tx" });
    if (url.endsWith(":rollback")) return j({});
    if (url.endsWith(":commit")) {
      for (const w of JSON.parse(opts.body).writes) if (w.update.name.includes("redeemLimits")) store.lim = w.update.fields;
      return j({});
    }
    const m = decodeURIComponent(url).match(/documents\/([^?]+)\?transaction=/);
    if (m && m[1].startsWith("redeemLimits/")) return store.lim ? j({ fields: store.lim }) : j({}, 404);
    if (m && m[1].startsWith("codes/")) return j({}, 404); // el código no existe
    return j({}, 404);
  };
  calls = { restore: () => (globalThis.fetch = orig) };
  const tok = "x".repeat(40);
  const statuses = [];
  let last;
  for (let i = 0; i < 4; i++) {
    last = await worker.fetch(req({ idToken: tok, code: "CAESAR-NOPE-NOPE-NOPE" }), env());
    statuses.push(last.status);
  }
  assert.deepEqual(statuses, [404, 404, 404, 429]);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
  assert.equal((await last.json()).error, "rate_limited");
});

test("rateKey: depende de la IP (hash, no la IP en claro); sin IP cae al uid", async () => {
  const a = await rateKey("203.0.113.7", "u1");
  assert.equal(a, await rateKey("203.0.113.7", "otro-uid")); // mismo IP, distinto usuario → misma clave
  assert.notEqual(a, await rateKey("203.0.113.8", "u1"));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes("203"));
  assert.notEqual(await rateKey(null, "u1"), await rateKey(null, "u2"));
});

test("endpoint /redeem: el límite es por IP aunque cambie el usuario", async () => {
  const store = {};
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return j({ access_token: "t", expires_in: 3600 });
    if (url.includes("accounts:lookup")) return j({ users: [{ localId: JSON.parse(opts.body).idToken.slice(0, 12).padEnd(12, "a") }] });
    if (url.endsWith(":beginTransaction")) return j({ transaction: "tx" });
    if (url.endsWith(":rollback")) return j({});
    if (url.endsWith(":commit")) {
      for (const w of JSON.parse(opts.body).writes) if (w.update.name.includes("redeemLimits")) store[w.update.name] = w.update.fields;
      return j({});
    }
    const m = decodeURIComponent(url).match(/documents\/([^?]+)\?transaction=/);
    if (m && m[1].startsWith("redeemLimits/")) return store[PRE + m[1]] ? j({ fields: store[PRE + m[1]] }) : j({}, 404);
    return j({}, 404);
  };
  calls = { restore: () => (globalThis.fetch = orig) };
  const send = (tokPrefix, ip) =>
    worker.fetch(new Request("https://w.example/redeem", { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ idToken: tokPrefix.padEnd(40, "x"), code: "CAESAR-NOPE-NOPE-NOPE" }) }), env());
  const s = [];
  for (const [u, ip] of [["usuarioAAAAAA", "1.1.1.1"], ["usuarioBBBBBB", "1.1.1.1"], ["usuarioCCCCCC", "1.1.1.1"], ["usuarioDDDDDD", "1.1.1.1"]]) s.push((await send(u, ip)).status);
  assert.deepEqual(s, [404, 404, 404, 429]); // 4 usuarios distintos, misma IP → bloqueado
  assert.equal((await send("usuarioEEEEEE", "2.2.2.2")).status, 404); // otra IP → pasa
});

test("cleanupRateLimits: borra solo los caducados; DRY_RUN no borra", async () => {
  const now = 1_000_000_000_000;
  const orig = globalThis.fetch;
  const seen = { query: null, commit: null };
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return j({ access_token: "t", expires_in: 3600 });
    if (url.endsWith(":runQuery")) { seen.query = JSON.parse(opts.body); return j([{ document: { name: PRE + "redeemLimits/aaa" } }, { document: { name: PRE + "redeemLimits/bbb" } }, { readTime: "x" }]); }
    if (url.endsWith(":commit")) { seen.commit = JSON.parse(opts.body); return j({}); }
    throw new Error("url inesperada " + url);
  };
  calls = { restore: () => (globalThis.fetch = orig) };
  const f = seen.query;
  assert.deepEqual(await cleanupRateLimits({ ...env(), DRY_RUN: "1" }, now), { caducados: 2, borrados: 0 });
  assert.equal(seen.commit, null);
  assert.deepEqual(await cleanupRateLimits(env(), now), { caducados: 2, borrados: 2 });
  const q = seen.query.structuredQuery;
  assert.equal(q.from[0].collectionId, "redeemLimits");
  assert.equal(q.where.fieldFilter.field.fieldPath, "expiresAt");
  assert.equal(q.where.fieldFilter.op, "LESS_THAN");
  assert.equal(q.where.fieldFilter.value.integerValue, String(now));
  assert.deepEqual(seen.commit.writes, [{ delete: PRE + "redeemLimits/aaa" }, { delete: PRE + "redeemLimits/bbb" }]);
});
