import assert from "node:assert/strict";
import test from "node:test";
import { createSafeStorage } from "./storage.js";

test("safe storage swallows disabled-storage exceptions", () => {
  const broken = {
    getItem() { throw new Error("disabled"); },
    setItem() { throw new Error("disabled"); },
    removeItem() { throw new Error("disabled"); },
  };
  const storage = createSafeStorage(broken);
  assert.equal(storage.getItem("x"), null);
  assert.equal(storage.setItem("x", "y"), false);
  assert.equal(storage.removeItem("x"), false);
});
