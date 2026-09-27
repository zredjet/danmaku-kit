import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition, LoadedGame } from "@danmaku-kit/core";

import { expandInputScript, runHeadlessReplay } from "../../test-support/headless-replay.ts";
import { createSampleTitleCore, loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import {
  NO_PREVIEW_CHEATS,
  PREVIEW_INVINCIBLE_LIVES,
  applyPreviewCheats,
  snapStageJumpTick,
  stageJumpTicks,
} from "./preview-cheats.ts";

/** 何も入力しない 3,000 tick。 */
const IDLE = expandInputScript([{ fromTick: 0 }], 3_000);

function load(definition: GameDefinition): LoadedGame {
  const loaded = createSampleTitleCore().load(definition);
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? null : loaded.errors));
  return loaded.value;
}

test("lists the ticks a stage can jump to and snaps other ticks to the spawn at or before them", async () => {
  const [stage] = (await loadSampleTitleDefinition()).content.stages;
  const ticks = stageJumpTicks(stage!);

  assert.equal(ticks[0], 0);
  assert.deepEqual(ticks, [...new Set([0, ...stage!.timeline.map((step) => step.tick)])].sort((left, right) => left - right));
  assert.deepEqual(
    [snapStageJumpTick(stage!, ticks[3]!), snapStageJumpTick(stage!, ticks[3]! + 1), snapStageJumpTick(stage!, ticks[1]! - 1)],
    [ticks[3], ticks[3], 0],
  );
  assert.equal(snapStageJumpTick(stage!, Number.MAX_SAFE_INTEGER), ticks.at(-1));
});

test("leaves the definition alone without cheats", async () => {
  const definition = await loadSampleTitleDefinition();

  assert.deepEqual(applyPreviewCheats(definition, "stage.stage_01", NO_PREVIEW_CHEATS), { definition, stageId: "stage.stage_01" });
});

test("jumps to a tick with a stage copy that drops the earlier spawns and moves the rest forward", async () => {
  const definition = await loadSampleTitleDefinition();
  const [stage] = definition.content.stages;
  const jumpTick = stageJumpTicks(stage!)[3]!;

  const jumped = applyPreviewCheats(definition, "stage.stage_01", { invincible: false, jumpTick });
  const added = jumped.definition.content.stages.find((candidate) => candidate.id === jumped.stageId)!;
  assert.equal(jumped.stageId, "stage.stage_01_preview_cheat");
  assert.deepEqual(jumped.definition.content.stages[0], stage);
  assert.deepEqual(added.difficulties, stage!.difficulties);
  assert.deepEqual(
    added.timeline,
    stage!.timeline.filter((step) => step.tick >= jumpTick).map((step) => ({ ...step, tick: step.tick - jumpTick })),
  );
  assert.equal(added.timeline[0]!.tick, 0);

  // 詰めた stage は tick 0 から jump した tick の spawn を出す。
  const { frames } = runHeadlessReplay(load(jumped.definition), { stageId: jumped.stageId, difficulty: "normal", seed: "jump" }, IDLE.slice(0, 1));
  assert.equal(
    frames[0]!.state.entities.filter((entity) => entity.kind === "enemy").length,
    added.timeline.filter((step) => step.tick === 0).length,
  );
});

test("loads a jumped stage for every tick the sample stage can jump to", async () => {
  const definition = await loadSampleTitleDefinition();

  for (const jumpTick of stageJumpTicks(definition.content.stages[0]!)) {
    const jumped = applyPreviewCheats(definition, "stage.stage_01", { invincible: true, jumpTick });
    const session = load(jumped.definition).startStage({ stageId: jumped.stageId, difficulty: "normal", seed: "jump" });
    assert.ok(session.ok, `jump ${jumpTick}`);
  }
});

test("keeps the invincible player in a stage copy after hits that would end the stage", async () => {
  const definition = await loadSampleTitleDefinition();
  const invincible = applyPreviewCheats(definition, "stage.stage_01", { invincible: true, jumpTick: 0 });
  const player = invincible.definition.content.players.find((candidate) => candidate.id === definition.defaultPlayerId)!;
  assert.equal(player.life.initialLives, PREVIEW_INVINCIBLE_LIVES);
  // content の stage と同じ id の再生記録にならないよう、timeline が同じでも stage を複製する。
  assert.equal(invincible.stageId, "stage.stage_01_preview_cheat");
  assert.deepEqual(invincible.definition.content.stages.at(-1)!.timeline, definition.content.stages[0]!.timeline);

  // 何もしない自機は通常の lives では game over になるが、invincible では stage が終わらない。
  const normal = runHeadlessReplay(load(definition), { stageId: "stage.stage_01", difficulty: "normal", seed: "idle" }, IDLE);
  assert.equal(normal.frames.at(-1)!.state.status, "gameOver");
  const cheated = runHeadlessReplay(
    load(invincible.definition),
    { stageId: invincible.stageId, difficulty: "normal", seed: "idle" },
    IDLE.slice(0, normal.frames.length + 60),
  );
  const last = cheated.frames.at(-1)!;
  assert.equal(last.state.status, "playing");
  assert.ok(last.state.player.lives < PREVIEW_INVINCIBLE_LIVES);
});
