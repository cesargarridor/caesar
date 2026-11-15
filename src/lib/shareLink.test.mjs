// node --experimental-strip-types --test src/lib/shareLink.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeShareLink, parseShareLink, looksLikeShareLink } from "./shareLink.ts";

const req = {
  method: "POST", url: "https://api.x.com/items", params: [{ key: "a", value: "1", enabled: true }],
  headers: [{ key: "Authorization", value: "Bearer SECRETO", enabled: true }, { key: "X-Id", value: "7", enabled: true }],
  auth: { type: "none" }, settings: {}, tests: "pm.test()",
  body: { mode: "json", raw: JSON.stringify({ nombre: "Ana", lista: Array.from({ length: 50 }, (_, i) => ({ i })) }), formdata: [], urlencoded: [] },
};

test("ida y vuelta, sin secretos y comprimido", async () => {
  const { link, hidden } = await makeShareLink(req);
  assert.ok(looksLikeShareLink(link) && link.length < 600 && hidden === 1);
  assert.ok(!link.includes("SECRETO"));
  const back = await parseShareLink(link);
  assert.equal(back.method, "POST");
  assert.equal(back.url, "https://api.x.com/items");
  assert.equal(back.params[0].key, "a");
  assert.equal(back.headers.find((h) => h.key === "Authorization").value, "");
  assert.equal(back.headers.find((h) => h.key === "X-Id").value, "7");
  assert.equal(JSON.parse(back.body.raw).nombre, "Ana");
  assert.equal(back.tests ?? "", ""); // los scripts no viajan
});

test("enlaces malos dan error claro, no excepciones raras", async () => {
  await assert.rejects(parseShareLink("hola"), /No es un enlace/);
  await assert.rejects(parseShareLink("caesar://share?payload="), /vacío/);
  await assert.rejects(parseShareLink("caesar://share?payload=!!!"), /dañado/);
  await assert.rejects(parseShareLink("caesar://share?payload=z.AAAA"), /dañado/);
  const json = (o) => "caesar://share?payload=" + Buffer.from(JSON.stringify(o)).toString("base64url");
  await assert.rejects(parseShareLink(json({ v: 9, u: "x" })), /versión/);
  const r = await parseShareLink(json({ v: 1, u: "http://a/b", m: "<script>", b: { mode: "otro" }, h: [["a", 5], 7] }));
  assert.equal(r.method, "GET");
  assert.equal(r.body.mode, "none");
});
