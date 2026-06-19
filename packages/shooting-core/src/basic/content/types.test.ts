import assert from "node:assert/strict";
import test from "node:test";

import { KNOWN_ENABLED_FEATURES } from "./types.ts";

test("keeps canonical enabled feature order stable", () => {
  assert.equal(Object.isFrozen(KNOWN_ENABLED_FEATURES), true);
  assert.deepEqual(KNOWN_ENABLED_FEATURES, [
    "bomb",
    "graze",
    "affinity",
    "rank",
    "pickup",
    "advancedScoring",
  ]);
});
