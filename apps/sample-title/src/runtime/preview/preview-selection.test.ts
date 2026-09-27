import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition, ShootingCore } from "@shooting-sample/shooting-core";

import { expandInputScript, runHeadlessReplay } from "../../test-support/headless-replay.ts";
import { createSampleTitleCore, loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import { PREVIEW_INVINCIBLE_LIVES } from "./preview-cheats.ts";
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

  assert.deepEqual(selection.difficulties(), definition.content.stages[0]!.difficulties);
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
  const core = createSampleTitleCore();

  assert.equal(selection.setSeed("  "), false);
  assert.equal(selection.setSeed("other"), true);
  assert.equal(selection.seed, "other");

  assert.equal(selection.replaceDefinition(definition, core).ok, true);
  assert.deepEqual(selection.target, { kind: "path", pathId: "path.drone_dive" });
  const withoutPath = {
    ...definition,
    content: {
      ...definition.content,
      paths: definition.content.paths.filter((path) => path.id !== "path.drone_dive"),
      stages: [{ ...definition.content.stages[0]!, timeline: [] }],
    },
  };
  assert.equal(selection.replaceDefinition(withoutPath, core).ok, true);
  assert.deepEqual([selection.target, selection.definition], [{ kind: "stage", stageId: "stage.stage_01" }, withoutPath]);
});

test("keeps the selection on the previous content when the reloaded content cannot be composed", async () => {
  const definition = await loadSampleTitleDefinition();
  const selection = new PreviewSelection(definition, { ...OPTIONS, targetParameter: "path:path.drone_dive" });
  const failing: Pick<ShootingCore, "load"> = {
    load: () => ({ ok: false, errors: [{ code: "definition.invalidShape", message: "broken" }] }),
  };

  const reloaded = selection.replaceDefinition({ ...definition, content: { ...definition.content, paths: [] } }, failing);
  assert.deepEqual(reloaded, { ok: false, errors: ["definition.invalidShape: broken"] });
  assert.deepEqual([selection.target, selection.definition], [{ kind: "path", pathId: "path.drone_dive" }, definition]);
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

test("applies the stage jump to stage targets only and the invincible player to any target", async () => {
  const definition = await loadSampleTitleDefinition();
  const core = createSampleTitleCore();
  const selection = new PreviewSelection(definition, { ...OPTIONS, jumpTickParameter: "7" });
  const ticks = selection.jumpTicks();

  // URL の jump は stage の spawn の tick に寄せる（最初の spawn より前なら jump しない）。
  assert.deepEqual(selection.cheats, { invincible: false, jumpTick: 0 });
  assert.equal(new PreviewSelection(definition, { ...OPTIONS, jumpTickParameter: String(ticks[2]! + 1) }).cheats.jumpTick, ticks[2]);
  assert.equal(new PreviewSelection(definition, { ...OPTIONS, jumpTickParameter: "x" }).cheats.jumpTick, 0);
  assert.equal(selection.setJumpTick(ticks[2]! + 1), false);
  assert.equal(selection.setJumpTick(ticks[2]!), true);
  const jumped = selection.compose(core);
  assert.ok(jumped.ok);
  assert.deepEqual([jumped.content.stage.stageId, jumped.stage.timeline[0]!.tick], ["stage.stage_01_preview_cheat", 0]);

  // 対象を変えると jump を外し、stage 以外の対象は jump を持たない。
  selection.selectTarget("pattern:pattern.drone_aimed_shot");
  assert.deepEqual([selection.jumpTicks(), selection.cheats.jumpTick], [[], 0]);
  selection.selectTarget("stage:stage.stage_01");
  assert.equal(selection.cheats.jumpTick, 0);

  selection.selectTarget("pattern:pattern.drone_aimed_shot");
  selection.setInvincible(true);
  const invincible = selection.compose(core);
  assert.ok(invincible.ok);
  const { frames } = runHeadlessReplay(
    invincible.content.loadedGame,
    { ...invincible.content.stage, seed: selection.seed },
    expandInputScript([{ fromTick: 0 }], 1),
  );
  assert.equal(frames[0]!.state.player.lives, PREVIEW_INVINCIBLE_LIVES);
  assert.equal(new PreviewSelection(definition, { ...OPTIONS, invincible: true, jumpTickParameter: String(ticks[1]) }).cheats.jumpTick, ticks[1]);
});

test("snaps the jump to the moved spawns of reloaded content and drops it when the stage goes away", async () => {
  const definition = await loadSampleTitleDefinition();
  const core = createSampleTitleCore();
  const selection = new PreviewSelection(definition, OPTIONS);
  const ticks = selection.jumpTicks();
  selection.setJumpTick(ticks[3]!);
  const [stage] = definition.content.stages;
  const moved = (by: number): GameDefinition => ({
    ...definition,
    content: {
      ...definition.content,
      stages: [{ ...stage!, timeline: stage!.timeline.map((step) => step.tick === ticks[3] ? { ...step, tick: step.tick + by } : step) }],
    },
  });

  // jump 先の spawn を前へ動かすと、動かした spawn の tick へ寄せる。
  assert.ok(selection.replaceDefinition(moved(-5), core).ok);
  assert.equal(selection.cheats.jumpTick, ticks[3]! - 5);
  // 後ろへ動かすと、jump の tick 以下で最大の spawn の tick へ寄せる。
  assert.ok(selection.replaceDefinition(moved(5), core).ok);
  assert.equal(selection.cheats.jumpTick, ticks[2]);

  // stage がなくなって最初の stage に戻ったら jump を外す。
  const other = { ...definition, content: { ...definition.content, stages: [{ ...stage!, id: "stage.other" as const }] } };
  assert.ok(selection.replaceDefinition(other, core).ok);
  assert.deepEqual([selection.target, selection.cheats.jumpTick], [{ kind: "stage", stageId: "stage.other" }, 0]);
});
