import assert from "node:assert/strict";
import test from "node:test";

import { selectStageDifficulty } from "./stage-difficulty.ts";

test("uses the requested difficulty when the stage has it and falls back to the stage's first difficulty", () => {
  assert.equal(selectStageDifficulty(["normal", "hard"], "hard"), "hard");
  assert.equal(selectStageDifficulty(["normal", "hard"], null), "normal");
  assert.equal(selectStageDifficulty(["normal"], "hard"), "normal");
  assert.equal(selectStageDifficulty(["hard", "normal"], "lunatic"), "hard");
  assert.equal(selectStageDifficulty([], "normal"), null);
});
