// node --experimental-strip-types --test src/lib/vars.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normVars, parsePostmanEnv, mergeGlobals, uniqueProfileName, profileFromEnv, collectNestedVars, foldNestedVars, importSummary, filterVarIdx, resolveVars } from "./vars.ts";

test("entorno de Postman -> perfil con secret", () => {
  const env = parsePostmanEnv({ name: "Dev", _postman_variable_scope: "environment", values: [
    { key: "host", value: "x", enabled: true, type: "default" },
    { key: "tok", value: "s", enabled: false, type: "secret" },
    { key: "", value: "no" },
  ] });
  assert.equal(env.kind, "environment");
  assert.deepEqual(env.vars, [{ key: "host", value: "x", enabled: true }, { key: "tok", value: "s", enabled: false, secret: true }]);
  const p = profileFromEnv(env, [{ id: "a", name: "dev", vars: [] }], "id1");
  assert.equal(p.name, "Dev (2)");
  assert.equal(p.id, "id1");
});

test("globals de Postman", () => {
  assert.equal(parsePostmanEnv({ name: "x", _postman_variable_scope: "globals", values: [] }).kind, "globals");
  assert.equal(parsePostmanEnv({ name: "Globals", values: [{ key: "a", value: "1" }] }).kind, "globals");
  assert.equal(parsePostmanEnv({ info: {}, item: [] }), null);
  assert.equal(parsePostmanEnv({ values: [] }), null);
});

test("fusión de globales actualiza y no borra", () => {
  const r = mergeGlobals([{ key: "a", value: "1", enabled: true, secret: true }, { key: "b", value: "2", enabled: true }], [{ key: "a", value: "9", enabled: true }, { key: "c", value: "3", enabled: true }]);
  assert.deepEqual(r.vars, [{ key: "a", value: "9", enabled: true }, { key: "b", value: "2", enabled: true }, { key: "c", value: "3", enabled: true }]);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
});

test("nombre único de perfil", () => {
  assert.equal(uniqueProfileName("Prod", []), "Prod");
  assert.equal(uniqueProfileName("Prod", ["Prod", "Prod (2)"]), "Prod (3)");
  assert.equal(uniqueProfileName("  ", []), "Perfil");
});

test("migración de KV: secret opcional", () => {
  assert.deepEqual(normVars([{ key: "a", value: "1", enabled: true }, { key: "b", value: 2, secret: true }, null, { key: "c", secret: "x" }]), [
    { key: "a", value: "1", enabled: true },
    { key: "b", value: "2", enabled: true, secret: true },
    { key: "c", value: "", enabled: true },
  ]);
  assert.deepEqual(normVars(undefined), []);
});

test("variables anidadas de colección v2.1 sin pisar", () => {
  const nested = collectNestedVars({ item: [{ variable: [{ key: "f", value: "1" }, { key: "dup", value: "n" }], item: [{ variable: [{ key: "r", value: "2", disabled: true }] }] }, { name: "req", variable: [{ key: "f", value: "otro" }] }] });
  assert.deepEqual(nested.map((v) => v.key), ["f", "dup", "r", "f"]);
  const out = foldNestedVars([{ key: "dup", value: "root", enabled: true }], nested);
  assert.deepEqual(out.map((v) => [v.key, v.value]), [["dup", "root"], ["f", "1"], ["r", "2"]]);
  assert.equal(out[2].enabled, false);
});

test("resumen de importación", () => {
  assert.equal(importSummary({ collections: 1, profiles: 2, globals: 5 }), "Importado: 1 colección, 2 perfiles, 5 variables globales");
  assert.equal(importSummary({ collections: 0, profiles: 1, globals: 1 }), "Importado: 1 perfil, 1 variable global");
  assert.equal(importSummary({ collections: 0, profiles: 0, globals: 0 }), "No se importó nada");
});

test("filtro y resolución por ámbito", () => {
  const rows = [{ key: "Host", value: "a", enabled: true }, { key: "tok", value: "zzz", enabled: true, secret: true }];
  assert.deepEqual(filterVarIdx(rows, "host"), [0]);
  assert.deepEqual(filterVarIdx(rows, "zzz"), []);
  const r = resolveVars([{ key: "a", value: "g", enabled: true }], [{ key: "a", value: "c", enabled: true }], [{ key: "a", value: "p", enabled: true }, { key: "off", value: "1", enabled: false }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].scope, "profile");
  assert.deepEqual(r[0].shadowed, ["global", "collection"]);
});
