import { test } from "node:test";
import assert from "node:assert/strict";
import { pathOfLine } from "./jsonCopy.ts";

const doc = JSON.stringify({ data: { users: [{ id: 1, "mi clave": true }, { id: 2 }, { id: 3, tags: ["a", "b"] }] }, ok: null }, null, 2).split("\n");
const at = (needle, nth = 0) => doc.map((l, i) => [l, i]).filter(([l]) => l.includes(needle))[nth][1];

test("rutas de nodos anidados", () => {
  assert.equal(pathOfLine(doc, 0), "$");
  assert.equal(pathOfLine(doc, at('"data"')), "data");
  assert.equal(pathOfLine(doc, at('"users"')), "data.users");
  assert.equal(pathOfLine(doc, at('"id": 3')), "data.users[2].id");
  assert.equal(pathOfLine(doc, at('"mi clave"')), 'data.users[0]["mi clave"]');
  assert.equal(pathOfLine(doc, at('"b"')), "data.users[2].tags[1]");
  assert.equal(pathOfLine(doc, at('"ok"')), "ok");
});

test("la línea de cierre apunta a su contenedor", () => {
  assert.equal(pathOfLine(doc, doc.length - 1), "$");
});
