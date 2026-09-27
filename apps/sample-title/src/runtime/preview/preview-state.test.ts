import assert from "node:assert/strict";
import test from "node:test";

import type { GameFrame, SerializedGameState, StageDefinition } from "@shooting-sample/shooting-core";

import { describePreviewState, labeledEntities, previewInfoKey, upcomingSpawns } from "./preview-state.ts";

test("lists the spawns of the timeline in the upcoming window", () => {
  const spawn = (tick: number, x: number) => ({
    tick,
    action: { type: "spawnEnemy", enemy: "enemy.drone", path: "path.none", pattern: "pattern.none", position: { x, y: -16 } },
  }) as const;
  const stage = { id: "stage.s", version: 1, difficulties: ["normal"], timeline: [spawn(10, 1), spawn(40, 2), spawn(100, 3)] } as StageDefinition;

  assert.deepEqual(upcomingSpawns(stage, 10, 31).map((item) => [item.tick, item.position.x]), [[10, 1], [40, 2]]);
  assert.deepEqual(upcomingSpawns(stage, 101, 60), []);
});

test("labels the player, enemies and pickups but not the bullets and shots", () => {
  const frame = {
    tick: 3,
    state: {
      entities: [
        { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
        { id: 2, kind: "enemy", definitionId: "enemy.drone", position: { x: 96, y: 40 } },
        { id: 3, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 96, y: 50 } },
      ],
      features: { pickups: [{ id: 4, definitionId: "pickup.score_small", position: { x: 90, y: 60 }, attracted: false }] },
    },
  } as unknown as GameFrame;

  assert.deepEqual(labeledEntities(frame).map((label) => label.id), [1, 2, 4]);
  assert.deepEqual(labeledEntities(null), []);
});

test("describes the tick, the PRNG state and each pattern runner from the serialized state", () => {
  const serialized = {
    expectedTick: 42,
    prngState: { state: 0x1234abcd },
    state: {
      patternRunnerStates: [
        { runnerId: "patternRunner.enemy.5", patternId: "pattern.scout_three_way", stateVersion: 1, payload: { cursor: 3, waitRemaining: 12 } },
      ],
    },
  } as unknown as SerializedGameState;

  assert.deepEqual(describePreviewState(serialized), ["next tick 42  prng 1234abcd", "enemy.5 pattern.scout_three_way cursor 3 wait 12"]);
  assert.deepEqual(describePreviewState({ ...serialized, state: { ...serialized.state, patternRunnerStates: [] } }).at(-1), "no pattern runner");
  assert.deepEqual(describePreviewState(null), []);
});

test("redraws the panel text every few ticks while playing and on every change otherwise", () => {
  const keys = (lifecycle: string, ticks: readonly (number | null)[]) => ticks.map((tick) => previewInfoKey(lifecycle, tick, 6));

  assert.equal(new Set(keys("playing", [6, 7, 11])).size, 1);
  assert.notEqual(previewInfoKey("playing", 11, 6), previewInfoKey("playing", 12, 6));
  // pause した frame、1 tick 送り、stage の終わりは、playing の同じ tick の文字を描き直す。
  assert.notEqual(previewInfoKey("paused", 7, 6), previewInfoKey("playing", 7, 6));
  assert.equal(new Set(keys("paused", [7, 8, 9])).size, 3);
  assert.notEqual(previewInfoKey("stageCleared", 9, 6), previewInfoKey("paused", 9, 6));
  assert.equal(previewInfoKey("stageStarting", null, 6), "stageStarting -");
});
