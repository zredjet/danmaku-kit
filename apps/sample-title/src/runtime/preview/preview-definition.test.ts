import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "@shooting-sample/shooting-core";

import { createSampleTitleCore, loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import {
  PREVIEW_HOLD_PATH_ID,
  PREVIEW_SILENT_PATTERN_ID,
  PREVIEW_SPAWN_TICK,
  PREVIEW_STAGE_ID,
  composePreviewDefinition,
  formatPreviewTarget,
  listPreviewChoices,
  parsePreviewTarget,
  previewDifficulties,
  type PreviewTarget,
} from "./preview-definition.ts";

test("keeps the content for a stage and adds a one-spawn stage for an enemy, a pattern or a path", async () => {
  const definition = await loadSampleTitleDefinition();

  assert.deepEqual(composePreviewDefinition(definition, { kind: "stage", stageId: "stage.stage_01" }, "normal"), {
    definition,
    stageId: "stage.stage_01",
  });
  const spawnOf = (target: PreviewTarget) => {
    const composed = composePreviewDefinition(definition, target, "normal");
    const stage = composed.definition.content.stages.find((candidate) => candidate.id === composed.stageId)!;
    assert.equal(composed.stageId, PREVIEW_STAGE_ID);
    assert.deepEqual(stage.difficulties, ["normal"]);
    assert.deepEqual(stage.timeline.map((step) => step.tick), [PREVIEW_SPAWN_TICK]);
    // 合成した definition を Core がそのまま load でき、stage を始められる。
    const loaded = createSampleTitleCore().load(composed.definition);
    assert.ok(loaded.ok, JSON.stringify(loaded.ok ? null : loaded.errors));
    assert.equal(loaded.value.startStage({ stageId: composed.stageId, difficulty: "normal", seed: "preview" }).ok, true);
    return stage.timeline[0]!.action;
  };

  // pattern は、その pattern を使う最初の spawn の enemy を画面の上の方に止めて撃たせる。
  assert.deepEqual(spawnOf({ kind: "pattern", patternId: "pattern.gunship_barrage" }), {
    type: "spawnEnemy",
    enemy: "enemy.gunship",
    path: PREVIEW_HOLD_PATH_ID,
    pattern: "pattern.gunship_barrage",
    position: { x: 192, y: 120 },
  });
  // path は、その path を使う最初の spawn の enemy と位置で、撃たずに動かす。
  const path = spawnOf({ kind: "path", pathId: "path.drone_dive" });
  assert.deepEqual([path.enemy, path.path, path.pattern], ["enemy.drone", "path.drone_dive", PREVIEW_SILENT_PATTERN_ID]);
  // enemy は選んだ path と pattern で、その enemy を使う最初の spawn の位置に出す。
  const enemy = spawnOf({ kind: "enemy", enemyId: "enemy.scout", pathId: "path.drone_dive", patternId: "pattern.scout_three_way" });
  assert.deepEqual([enemy.enemy, enemy.path, enemy.pattern], ["enemy.scout", "path.drone_dive", "pattern.scout_three_way"]);
  // 位置は同じ enemy と path の spawn、同じ path の spawn、同じ enemy の spawn の順に借り、path が画面に入る向きに合わせる。
  const position = (pathId: `path.${string}`) =>
    spawnOf({ kind: "enemy", enemyId: "enemy.scout", pathId, patternId: "pattern.scout_three_way" }).position;
  assert.deepEqual(position("path.scout_sweep_left"), { x: 408, y: 112 });
  assert.deepEqual(position("path.drone_dive"), { x: 96, y: -16 });
});

test("parses and formats preview targets from the URL and rejects ids the content does not have", async () => {
  const definition = await loadSampleTitleDefinition();
  const targets: readonly PreviewTarget[] = [
    { kind: "stage", stageId: "stage.stage_01" },
    { kind: "pattern", patternId: "pattern.scout_three_way" },
    { kind: "path", pathId: "path.gunship_entry" },
    { kind: "enemy", enemyId: "enemy.drone", pathId: "path.drone_dive", patternId: "pattern.drone_aimed_shot" },
  ];

  for (const target of targets) {
    assert.deepEqual(parsePreviewTarget(formatPreviewTarget(target), definition), target);
  }
  for (const value of ["", "stage", "stage:stage.missing", "pattern:path.drone_dive", "enemy:enemy.drone,path.drone_dive", "boss:x"]) {
    assert.equal(parsePreviewTarget(value, definition), null, value);
  }
  assert.deepEqual(listPreviewChoices(definition).stages, ["stage.stage_01"]);
  assert.equal(listPreviewChoices(definition).patterns.includes("pattern.gunship_barrage"), true);
});

test("keeps the added ids apart from the content ids and gives the added stage only the selected difficulty", async () => {
  const definition = await loadSampleTitleDefinition();
  const [stage] = definition.content.stages;
  const colliding: GameDefinition = {
    ...definition,
    content: {
      ...definition.content,
      stages: [...definition.content.stages, { ...stage!, id: PREVIEW_STAGE_ID, difficulties: ["normal", "hard"] }],
      paths: [...definition.content.paths, { id: PREVIEW_HOLD_PATH_ID, version: 1 }],
      patterns: [...definition.content.patterns, { id: PREVIEW_SILENT_PATTERN_ID, version: 1 }],
    },
  };

  const composed = composePreviewDefinition(colliding, { kind: "pattern", patternId: "pattern.gunship_barrage" }, "hard");
  const added = composed.definition.content.stages.at(-1)!;
  assert.deepEqual([composed.stageId, added.id, added.difficulties], ["stage.preview_2", "stage.preview_2", ["hard"]]);
  assert.deepEqual([added.timeline[0]!.action.path, composed.definition.content.paths.at(-1)!.id], ["path.preview_hold_2", "path.preview_hold_2"]);
  assert.equal(composed.definition.content.patterns.at(-1)!.id, "pattern.preview_silent_2");
  const loaded = createSampleTitleCore().load(composed.definition);
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? null : loaded.errors));
  assert.equal(loaded.value.startStage({ stageId: composed.stageId, difficulty: "hard", seed: "preview" }).ok, true);
  assert.deepEqual(previewDifficulties(colliding), ["normal", "hard"]);
});
