import test from "node:test";
import assert from "node:assert/strict";
import { idsToClose, dirtyIds, activeAfterClose } from "./tabs.ts";

const tabs = [{ id: "a" }, { id: "b", dirty: true }, { id: "c" }, { id: "d", dirty: true }];

test("idsToClose", () => {
  assert.deepEqual(idsToClose(tabs, "b", "one"), ["b"]);
  assert.deepEqual(idsToClose(tabs, "b", "others"), ["a", "c", "d"]);
  assert.deepEqual(idsToClose(tabs, "b", "right"), ["c", "d"]);
  assert.deepEqual(idsToClose(tabs, "d", "right"), []);
  assert.deepEqual(idsToClose(tabs, null, "all"), ["a", "b", "c", "d"]);
  assert.deepEqual(idsToClose(tabs, "zz", "one"), []);
  assert.deepEqual(idsToClose([], null, "all"), []);
});

test("dirtyIds", () => {
  assert.deepEqual(dirtyIds(tabs, ["a", "b", "c", "d"]), ["b", "d"]);
  assert.deepEqual(dirtyIds(tabs, ["a", "c"]), []);
});

test("activeAfterClose", () => {
  assert.equal(activeAfterClose(tabs, ["a", "b", "c", "d"], "b"), null);
  assert.equal(activeAfterClose(tabs, ["a"], "b"), "b");
  assert.equal(activeAfterClose(tabs, ["b"], "b"), "c");
  assert.equal(activeAfterClose(tabs, ["c", "d"], "d"), "b");
  assert.equal(activeAfterClose(tabs, ["a", "c", "d"], "c"), "b");
  assert.equal(activeAfterClose([], [], null), null);
});
