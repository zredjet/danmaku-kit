import assert from "node:assert/strict";
import test from "node:test";

import { createDifficultyBranchPatternDefinition, createExtendedPatternDefinition } from "../test-support/definitions.ts";
import { createLoadedContentIndex, patternProgramsForDifficulty } from "./content-index.ts";

test("shares the program of patterns without difficulty branches and compiles branched patterns per difficulty", () => {
  const extended = createLoadedContentIndex(createExtendedPatternDefinition());
  const branched = createLoadedContentIndex(createDifficultyBranchPatternDefinition());
  const programOf = (index: typeof extended, difficulty: "normal" | "hard", patternId: string) => (
    patternProgramsForDifficulty(index, difficulty).get(patternId)
  );

  assert.ok(programOf(extended, "normal", "pattern.radial_stream"));
  assert.equal(programOf(extended, "normal", "pattern.radial_stream"), programOf(extended, "hard", "pattern.radial_stream"));
  assert.equal(programOf(extended, "normal", "pattern.none"), undefined);
  assert.notEqual(programOf(branched, "normal", "pattern.difficulty_branch"), programOf(branched, "hard", "pattern.difficulty_branch"));
  assert.deepEqual(
    (["normal", "hard"] as const).map((difficulty) => programOf(branched, difficulty, "pattern.hard_only")?.length),
    [0, 1],
  );
  assert.throws(() => patternProgramsForDifficulty(branched, "lunatic" as "normal"), RangeError);
});
