import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWsUrl, parseSubprotocols, hexToBytes, bytesToHex, hexDump, bytesToBase64, base64ToBytes, textToBytes,
  encodeOutgoing, pushMsg, filterMsgs, prettyJson, fmtTime, fmtSize, normWsConfig, defaultWsConfig, isWsUrl, MAX_MESSAGES,
} from "./ws.ts";

const m = (id, dir, type, data, size = data.length) => ({ id, ts: 0, dir, type, data, size });

test("normalizeWsUrl", () => {
  assert.equal(normalizeWsUrl(" https://a.com/x "), "wss://a.com/x");
  assert.equal(normalizeWsUrl("http://a.com"), "ws://a.com");
  assert.equal(normalizeWsUrl("WSS://a.com"), "wss://a.com");
  assert.equal(normalizeWsUrl("localhost:8080/ws"), "ws://localhost:8080/ws");
  assert.equal(normalizeWsUrl("{{base}}/ws"), "ws://{{base}}/ws");
  assert.equal(normalizeWsUrl(""), "");
  assert.ok(isWsUrl("ws://x") && !isWsUrl("http://x"));
});

test("parseSubprotocols", () => {
  assert.deepEqual(parseSubprotocols("chat, v2.json ,chat,"), { list: ["chat", "v2.json"], invalid: [] });
  assert.deepEqual(parseSubprotocols("ok, ba d").invalid, ["ba d"]);
});

test("hex y base64", () => {
  assert.deepEqual([...hexToBytes("48 65 6c 6c 6f")], [72, 101, 108, 108, 111]);
  assert.deepEqual([...hexToBytes("0x48,0x65")], [72, 101]);
  assert.deepEqual([...hexToBytes("4865")], [72, 101]);
  assert.throws(() => hexToBytes("4"));
  assert.throws(() => hexToBytes("zz"));
  assert.equal(bytesToHex(textToBytes("Hi")), "48 69");
  assert.equal(bytesToBase64(textToBytes("hola")), "aG9sYQ==");
  assert.equal(new TextDecoder().decode(base64ToBytes("aG9sYQ==")), "hola");
  const big = new Uint8Array(100000).fill(65);
  assert.equal(base64ToBytes(bytesToBase64(big)).length, 100000);
});

test("hexDump", () => {
  const d = hexDump(textToBytes("Hello, World!!\n\x00A"));
  const lines = d.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^00000000  48 65 6c 6c 6f 2c 20 57 6f 72 6c 64 21 21 0a 00  \|Hello, World!!\.\.\|$/);
  assert.match(lines[1], /^00000010  41 +\|A\|$/);
});

test("encodeOutgoing", () => {
  assert.deepEqual(encodeOutgoing("text", "hé"), { kind: "text", data: "hé", size: 3 });
  assert.equal(encodeOutgoing("json", '{"a":1}').kind, "text");
  assert.throws(() => encodeOutgoing("json", "{a"), /JSON/);
  assert.deepEqual(encodeOutgoing("hex", "48 69"), { kind: "binary", data: "SGk=", size: 2 });
  assert.deepEqual(encodeOutgoing("base64", "SGk="), { kind: "binary", data: "SGk=", size: 2 });
  assert.throws(() => encodeOutgoing("hex", "xyz"));
  assert.throws(() => encodeOutgoing("base64", "***"));
});

test("pushMsg respeta el límite y no muta", () => {
  let l = [];
  for (let i = 0; i < MAX_MESSAGES + 10; i++) l = pushMsg(l, m(i, "sent", "text", "x"));
  assert.equal(l.length, MAX_MESSAGES);
  assert.equal(l[0].id, 10);
  const a = [m(1, "sent", "text", "a")];
  const b = pushMsg(a, m(2, "sent", "text", "b"), 5);
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
  assert.equal(pushMsg(b, m(3, "sent", "text", "c"), 2).map((x) => x.id).join(), "2,3");
});

test("filterMsgs", () => {
  const l = [
    m(1, "event", "open", "Conectado a ws://x"),
    m(2, "sent", "text", "Hola"),
    m(3, "received", "text", "eco: hola"),
    m(4, "received", "binary", bytesToBase64(textToBytes("Secret")), 6),
  ];
  assert.equal(filterMsgs(l, "all", "").length, 4);
  assert.equal(filterMsgs(l, "sent", "").length, 1);
  assert.equal(filterMsgs(l, "received", "").length, 2);
  assert.deepEqual(filterMsgs(l, "all", "HOLA").map((x) => x.id), [2, 3]);
  assert.deepEqual(filterMsgs(l, "all", "secret").map((x) => x.id), [4]);
  assert.deepEqual(filterMsgs(l, "all", "53 65").map((x) => x.id), [4]);
  assert.deepEqual(filterMsgs(l, "all", "conectado").map((x) => x.id), [1]);
});

test("prettyJson, fmtTime, fmtSize", () => {
  assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyJson("hola"), null);
  assert.equal(prettyJson("{roto"), null);
  assert.match(fmtTime(Date.now()), /^\d\d:\d\d:\d\d\.\d{3}$/);
  assert.equal(fmtSize(10), "10 B");
  assert.equal(fmtSize(2048), "2.0 KB");
});

test("normWsConfig", () => {
  assert.deepEqual(normWsConfig(undefined), defaultWsConfig());
  const c = normWsConfig({ handshakeTimeoutSecs: 9999, reconnectAttempts: -3, draftFormat: "zzz", saved: [{ name: "a", data: "b", format: "json" }, { bad: 1 }] });
  assert.equal(c.handshakeTimeoutSecs, 120);
  assert.equal(c.reconnectAttempts, 1);
  assert.equal(c.draftFormat, "text");
  assert.equal(c.saved.length, 1);
  assert.equal(c.saved[0].format, "json");
});
