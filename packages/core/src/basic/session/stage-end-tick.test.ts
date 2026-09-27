import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "../content/types.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { InputFrame } from "../input/input-frame.ts";
import {
  createClearedByExitDefinition,
  createCollisionScoreDefinition,
  createLastLifeHitDefinition,
} from "../test-support/definitions.ts";
import { createPressedShotInputFrame, createShotInputFrame } from "../test-support/input-frames.ts";
import { assertSerializeOk, assertTickOk, startStageFromDefinition, tickUnknown } from "../test-support/stage-harness.ts";

function eventTypes(definition: GameDefinition, inputs: readonly InputFrame[]) {
  const session = startStageFromDefinition(definition);
  const frames = inputs.map((input) => assertTickOk(session.tick(input), `tick ${input.tick}`));
  return { session, frames, types: frames.map((frame) => frame.events.map((event) => event.type)) };
}

test("ends the stage with gameOver in the tick the last life is lost", () => {
  const { frames, types } = eventTypes(createLastLifeHitDefinition(), [createEmptyInputFrame(0)]);

  assert.deepEqual(types[0], [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerHit",
    "entityDestroyed",
    "gameOver",
    "tickAdvanced",
  ]);
  assert.deepEqual(frames[0]!.events.at(-2), { type: "gameOver", tick: 0, stageId: "stage.stage_01" });
  assert.equal(frames[0]!.state.status, "gameOver");
  assert.equal(frames[0]!.state.player.lives, 0);
});

test("keeps playing after a hit while lives remain", () => {
  const definition = createLastLifeHitDefinition();
  const { frames, types } = eventTypes({
    ...definition,
    content: {
      ...definition.content,
      players: [{ ...definition.content.players[0]!, life: { initialLives: 2, invincibleTicksAfterHit: 120 } }],
    },
  }, [createEmptyInputFrame(0), createEmptyInputFrame(1)]);

  assert.equal(types[0]!.includes("gameOver"), false);
  assert.deepEqual(frames.map((frame) => [frame.state.status, frame.state.player.lives]), [["playing", 1], ["playing", 1]]);
});

test("clears the stage when the timeline is done and the last enemy leaves the playfield", () => {
  const { frames, types } = eventTypes(createClearedByExitDefinition(), Array.from({ length: 6 }, (_, tick) => createEmptyInputFrame(tick)));

  assert.deepEqual(frames.map((frame) => frame.state.status), ["playing", "playing", "playing", "playing", "playing", "stageCleared"]);
  assert.deepEqual(types[5], ["enemyBulletsSpawnedBatch", "stageCleared", "tickAdvanced"]);
  assert.deepEqual(frames[5]!.events[1], { type: "stageCleared", tick: 5, stageId: "stage.stage_01" });
  // 敵弾が残っていても stage は終わる。
  assert.equal(frames[5]!.state.entities.some((entity) => entity.kind === "enemyBullet"), true);
});

test("waits for later timeline steps before clearing even when no enemy is active", () => {
  const definition = createCollisionScoreDefinition();
  const { frames, types } = eventTypes({
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: definition.content.stages[0]!.timeline.map((step) => step.tick > 0 ? { ...step, tick: 3, action: { ...step.action, position: { x: 192, y: 380 } } } : step),
      }],
    },
  }, [createShotInputFrame(0), createEmptyInputFrame(1), createEmptyInputFrame(2), createPressedShotInputFrame(3)]);

  assert.deepEqual(frames.map((frame) => [frame.state.status, frame.state.entities.filter((entity) => entity.kind === "enemy").length]), [
    ["playing", 0],
    ["playing", 0],
    ["playing", 0],
    ["stageCleared", 0],
  ]);
  assert.deepEqual(types[3]!.slice(-3), ["scoreChanged", "stageCleared", "tickAdvanced"]);
});

test("clears a stage with an empty timeline at the end of tick 0", () => {
  const definition = createClearedByExitDefinition();
  const { frames, types } = eventTypes({
    ...definition,
    content: { ...definition.content, stages: [{ ...definition.content.stages[0]!, timeline: [] }] },
  }, [createEmptyInputFrame(0)]);

  assert.deepEqual(types[0], ["stageStarted", "stageCleared", "tickAdvanced"]);
  assert.equal(frames[0]!.state.status, "stageCleared");
});

test("prefers gameOver when the last life and the last enemy are lost in the same tick", () => {
  const definition = createLastLifeHitDefinition();
  const { frames, types } = eventTypes({
    ...definition,
    content: { ...definition.content, playerShots: [{ ...definition.content.playerShots[0]!, damage: 10 }] },
  }, [createShotInputFrame(0)]);

  assert.deepEqual(types[0]!.slice(-3), ["scoreChanged", "gameOver", "tickAdvanced"]);
  assert.equal(types[0]!.includes("stageCleared"), false);
  assert.equal(frames[0]!.state.status, "gameOver");
  assert.equal(frames[0]!.state.entities.some((entity) => entity.kind === "enemy"), false);
});

test("rejects ticks after the stage ends as a caller precondition error without a fatal latch", () => {
  const { session } = eventTypes(createLastLifeHitDefinition(), [createEmptyInputFrame(0)]);
  const ended = [{ code: "stageSession.ended", message: "Stage session has ended: gameOver" }];

  for (const input of [createEmptyInputFrame(1), createEmptyInputFrame(1), createEmptyInputFrame(7), { tick: "next" }]) {
    const result = tickUnknown(session, input);
    assert.equal(result.ok, false);
    assert.deepEqual(!result.ok && result.errors, ended);
  }
  const snapshot = assertSerializeOk(session.serialize(), "serialize after gameOver");
  assert.equal(snapshot.expectedTick, 1);
  assert.equal(snapshot.state.stageStatus, "gameOver");
});
