import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "@shooting-sample/shooting-core";

import { selectStageDifficulty, selectStartStage } from "./stage-difficulty.ts";

test("uses the requested difficulty when the stage has it and falls back to the stage's first difficulty", () => {
  assert.equal(selectStageDifficulty(["normal", "hard"], "hard"), "hard");
  assert.equal(selectStageDifficulty(["normal", "hard"], null), "normal");
  assert.equal(selectStageDifficulty(["normal"], "hard"), "normal");
  assert.equal(selectStageDifficulty(["hard", "normal"], "lunatic"), "hard");
  assert.equal(selectStageDifficulty([], "normal"), null);
});

test("starts the first stage of the content with the selected difficulty", () => {
  const withStages = (stages: readonly unknown[]) => ({ content: { stages } }) as unknown as GameDefinition;

  assert.deepEqual(selectStartStage(withStages([{ id: "stage.a", difficulties: ["normal", "hard"] }, { id: "stage.b" }]), "hard"), {
    stageId: "stage.a",
    difficulty: "hard",
  });
  assert.equal(selectStartStage(withStages([]), null), null);
  assert.equal(selectStartStage(withStages([{ id: "stage.a", difficulties: [] }]), null), null);
});
