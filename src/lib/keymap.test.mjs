// node --experimental-strip-types --test src/lib/keymap.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS, comboFromEvent, normalizeCombo, isValidCombo, getCombos, commandFor, assignCombo, removeCombo, resetCommand, resetAll,
  saveAction, deleteAction, stepsOf, toggleToolbar, getToolbar, allCommands, _resetForTests,
} from "./keymap.ts";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
beforeEach(() => { store.clear(); _resetForTests(); });

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test("comboFromEvent normaliza", () => {
  assert.equal(comboFromEvent(ev("f", { ctrlKey: true })), "Ctrl+F");
  assert.equal(comboFromEvent(ev("F", { metaKey: true, shiftKey: true })), "Ctrl+Shift+F");
  assert.equal(comboFromEvent(ev("Tab", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+Tab");
  assert.equal(comboFromEvent(ev(" ", { ctrlKey: true })), "Ctrl+Space");
  assert.equal(comboFromEvent(ev("/", { ctrlKey: true, shiftKey: true })), "Ctrl+/"); // símbolo: Mayús ya va en la tecla
  assert.equal(comboFromEvent(ev("ArrowLeft", { altKey: true })), "Alt+ArrowLeft");
  assert.equal(comboFromEvent(ev("Control", { ctrlKey: true })), null);
  assert.equal(comboFromEvent(ev("@", { ctrlKey: true, altKey: true, altGr: true })), null);
});

test("normalizeCombo / isValidCombo", () => {
  assert.equal(normalizeCombo("ctrl + shift + f"), "Ctrl+Shift+F");
  assert.equal(normalizeCombo("cmd+k"), "Ctrl+K");
  assert.equal(isValidCombo("F5"), true);
  assert.equal(isValidCombo("Ctrl+K"), true);
  assert.equal(isValidCombo("Alt+X"), true);
  assert.equal(isValidCombo("K"), false); // sin modificador rompería la escritura
  assert.equal(isValidCombo("Shift+K"), false);
});

test("por defecto: los atajos de siempre", () => {
  assert.deepEqual(getCombos("save"), ["Ctrl+S"]);
  assert.equal(commandFor("Ctrl+Enter"), "send");
  assert.equal(commandFor("Ctrl+PageUp"), "prevTab");
  assert.equal(commandFor("Ctrl+9"), "gotoTab9");
  assert.equal(commandFor("Ctrl+Q"), null);
  const all = COMMANDS.flatMap((c) => c.defaults);
  assert.equal(new Set(all).size, all.length); // sin duplicados entre comandos
});

test("Ctrl+F para cerrar pestañas: se lo quita a Buscar", () => {
  const r = assignCombo("closeTab", "ctrl+f");
  assert.deepEqual(r, { ok: true, displaced: "find" });
  assert.equal(commandFor("Ctrl+F"), "closeTab");
  assert.deepEqual(getCombos("find"), []);
  assert.deepEqual(getCombos("closeTab"), ["Ctrl+W", "Ctrl+F"]); // se suma; quitar Ctrl+W es opcional
  removeCombo("closeTab", "Ctrl+W");
  assert.deepEqual(getCombos("closeTab"), ["Ctrl+F"]);
  assert.equal(commandFor("Ctrl+W"), null);
});

test("rechaza combinaciones sin modificador; reset", () => {
  assert.deepEqual(assignCombo("save", "K"), { ok: false, displaced: null, reason: "invalid" });
  assignCombo("save", "Ctrl+Alt+S");
  resetCommand("save");
  assert.deepEqual(getCombos("save"), ["Ctrl+S"]);
  assignCombo("save", "Ctrl+Q");
  assignCombo("send", "Ctrl+Y");
  resetAll();
  assert.deepEqual(getCombos("save"), ["Ctrl+S"]);
  assert.deepEqual(getCombos("send"), ["Ctrl+Enter"]);
});

test("acciones propias, atajo y botón", () => {
  const id = saveAction({ name: "Guardar y enviar", steps: ["save", "send", "noexiste"] });
  assert.ok(id.startsWith("user:"));
  assert.ok(allCommands().some((c) => c.id === id && c.user));
  assignCombo(id, "Ctrl+Shift+E");
  assert.equal(commandFor("Ctrl+Shift+E"), id);
  assert.deepEqual(stepsOf(id), ["save", "send"]); // los comandos desconocidos se descartan
  toggleToolbar(id);
  toggleToolbar("copyCurl");
  assert.deepEqual(getToolbar(), [id, "copyCurl"]);
  toggleToolbar("copyCurl");
  assert.deepEqual(getToolbar(), [id]);
  deleteAction(id);
  assert.equal(commandFor("Ctrl+Shift+E"), null);
  assert.deepEqual(getToolbar(), []);
});

test("persistencia y datos corruptos", () => {
  assignCombo("find", "Ctrl+Shift+F");
  _resetForTests(); // simula reiniciar la app
  assert.deepEqual(getCombos("find"), ["Ctrl+F", "Ctrl+Shift+F"]);
  store.set("caesar.keymap", "{basura");
  _resetForTests();
  assert.deepEqual(getCombos("find"), ["Ctrl+F"]);
  store.set("caesar.keymap", JSON.stringify({ overrides: { save: ["K", "ctrl+j"], x: 5 }, actions: "no", toolbar: ["save", "nada"] }));
  _resetForTests();
  assert.deepEqual(getCombos("save"), ["Ctrl+J"]);
  assert.deepEqual(getToolbar(), ["save"]);
});
