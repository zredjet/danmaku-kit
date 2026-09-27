import assert from "node:assert/strict";
import test from "node:test";

import { createTestFrame } from "../../test-support/game-frames.ts";
import { buildDebugHudLines } from "./debug-lines.ts";

const frame = createTestFrame(42, {
  entities: [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 192, y: 40 } },
    { id: 3, kind: "enemyBullet", definitionId: "bullet.red_small", position: { x: 192, y: 60 } },
  ],
});

const base = {
  versionLabel: "shooting-core 0.0.0 / content sample@content.1",
  audioStatus: "muted",
  droppedTicksTotal: 3,
  notes: [],
} as const;

test("shows the stage seed, tick, dropped ticks and entity counts per kind during a stage", () => {
  assert.deepEqual(buildDebugHudLines({ ...base, lifecycle: "playing", seed: "abc", difficulty: "hard", frame, notes: ["hit sparks dropped 2"] }), [
    "shooting-core 0.0.0 / content sample@content.1",
    "playing  audio muted",
    "hard  seed abc  tick 42  dropped 3",
    "player 1  enemy 1  enemyBullet 1  playerShot 0  pickup 0",
    "hit sparks dropped 2",
  ]);
});

test("leaves out the stage lines outside a stage and before the first tick", () => {
  assert.deepEqual(buildDebugHudLines({ ...base, lifecycle: "title", seed: null, difficulty: null, frame: null }), [
    "shooting-core 0.0.0 / content sample@content.1",
    "title  audio muted",
  ]);
  assert.deepEqual(buildDebugHudLines({ ...base, lifecycle: "stageStarting", seed: "abc", difficulty: "normal", frame: null }).slice(2), [
    "normal  seed abc  tick -  dropped 3",
  ]);
});
