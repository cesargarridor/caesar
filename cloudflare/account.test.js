import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import worker, { closeAccount, recordTerms, subscriptionToCancel } from "./worker.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = (extra = {}) => ({
  FIREBASE_PROJECT: "p",
  FIREBASE_API_KEY: "key",
  FIREBASE_SA: JSON.stringify({ client_email: "sa@p.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
  ...extra,
});
const UID = "Ty4SnLdeIlMD6v5ZOtLjW21RMJa2";
const str = (s) => ({ stringValue: s });

/** billing: fields de billing/status (o null = 404). lsStatus: estado HTTP de la API de Lemon Squeezy. */
function mock({ billing = null, lsStatus = 200, consentStatus = 200, patchStatus = 200 } = {}) {
  const calls = { ls: [], patches: [], deletes: [] };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return j({ access_token: "t", expires_in: 3600 });
    if (url.includes("accounts:lookup")) return j({ users: [{ localId: UID }] });
    if (url.startsWith("https://api.lemonsqueezy.com/")) { calls.ls.push({ url, method: opts.method, auth: opts.headers.authorization }); return j({}, lsStatus); }
    if (url.endsWith("/billing/status") && (opts.method || "GET") === "GET") return billing ? j({ fields: billing }) : j({}, 404);
    if (url.includes("/consent/terms") && opts.method === "DELETE") { calls.deletes.push(url); return j({}, consentStatus); }
    if (url.includes("/consent/terms") && opts.method === "PATCH") { calls.patches.push({ url, body: JSON.parse(opts.body) }); return j({}, patchStatus); }
    throw new Error("url inesperada " + url);
  };
  calls.restore = () => (globalThis.fetch = orig);
  return calls;
}

test("subscriptionToCancel: solo estados vivos con id numérico", () => {
  assert.equal(subscriptionToCancel({ subscriptionId: str("123"), status: str("active") }), "123");
  assert.equal(subscriptionToCancel({ subscriptionId: str("123"), status: str("on_trial") }), "123");
  assert.equal(subscriptionToCancel({ subscriptionId: str("123"), status: str("cancelled") }), null);
  assert.equal(subscriptionToCancel({ subscriptionId: str("123"), status: str("expired") }), null);
  assert.equal(subscriptionToCancel({ subscriptionId: str("../x"), status: str("active") }), null);
  assert.equal(subscriptionToCancel(null), null);
});

test("cierre: cancela en Lemon Squeezy y borra el registro de aceptación", async () => {
  const c = mock({ billing: { subscriptionId: str("42"), status: str("active") } });
  try {
    const r = await closeAccount(env({ LS_API_KEY: "k" }), UID);
    assert.deepEqual(r, { status: "ok", cancelled: true });
    assert.equal(c.ls.length, 1);
    assert.equal(c.ls[0].method, "DELETE");
    assert.equal(c.ls[0].url, "https://api.lemonsqueezy.com/v1/subscriptions/42");
    assert.equal(c.ls[0].auth, "Bearer k");
    assert.equal(c.deletes.length, 1);
  } finally { c.restore(); }
});

test("cierre sin suscripción: no llama a Lemon Squeezy aunque falte la clave", async () => {
  const c = mock({ billing: null });
  try {
    assert.deepEqual(await closeAccount(env(), UID), { status: "ok", cancelled: false });
    assert.equal(c.ls.length, 0);
    assert.equal(c.deletes.length, 1);
  } finally { c.restore(); }
});

test("cierre con suscripción activa y sin LS_API_KEY: no_key y no borra nada", async () => {
  const c = mock({ billing: { subscriptionId: str("42"), status: str("active") } });
  try {
    assert.deepEqual(await closeAccount(env(), UID), { status: "no_key" });
    assert.equal(c.deletes.length, 0);
  } finally { c.restore(); }
});

test("cierre: si Lemon Squeezy falla → ls_error; 404 se da por cancelada", async () => {
  let c = mock({ billing: { subscriptionId: str("42"), status: str("active") }, lsStatus: 500 });
  try { assert.deepEqual(await closeAccount(env({ LS_API_KEY: "k" }), UID), { status: "ls_error" }); } finally { c.restore(); }
  c = mock({ billing: { subscriptionId: str("42"), status: str("active") }, lsStatus: 404 });
  try { assert.deepEqual(await closeAccount(env({ LS_API_KEY: "k" }), UID), { status: "ok", cancelled: false }); } finally { c.restore(); }
});

test("recordTerms: escribe versión, fecha y age14; rechaza versiones raras", async () => {
  const c = mock();
  try {
    assert.deepEqual(await recordTerms(env(), UID, "2026-11-13", 1000), { status: "ok" });
    const f = c.patches[0].body.fields;
    assert.equal(f.version.stringValue, "2026-11-13");
    assert.equal(f.acceptedAt.integerValue, "1000");
    assert.equal(f.age14.booleanValue, true);
    assert.deepEqual(await recordTerms(env(), UID, "hola"), { status: "invalid" });
    assert.equal(c.patches.length, 1);
  } finally { c.restore(); }
});

test("rutas HTTP: /account/terms y /account/close", async () => {
  const c = mock({ billing: { subscriptionId: str("42"), status: str("active") } });
  const post = (path, body) => worker.fetch(new Request("https://w.example" + path, { method: "POST", body: JSON.stringify(body) }), env({ LS_API_KEY: "k" }));
  try {
    assert.equal((await post("/account/terms", { idToken: "x".repeat(30), version: "2026-11-13" })).status, 200);
    assert.equal((await post("/account/terms", { idToken: "x".repeat(30), version: "nope" })).status, 400);
    assert.equal((await post("/account/terms", { idToken: "corto", version: "2026-11-13" })).status, 401);
    const r = await post("/account/close", { idToken: "x".repeat(30) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, cancelled: true });
    assert.equal((await worker.fetch(new Request("https://w.example/account/close"), env())).status, 405);
  } finally { c.restore(); }
});
