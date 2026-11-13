import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import worker, { decideRedeem, normalizeCode, redeemCode, shouldDelete } from "./worker.js";

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
