import assert from "node:assert/strict";
import test from "node:test";

import type { AssertTrue, IsExactly } from "../../../../../tests/support/type-assertions.ts";
import { KNOWN_DIFFICULTIES, KNOWN_ENABLED_FEATURES, isKnownDifficulty } from "./types.ts";
import type { Difficulty } from "./types.ts";

/** 実行時一覧が `Difficulty` の全 member を過不足なく持つことを型で固定する。 */
type KnownDifficultiesAssertions = readonly [
  AssertTrue<IsExactly<(typeof KNOWN_DIFFICULTIES)[number], Difficulty>>,
];

test("keeps basic core difficulties stable", () => {
  assert.equal(Object.isFrozen(KNOWN_DIFFICULTIES), true);
  assert.deepEqual(KNOWN_DIFFICULTIES, ["normal", "hard"]);
  assert.deepEqual(
    ["normal", "hard", "lunatic", "Normal", "", 1, null, undefined].map((value) => isKnownDifficulty(value)),
    [true, true, false, false, false, false, false, false],
  );
});

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
