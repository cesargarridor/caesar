import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { cleanupExpiredAccounts, isExpired, shouldDelete } from "./worker.js";

const NOW = Date.parse("2026-11-12T03:00:00Z");
const DAY = 86400000;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = (extra = {}) => ({
  FIREBASE_PROJECT: "p",
  FIREBASE_SA: JSON.stringify({ client_email: "sa@p.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
  ...extra,
});
const user = (id, ageDays) => ({ localId: id, email: `${id}@x.com`, createdAt: String(NOW - ageDays * DAY) });

/** docs: { "users/u1": {fields}, "users/u1/billing/status": {fields} | 500 }; pages: array de {users,nextPageToken}.
 *  onRead(n, uids): opcional, se llama antes de cada documents:batchGet (n = nº de lectura) para cambiar docs (carrera). */
function mock({ pages, docs = {}, onRead, failRead, deleteErrors = [] }) {
  const calls = { deleted: [], delBodies: [], batch: [], reads: 0, total: 0 };
  let origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.startsWith("https://oauth2.googleapis.com/token")) { calls.total++; return json({ access_token: "t", expires_in: 3600 }); }
    calls.total++;
    if (url.includes("accounts:batchGet")) {
      calls.batch.push(url);
      const tok = new URL(url).searchParams.get("nextPageToken");
      return json(pages[tok ? Number(tok) : 0]);
    }
    if (url.includes("accounts:batchDelete")) {
      const b = JSON.parse(opts.body);
      assert.equal(b.force, true);
      calls.delBodies.push(b);
      calls.deleted.push(...b.localIds.filter((id) => !deleteErrors.includes(id)));
      return json(deleteErrors.length ? { errors: deleteErrors.filter((id) => b.localIds.includes(id)).map((id) => ({ index: b.localIds.indexOf(id), localId: id, message: "x" })) } : {});
    }
    if (url.endsWith("documents:batchGet")) {
      calls.reads++;
      const names = JSON.parse(opts.body).documents;
      onRead?.(calls.reads, names);
      if (failRead?.(calls.reads)) return json({}, 503);
      const pre = "projects/p/databases/(default)/documents/";
      const out = [];
      for (const n of names) {
        const d = docs[n.slice(pre.length)];
        if (d === undefined) out.push({ missing: n });
        else if (typeof d === "number") return json({}, d);
        else out.push({ found: { name: n, fields: d } });
      }
      return json(out);
    }
    throw new Error("url inesperada " + url);
  };
  calls.restore = () => (globalThis.fetch = origFetch);
  return calls;
}
let calls;
beforeEach(() => calls?.restore());
const quiet = () => { console.log = console.warn = console.error = () => {}; };
quiet();

test("isExpired / shouldDelete puros", () => {
  assert.equal(isExpired(NOW - 8 * DAY, NOW), true);
  assert.equal(isExpired(NOW - 6 * DAY, NOW), false);
  assert.equal(isExpired("garbage", NOW), false);
  assert.equal(shouldDelete({ createdAtMs: NOW - 8 * DAY, isWhitelistMember: false, billingActive: false }, NOW), true);
  assert.equal(shouldDelete({ createdAtMs: NOW - 8 * DAY, isWhitelistMember: true, billingActive: false }, NOW), false);
  assert.equal(shouldDelete({ createdAtMs: NOW - 8 * DAY, isWhitelistMember: false, billingActive: true }, NOW), false);
});

test("borra caducado sin whitelist ni billing", async () => {
  calls = mock({ pages: [{ users: [user("old", 10)] }] });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(calls.deleted, ["old"]);
  assert.deepEqual(s, { revisados: 1, exentos: 0, borrados: 1, errores: 0 });
});

test("exento por whitelist", async () => {
  calls = mock({ pages: [{ users: [user("w", 30)] }], docs: { "users/w": { isWhitelistMember: { booleanValue: true } } } });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(calls.deleted, []);
  assert.equal(s.exentos, 1);
});

test("exento por billing activo (active y status)", async () => {
  calls = mock({
    pages: [{ users: [user("b", 30), user("c", 30)] }],
    docs: { "users/b/billing/status": { active: { booleanValue: true } }, "users/c/billing/status": { status: { stringValue: "active" } } },
  });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(calls.deleted, []);
  assert.equal(s.exentos, 2);
});

test("no borra menores de 7 días", async () => {
  calls = mock({ pages: [{ users: [user("new", 6)] }] });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(calls.deleted, []);
  assert.equal(s.borrados, 0);
});

test("no borra ante error 5xx/403 de lectura en lote", async () => {
  calls = mock({ pages: [{ users: [user("e1", 30), user("e2", 30)] }], docs: { "users/e1/billing/status": 500 } });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(calls.deleted, []);
  assert.equal(s.errores, 2);
  assert.equal(calls.delBodies.length, 0);
});

test("fallo de lectura de un trozo no impide borrar otros trozos", async () => {
  const us = Array.from({ length: 150 }, (_, i) => user(`u${i}`, 10)); // 2 trozos de lectura (100 + 50)
  calls = mock({ pages: [{ users: us }], failRead: (n) => n === 1 });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.equal(s.errores, 100);
  assert.equal(calls.deleted.length, 50);
  assert.ok(!calls.deleted.includes("u0"));
});

test("lote de 250 candidatos se borra en pocas llamadas", async () => {
  const us = Array.from({ length: 250 }, (_, i) => user(`u${i}`, 10));
  calls = mock({ pages: [{ users: us }] });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(s, { revisados: 250, exentos: 0, borrados: 250, errores: 0 });
  assert.equal(calls.deleted.length, 250);
  // token + 1 listado + 3 lecturas + 3 relecturas + 1 borrado
  assert.ok(calls.total <= 10, `llamadas: ${calls.total}`);
});

test("presupuesto de subrequests respeta el límite y reporta restantes", async () => {
  const us = Array.from({ length: 1500 }, (_, i) => user(`u${i}`, 10));
  calls = mock({ pages: [{ users: us }] });
  const s = await cleanupExpiredAccounts(env({ MAX_SUBREQUESTS: "12" }), NOW);
  assert.ok(calls.total <= 12, `llamadas: ${calls.total}`);
  assert.ok(s.restantes > 0);
  assert.equal(s.borrados + s.restantes + s.errores + s.exentos, 1500);
  assert.equal(calls.deleted.length, s.borrados);
});

test("sin MAX_SUBREQUESTS el límite por defecto es 45", async () => {
  const us = Array.from({ length: 5000 }, (_, i) => user(`u${i}`, 10));
  calls = mock({ pages: [{ users: us }] });
  const s = await cleanupExpiredAccounts(env({ MAX_DELETES: "5000" }), NOW);
  assert.ok(calls.total <= 45, `llamadas: ${calls.total}`);
  assert.ok(s.borrados >= 1000);
});

test("carrera: billing activo en la relectura NO borra", async () => {
  const docs = {};
  calls = mock({
    pages: [{ users: [user("late", 10), user("plain", 10)] }],
    docs,
    onRead: (n) => { if (n === 2) docs["users/late/billing/status"] = { active: { booleanValue: true } }; },
  });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(calls.deleted, ["plain"]);
  assert.equal(s.exentos, 1);
  assert.equal(s.borrados, 1);
});

test("errores[] de batchDelete se cuentan por uid", async () => {
  calls = mock({ pages: [{ users: [user("a", 10), user("b", 10)] }], deleteErrors: ["b"] });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.deepEqual(calls.deleted, ["a"]);
  assert.equal(s.borrados, 1);
  assert.equal(s.errores, 1);
});

test("webhook: método, tamaño y firma antes de Firebase", async () => {
  const worker = (await import("./worker.js")).default;
  calls = mock({ pages: [] });
  const e = env({ LS_WEBHOOK_SECRET: "s" });
  assert.equal((await worker.fetch(new Request("https://w/", { method: "PUT", body: "x" }), e)).status, 405);
  assert.equal((await worker.fetch(new Request("https://w/", { method: "GET" }), e)).status, 200);
  const big = "a".repeat(100 * 1024 + 1);
  assert.equal((await worker.fetch(new Request("https://w/", { method: "POST", body: big }), e)).status, 413);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  assert.equal((await worker.fetch(new Request("https://w/", { method: "POST", body: stream, duplex: "half" }), e)).status, 413);
  assert.equal((await worker.fetch(new Request("https://w/", { method: "POST", body: "{}", headers: { "X-Signature": "00" } }), e)).status, 401);
  assert.equal(calls.total, 0);
});

test("paginación", async () => {
  calls = mock({ pages: [{ users: [user("a", 10)], nextPageToken: "1" }, { users: [user("b", 10)] }] });
  const s = await cleanupExpiredAccounts(env(), NOW);
  assert.equal(calls.batch.length, 2);
  assert.deepEqual(calls.deleted, ["a", "b"]);
  assert.equal(s.revisados, 2);
});

test("DRY_RUN no borra", async () => {
  calls = mock({ pages: [{ users: [user("old", 10)] }] });
  const s = await cleanupExpiredAccounts(env({ DRY_RUN: "1" }), NOW);
  assert.deepEqual(calls.deleted, []);
  assert.equal(s.borrados, 1);
});

test("límite MAX_DELETES", async () => {
  calls = mock({ pages: [{ users: [user("a", 10), user("b", 10), user("c", 10)] }] });
  const s = await cleanupExpiredAccounts(env({ MAX_DELETES: "2" }), NOW);
  assert.deepEqual(calls.deleted, ["a", "b"]);
  assert.equal(s.borrados, 2);
  assert.equal(s.restantes, 1);
});
