// node --experimental-strip-types --test src/lib/importWarn.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isInternalHostname, urlIsLocal, countLocalRequests } from "./importWarn.ts";

test("hosts internos y públicos", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.0.1", "192.168.0.5", "169.254.169.254", "100.64.0.1", "100.127.1.1", "[::1]", "[fd00::1]", "[fe80::1]", "impresora.local", "nas", "[::ffff:10.0.0.1]"])
    assert.equal(isInternalHostname(h), true, h);
  for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "192.169.1.1", "[2001:db8::1]", "api.localhost.example.com"])
    assert.equal(isInternalHostname(h), false, h);
});

test("urlIsLocal resuelve variables", () => {
  const vars = [{ key: "baseUrl", value: "http://localhost:3000", enabled: true }];
  assert.equal(urlIsLocal("{{baseUrl}}/x", vars), true);
  assert.equal(urlIsLocal("{{baseUrl}}/x", []), false);
  assert.equal(urlIsLocal("https://example.com/x"), false);
});

test("countLocalRequests cuenta peticiones locales", () => {
  const r = (url) => ({ type: "request", name: "r", method: "GET", url, headers: [], body: { mode: "none" }, auth: {} });
  const root = { type: "folder", name: "c", children: [r("{{baseUrl}}/a"), r("https://example.com"), { type: "folder", name: "f", children: [r("http://192.168.1.2/z")] }], variables: [{ key: "baseUrl", value: "http://127.0.0.1:8080", enabled: true }] };
  assert.equal(countLocalRequests(root), 2);
});
