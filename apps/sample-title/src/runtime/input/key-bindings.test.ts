import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_KEY_BINDINGS, resolveKeyBindings } from "./key-bindings.ts";

test("resolves the default bindings with one action per physical key", () => {
  const actionsByKey = resolveKeyBindings(DEFAULT_KEY_BINDINGS);

  assert.deepEqual(Object.fromEntries(actionsByKey), {
    ArrowLeft: "moveLeft",
    ArrowRight: "moveRight",
    ArrowUp: "moveUp",
    ArrowDown: "moveDown",
    KeyZ: "shot",
    ShiftLeft: "focus",
    ShiftRight: "focus",
    Escape: "pause",
    KeyP: "pause",
  });
});

test("rejects a physical key bound to more than one action", () => {
  assert.throws(
    () => resolveKeyBindings([
      { action: "shot", keys: ["KeyZ"] },
      { action: "focus", keys: ["ShiftLeft", "KeyZ"] },
    ]),
    /Key KeyZ is bound to both shot and focus/,
  );
  assert.throws(
    () => resolveKeyBindings([
      { action: "shot", keys: ["KeyZ"] },
      { action: "pause", keys: ["KeyZ"] },
    ]),
    /Key KeyZ is bound to both shot and pause/,
  );
});
