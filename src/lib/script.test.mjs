// node --experimental-strip-types --test src/lib/script.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runScript } from "./script.ts";

const ctx = () => ({ body: "{}", status: 200, statusText: "OK", timeMs: 1, headers: [], vars: new Map() });

test("recursión infinita -> error controlado", () => {
  const r = runScript("function f(){ return f(); }\nf();", ctx());
  assert.ok(r.errors.some((e) => e.includes("Recursión demasiado profunda")), r.errors.join("|"));
});

test("padStart enorme -> error", () => {
  const r = runScript('const s = "a".padStart(2000000, "x");', ctx());
  assert.ok(r.errors.length > 0);
});

test("padStart normal funciona", () => {
  const r = runScript('pm.variables.set("k", "7".padStart(3, "0"));', ctx());
  assert.deepEqual(r.errors, []);
  assert.equal(r.sets[0].value, "007");
});
