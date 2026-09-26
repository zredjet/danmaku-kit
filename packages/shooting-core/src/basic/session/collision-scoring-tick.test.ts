import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { createShootingCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { createEnemyBulletHitDefinition } from "../test-support/definitions.ts";
import { createShotInputFrame } from "../test-support/input-frames.ts";

test("resolves player shot enemy collision and score in the core tick", () => {
  const definition = createMinimumDefinition();
  const loaded = createShootingCore("0.0.0").load({
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [{
          tick: 0,
          action: {
            type: "spawnEnemy",
            enemy: "enemy.scout",
            path: "path.none",
            pattern: "pattern.none",
            position: { x: 192, y: 380 },
          },
        }],
      }],
      playerShots: [{
        ...definition.content.playerShots[0]!,
        damage: 10,
      }],
    },
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected collision frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "playerShotsSpawnedBatch",
    "entityDestroyed",
    "entityDestroyed",
    "scoreChanged",
    "stageCleared",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[3], {
    type: "entityDestroyed",
    tick: 0,
    entityId: 3,
    entityKind: "playerShot",
    reason: "collision",
  });
  assert.deepEqual(frame.value.events[4], {
    type: "entityDestroyed",
    tick: 0,
    entityId: 2,
    entityKind: "enemy",
    reason: "defeated",
  });
  assert.deepEqual(frame.value.events[5], {
    type: "scoreChanged",
    tick: 0,
    delta: 100,
    total: 100,
    reason: "enemyDefeated",
    enemyId: "enemy.scout",
    entityId: 2,
  });
  // timeline の唯一の enemy を倒したので、この tick で stage が終わる。
  assert.deepEqual(frame.value.events[6], { type: "stageCleared", tick: 0, stageId: "stage.stage_01" });
  assert.equal(frame.value.state.status, "stageCleared");
  assert.equal(frame.value.state.score, 100);
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
  ]);
});

test("resolves enemy bullet player collision in the core tick", () => {
  const loaded = createShootingCore("0.0.0").load(createEnemyBulletHitDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const frame = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);
  if (!frame.ok) {
    assert.fail("expected player hit frame");
  }

  assert.deepEqual(frame.value.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerHit",
    "entityDestroyed",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame.value.events[3], {
    type: "playerHit",
    tick: 0,
    playerId: "player.default",
    sourceEntityId: 3,
    sourceEntityKind: "enemyBullet",
    livesRemaining: 2,
    invincibleTicksRemaining: 120,
  });
  assert.deepEqual(frame.value.events[4], {
    type: "entityDestroyed",
    tick: 0,
    entityId: 3,
    entityKind: "enemyBullet",
    reason: "collision",
  });
  assert.deepEqual(frame.value.state.player, {
    lives: 2,
    invincibleTicksRemaining: 120,
  });
  assert.deepEqual(frame.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: 392 },
    },
  ]);

  const nextFrame = started.value.tick(createEmptyInputFrame(1));
  assert.equal(nextFrame.ok, true);
  if (!nextFrame.ok) {
    assert.fail("expected committed player hit state");
  }
  assert.deepEqual(nextFrame.value.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(nextFrame.value.state.player, {
    lives: 2,
    invincibleTicksRemaining: 119,
  });
  assert.deepEqual(nextFrame.value.state.entities.map((entity) => entity.kind), ["player", "enemy"]);
});
