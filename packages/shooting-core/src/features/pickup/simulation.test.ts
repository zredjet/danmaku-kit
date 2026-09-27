import assert from "node:assert/strict";
import test from "node:test";

import type { GameFrame, LoadedGame } from "../../basic/api-types.ts";
import { createShootingCore } from "../../basic/core.ts";
import type { GameDefinition } from "../../basic/content/types.ts";
import { createEmptyInputFrame } from "../../basic/input/input-frame.ts";
import { createShotInputFrame } from "../../basic/test-support/input-frames.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../../basic/test-support/stage-harness.ts";
import { pickupFeature } from "./index.ts";
import { createDroppingEnemyDefinition } from "./test-support/pickup-definitions.ts";

function loadGame(definition: GameDefinition): LoadedGame {
  const loaded = createShootingCore({ features: [pickupFeature] }).load(definition);
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? null : loaded.errors));
  return loaded.value;
}

/** tick 0 に撃ち、その後は何も入力しない frame を `ticks` 個進める。 */
function runFrames(game: LoadedGame, ticks: number): GameFrame[] {
  const session = startStageFromLoadedGame(game);
  return Array.from({ length: ticks }, (_, tick) => assertTickOk(
    session.tick(tick === 0 ? createShotInputFrame(0) : createEmptyInputFrame(tick)),
    `tick ${tick}`,
  ));
}

const pickupEvents = (frame: GameFrame) => frame.events.filter((event) => (
  event.type === "pickupsSpawnedBatch" || event.type === "pickupCollected" || event.type === "scoreChanged"
));

test("drops pickups from a defeated enemy in the scoring step and shows them in the frame", () => {
  const [first] = runFrames(loadGame(createDroppingEnemyDefinition()), 1);

  // player 1、scout 2、shot 3 の後に pickup を 4〜6 で採番する。敵の score の後に pickup の生成を知らせる。
  assert.deepEqual(pickupEvents(first!), [
    { type: "scoreChanged", tick: 0, delta: 100, total: 100, reason: "enemyDefeated", enemyId: "enemy.scout", entityId: 2 },
    {
      type: "pickupsSpawnedBatch",
      tick: 0,
      pickups: [182, 192, 202].map((x, index) => ({ entityId: 4 + index, definitionId: "pickup.score_small", position: { x, y: 380 } })),
    },
  ]);
  assert.deepEqual(first!.state.features, {
    pickups: [182, 192, 202].map((x, index) => ({
      id: 4 + index,
      definitionId: "pickup.score_small",
      position: { x, y: 380 },
      attracted: false,
    })),
  });
  assert.equal(Object.isFrozen(first!.state.features!.pickups![0]!.position), true);
});

test("collects a falling pickup inside the collect radius and removes the others below the playfield", () => {
  const frames = runFrames(loadGame(createDroppingEnemyDefinition()), 68);
  const collectedAt = frames.findIndex((frame) => frame.events.some((event) => event.type === "pickupCollected"));

  assert.equal(collectedAt, 7);
  assert.deepEqual(pickupEvents(frames[7]!), [
    { type: "pickupCollected", tick: 7, entityId: 5, definitionId: "pickup.score_small" },
    { type: "scoreChanged", tick: 7, delta: 100, total: 200, reason: "pickupCollected", pickupId: "pickup.score_small", entityId: 5 },
  ]);
  assert.deepEqual(frames[6]!.state.features!.pickups!.map((pickup) => pickup.position), [
    { x: 182, y: 389 },
    { x: 192, y: 389 },
    { x: 202, y: 389 },
  ]);
  assert.deepEqual(frames[66]!.state.features!.pickups!.map((pickup) => [pickup.id, pickup.position.y]), [[4, 479], [6, 479]]);
  assert.deepEqual(frames[67]!.state.features, { pickups: [] });
  assert.equal(frames[67]!.state.score, 200);
  assert.equal(frames.slice(8).some((frame) => pickupEvents(frame).length > 0), false);
});

test("holds attracted pickups still and collects them after the attraction ticks", () => {
  const frames = runFrames(loadGame(createDroppingEnemyDefinition({ magnetRadius: 40 })), 13);

  assert.deepEqual(frames[0]!.state.features!.pickups!.map((pickup) => [pickup.id, pickup.attracted, pickup.position.y]), [
    [4, true, 380],
    [5, true, 380],
    [6, true, 380],
  ]);
  assert.deepEqual(frames[11]!.state.features!.pickups!.map((pickup) => pickup.position.y), [380, 380, 380]);
  assert.deepEqual(pickupEvents(frames[12]!).map((event) => [event.type, "entityId" in event ? event.entityId : null]), [
    ["pickupCollected", 4],
    ["scoreChanged", 4],
    ["pickupCollected", 5],
    ["scoreChanged", 5],
    ["pickupCollected", 6],
    ["scoreChanged", 6],
  ]);
  assert.deepEqual([frames[12]!.state.score, frames[12]!.state.features], [400, { pickups: [] }]);
});

test("leaves frames without a features field when no feature is enabled", () => {
  const definition = createDroppingEnemyDefinition();
  const { features: _features, ...content } = definition.content;
  const basic = loadGame({
    ...definition,
    enabledFeatures: [],
    content: { ...content, enemies: content.enemies.map(({ drops: _drops, ...enemy }) => enemy) },
  });

  const [first] = runFrames(basic, 1);
  assert.equal("features" in first!.state, false);
});
