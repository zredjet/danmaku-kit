import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "@shooting-sample/shooting-core";

import { createSampleTitleCore, loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import { PREVIEW_STAGE_ID } from "./preview-definition.ts";
import { PreviewSelection, firstPreviewTarget } from "./preview-selection.ts";

const OPTIONS = { targetParameter: "", seed: "preview", requestedDifficulty: null } as const;

/** sample content の stage に hard だけを持つ stage を足した definition。 */
function withHardOnlyStage(definition: GameDefinition): GameDefinition {
  const [first] = definition.content.stages;
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [...definition.content.stages, { ...first!, id: "stage.hard_only", difficulties: ["hard"] }],
    },
  };
}

test("starts from the target of the preview parameter or the first stage", async () => {
  const definition = await loadSampleTitleDefinition();

  assert.deepEqual(new PreviewSelection(definition, OPTIONS).target, { kind: "stage", stageId: "stage.stage_01" });
  assert.deepEqual(new PreviewSelection(definition, { ...OPTIONS, targetParameter: "pattern:pattern.drone_aimed_shot" }).target, {
    kind: "pattern",
    patternId: "pattern.drone_aimed_shot",
  });
  assert.deepEqual(new PreviewSelection(definition, { ...OPTIONS, targetParameter: "path:path.missing" }).target, {
    kind: "stage",
    stageId: "stage.stage_01",
  });
});

test("composes the selected target into content the shell can start", async () => {
  const definition = await loadSampleTitleDefinition();
  const selection = new PreviewSelection(definition, OPTIONS);
  const core = createSampleTitleCore();

  assert.equal(selection.selectTarget("path:path.missing"), false);
  assert.equal(selection.selectTarget("enemy:enemy.drone,path.drone_dive,pattern.drone_aimed_shot"), true);
  const composed = selection.compose(core);
  assert.ok(composed.ok);
  assert.deepEqual(composed.content.stage, { stageId: PREVIEW_STAGE_ID, difficulty: "normal" });
  assert.equal(composed.stage.id, PREVIEW_STAGE_ID);
  assert.equal(composed.content.loadedGame.startStage({ ...composed.content.stage, seed: selection.seed }).ok, true);
});

test("keeps the difficulty to the ones the composed stage has", async () => {
  const definition = withHardOnlyStage(await loadSampleTitleDefinition());
  const selection = new PreviewSelection(definition, { ...OPTIONS, requestedDifficulty: "normal" });
  const core = createSampleTitleCore();

  assert.deepEqual(selection.difficulties(), ["normal"]);
  selection.selectTarget("stage:stage.hard_only");
  assert.deepEqual(selection.difficulties(), ["hard"]);
  const composed = selection.compose(core);
  assert.ok(composed.ok);
  assert.equal(composed.content.stage.difficulty, "hard");
  assert.equal(selection.difficulty, "hard");

  // enemy、pattern、path の stage は content の stage の difficulty をすべて持つ。
  selection.selectTarget("pattern:pattern.drone_aimed_shot");
  selection.setDifficulty("normal");
  assert.deepEqual(selection.difficulties(), ["normal", "hard"]);
  const pattern = selection.compose(core);
  assert.ok(pattern.ok);
  assert.equal(pattern.content.stage.difficulty, "normal");
});

test("ignores a blank seed and falls back to the first stage when a reload removes the target", async () => {
  const definition = await loadSampleTitleDefinition();
  const selection = new PreviewSelection(definition, { ...OPTIONS, targetParameter: "path:path.drone_dive" });

  assert.equal(selection.setSeed("  "), false);
  assert.equal(selection.setSeed("other"), true);
  assert.equal(selection.seed, "other");

  selection.replaceDefinition(definition);
  assert.deepEqual(selection.target, { kind: "path", pathId: "path.drone_dive" });
  selection.replaceDefinition({
    ...definition,
    content: { ...definition.content, paths: definition.content.paths.filter((path) => path.id !== "path.drone_dive") },
  });
  assert.deepEqual(selection.target, { kind: "stage", stageId: "stage.stage_01" });
});

test("reports the load errors of the composed content", async () => {
  const definition = await loadSampleTitleDefinition();
  const selection = new PreviewSelection(definition, OPTIONS);
  const composed = selection.compose({ load: () => ({ ok: false, errors: [{ code: "definition.invalidShape", message: "broken" }] }) });

  assert.deepEqual(composed, { ok: false, errors: ["definition.invalidShape: broken"] });
});

test("picks the first ids of the content when the kind changes", async () => {
  const definition = await loadSampleTitleDefinition();
  const { enemies, paths, patterns } = definition.content;

  assert.deepEqual(firstPreviewTarget("enemy", definition), {
    kind: "enemy",
    enemyId: enemies[0]!.id,
    pathId: paths[0]!.id,
    patternId: patterns[0]!.id,
  });
  assert.deepEqual(firstPreviewTarget("path", definition), { kind: "path", pathId: paths[0]!.id });
  assert.deepEqual(firstPreviewTarget("stage", { ...definition, content: { ...definition.content, stages: [] } }), null);
});
