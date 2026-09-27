import assert from "node:assert/strict";
import test from "node:test";

import { createTestFrame } from "../../test-support/game-frames.ts";
import { computeViewportLayout } from "../view/viewport-layout.ts";
import { buildBrowserDebugStateDump, type BrowserDebugStateSource } from "./browser-debug-state.ts";

const frame = createTestFrame(119, {
  entities: [
    { id: 1, kind: "player", definitionId: "player.default", position: { x: 180, y: 400 } },
    { id: 2, kind: "enemy", definitionId: "enemy.scout", position: { x: 192, y: 60 } },
    { id: 5, kind: "playerShot", definitionId: "playerShot.basic", position: { x: 180, y: 300 } },
  ],
});

const layout = computeViewportLayout({ width: 1000, height: 1000, devicePixelRatio: 2 });

const source: BrowserDebugStateSource = {
  lifecycle: "playing",
  seed: "c0ffee",
  frame,
  layout,
  inputQueueDepth: 1,
  assetStatus: "ready",
  audioStatus: "muted",
  overlayRect: { x: 116, y: 52, width: 768 },
  debugOverlay: true,
};

test("dumps the stage, viewport and runtime state in the schema order", () => {
  const dump = buildBrowserDebugStateDump(source);

  assert.deepEqual(dump, {
    schemaVersion: "1",
    kind: "browser",
    tick: 120,
    seed: "c0ffee",
    lifecycle: "playing",
    entityCounts: { player: 1, enemy: 1, enemyBullet: 0, playerShot: 1 },
    playerPosition: { x: 180, y: 400 },
    viewport: { logicalWidth: 384, logicalHeight: 448, scale: 2, devicePixelRatio: 2, letterboxX: 116, letterboxY: 52 },
    inputQueueDepth: 1,
    assetStatus: "ready",
    audioStatus: "muted",
    overlayTransform: { x: 116, y: 52, scale: 2 },
    debugOverlay: true,
  });
  assert.deepEqual(Object.keys(dump), [
    "schemaVersion",
    "kind",
    "tick",
    "seed",
    "lifecycle",
    "entityCounts",
    "playerPosition",
    "viewport",
    "inputQueueDepth",
    "assetStatus",
    "audioStatus",
    "overlayTransform",
    "debugOverlay",
  ]);
  assert.equal(Object.isFrozen(dump.viewport) && Object.isFrozen(dump.entityCounts), true);
  assert.equal(JSON.stringify(dump).includes("Hash"), false);
});

test("reports tick 0, no player and no seed outside a stage", () => {
  const dump = buildBrowserDebugStateDump({ ...source, lifecycle: "title", seed: null, frame: null, inputQueueDepth: 0 });

  assert.deepEqual(
    [dump.tick, dump.seed, dump.playerPosition, dump.entityCounts],
    [0, null, null, { player: 0, enemy: 0, enemyBullet: 0, playerShot: 0 }],
  );
});
