import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { GameDefinition } from "../content/types.ts";
import { createShootingCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { createCollisionScoreDefinition, createFireOnSpawnAtZeroDefinition } from "../test-support/definitions.ts";
import { createShotInputFrame } from "../test-support/input-frames.ts";
import { startMinimumStage, startStageFromDefinition } from "../test-support/stage-harness.ts";

test("serializes initial stage state with metadata and pending startup event", () => {
  const loaded = createShootingCore("core.test").load(createMinimumDefinition());
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

  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.deepEqual(serialized.value, {
    coreVersion: "core.test",
    schemaVersion: "1",
    contentVersion: "shooting-sample@content.0",
    inputFormatVersion: "1",
    stateHashVersion: 1,
    enabledFeatures: [],
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.default",
    expectedTick: 0,
    nextEntityId: 2,
    prngState: { state: 3597787782 },
    state: {
      runtimeEntities: [{
        id: 1,
        kind: "player",
        definitionId: "player.default",
        position: { x: 192, y: 400 },
        collisionRadius: 3,
        lives: 3,
        invincibleTicksRemaining: 0,
        nextShotAllowedTick: 0,
        movement: { speed: 4, focusSpeed: 1.8 },
        shotDefinitionId: "playerShot.basic",
      }],
      pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
      score: 0,
      timelineCursor: 0,
      patternRunnerStates: [],
      enabledFeatureStates: [],
    },
  });
  assert.equal(Object.isFrozen(serialized.value), true);
  assert.equal(Object.isFrozen(serialized.value.state), true);
  assert.equal(Object.isFrozen(serialized.value.enabledFeatures), true);
  assert.equal(Object.isFrozen(serialized.value.prngState), true);
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities), true);
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities[0]), true);
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities[0]!.position), true);
  assert.equal(Object.isFrozen(serialized.value.state.pendingEvents), true);
  assert.equal(Object.isFrozen(serialized.value.state.pendingEvents[0]), true);
  assert.equal(Object.isFrozen(serialized.value.state.patternRunnerStates), true);
  assert.equal(Object.isFrozen(serialized.value.state.enabledFeatureStates), true);
  if (serialized.value.state.runtimeEntities[0]?.kind !== "player") {
    assert.fail("expected serialized player entity");
  }
  assert.equal(Object.isFrozen(serialized.value.state.runtimeEntities[0].movement), true);

  const frameAfterSerialize = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frameAfterSerialize.ok, true);
  assert.deepEqual(frameAfterSerialize.ok && frameAfterSerialize.value.events.map((event) => event.type), [
    "stageStarted",
    "tickAdvanced",
  ]);
});

test("serializes runtime entities after tick without drained frame events", () => {
  const started = startMinimumStage();
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.expectedTick, 1);
  assert.equal(serialized.value.nextEntityId, 3);
  assert.equal(serialized.value.prngState.state, 2919998806);
  assert.deepEqual(serialized.value.state.pendingEvents, []);
  assert.deepEqual(serialized.value.state.runtimeEntities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      nextShotAllowedTick: 3,
      movement: { speed: 4, focusSpeed: 1.8 },
      shotDefinitionId: "playerShot.basic",
    },
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
      collisionRadius: 5,
      velocity: { x: 0, y: -8 },
      remainingLifetimeTicks: 3,
      damage: 5,
    },
  ]);
});

test("serializes selected player and difficulty metadata", () => {
  const loaded = createShootingCore("core.test").load(createAlternatePlayerHardDifficultyDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "hard",
    playerId: "player.alt",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  const serialized = started.value.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.difficulty, "hard");
  assert.equal(serialized.value.playerId, "player.alt");
  assert.deepEqual(serialized.value.state.runtimeEntities[0], {
    id: 1,
    kind: "player",
    definitionId: "player.alt",
    position: { x: 192, y: 400 },
    collisionRadius: 2,
    lives: 5,
    invincibleTicksRemaining: 0,
    nextShotAllowedTick: 0,
    movement: { speed: 5, focusSpeed: 2 },
    shotDefinitionId: "playerShot.basic",
  });
});

test("serializes enemy and enemy bullet runtime entities", () => {
  const started = startStageFromDefinition(createFireOnSpawnAtZeroDefinition());
  const frame = started.tick(createEmptyInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  assert.deepEqual(serialized.value.state.runtimeEntities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      nextShotAllowedTick: 0,
      movement: { speed: 4, focusSpeed: 1.8 },
      shotDefinitionId: "playerShot.basic",
    },
    {
      id: 2,
      kind: "enemy",
      definitionId: "enemy.scout",
      position: { x: 192, y: 80 },
      collisionRadius: 12,
      hp: 10,
      scoreOnKill: 100,
      pathId: "path.none",
      patternId: "pattern.spawn_bullet",
    },
    {
      id: 3,
      kind: "enemyBullet",
      definitionId: "bullet.red_small",
      position: { x: 192, y: 88 },
      collisionRadius: 4,
    },
  ]);
});

test("serializes updated score and timeline cursor after collision scoring", () => {
  const started = startStageFromDefinition(createCollisionScoreDefinition());
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);

  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }
  assert.equal(serialized.value.expectedTick, 1);
  assert.equal(serialized.value.state.score, 100);
  assert.equal(serialized.value.state.timelineCursor, 1);
  assert.deepEqual(serialized.value.state.runtimeEntities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
      collisionRadius: 3,
      lives: 3,
      invincibleTicksRemaining: 0,
      nextShotAllowedTick: 3,
      movement: { speed: 4, focusSpeed: 1.8 },
      shotDefinitionId: "playerShot.basic",
    },
  ]);
});

test("returns immutable serialized snapshots independent from caller-owned clones", () => {
  const started = startMinimumStage();
  const first = started.serialize();
  assert.equal(first.ok, true);
  if (!first.ok) {
    assert.fail("expected serialized state");
  }

  assert.throws(
    () => (first.value.state.runtimeEntities as unknown as unknown[]).push({}),
    TypeError,
  );
  assert.throws(
    () => (first.value.state.patternRunnerStates as unknown as unknown[]).push({}),
    TypeError,
  );
  assert.throws(
    () => (first.value.state.enabledFeatureStates as unknown as unknown[]).push({}),
    TypeError,
  );
  assert.throws(
    () => ((first.value.prngState as unknown as { state: number }).state = 0),
    TypeError,
  );
  assert.throws(
    () => ((first.value.state.pendingEvents[0] as unknown as { stageId: string }).stageId = "stage.changed"),
    TypeError,
  );
  const serializedPlayer = first.value.state.runtimeEntities[0];
  assert.equal(serializedPlayer?.kind, "player");
  if (serializedPlayer?.kind !== "player") {
    assert.fail("expected serialized player entity");
  }
  assert.throws(
    () => ((serializedPlayer.position as unknown as { x: number }).x = 0),
    TypeError,
  );
  assert.throws(
    () => ((serializedPlayer.movement as unknown as { speed: number }).speed = 0),
    TypeError,
  );

  const mutableClone = JSON.parse(JSON.stringify(first.value)) as {
    state: { runtimeEntities: Array<{ position: { x: number } }> };
  };
  mutableClone.state.runtimeEntities[0]!.position.x = 0;

  const second = started.serialize();
  assert.equal(second.ok, true);
  assert.deepEqual(second.ok && second.value, first.value);
});

function createAlternatePlayerHardDifficultyDefinition(): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      assetKeys: {
        keys: [
          ...definition.content.assetKeys.keys,
          "player.alt",
        ],
      },
      players: [
        ...definition.content.players,
        {
          id: "player.alt",
          version: 1,
          asset: "player.alt",
          movement: { speed: 5, focusSpeed: 2 },
          collision: { radius: 2 },
          life: { initialLives: 5, invincibleTicksAfterHit: 90 },
          shot: { definition: "playerShot.basic" },
        },
      ],
      stages: [{
        ...definition.content.stages[0]!,
        difficulties: ["normal", "hard"],
      }],
    },
  };
}
