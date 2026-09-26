import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "../../content/types.ts";
import { createShootingCore } from "../../core.ts";
import { createEmptyInputFrame } from "../../input/input-frame.ts";
import type { CoreErrorCode } from "../../result.ts";
import {
  createFireOnSpawnAtZeroDefinition,
  createFutureTimelineAfterRestoreDefinition,
} from "../../test-support/definitions.ts";
import { createShotInputFrame } from "../../test-support/input-frames.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../../test-support/stage-harness.ts";
import type { SerializedGameState } from "../types.ts";

test("restore validates each runtime entity kind before accepting a session", () => {
  const definition = createFireOnSpawnAtZeroDefinition();
  const loaded = createShootingCore("core.test").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  const validRestore = loaded.value.restore(serialized.value);
  assert.equal(validRestore.ok, true);
  if (!validRestore.ok) {
    assert.fail("expected valid restore");
  }
  assert.deepEqual(validRestore.value.serialize(), serialized);

  const enemy = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "enemy");
  const enemyBullet = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "enemyBullet");
  const player = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "player");
  const playerShot = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "playerShot");
  assert.equal(enemy?.kind, "enemy");
  assert.equal(enemyBullet?.kind, "enemyBullet");
  assert.equal(player?.kind, "player");
  assert.equal(playerShot?.kind, "playerShot");
  if (enemy?.kind !== "enemy" || enemyBullet?.kind !== "enemyBullet" || player?.kind !== "player" || playerShot?.kind !== "playerShot") {
    assert.fail("expected player, enemy, enemy bullet, and player shot entities");
  }

  const expectRestoreError = (runtimeEntity: Record<string, unknown>, code: CoreErrorCode, detail: RegExp) => {
    const restored = loaded.value.restore({
      ...serialized.value,
      state: {
        ...serialized.value.state,
        runtimeEntities: serialized.value.state.runtimeEntities.map((entity) => (
          entity.id === runtimeEntity.id ? runtimeEntity : entity
        )),
      },
    } as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, code);
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectRestoreError({ ...enemy, projectile: {} }, "state.invalidShape", /unknown fields/);
  expectRestoreError({ ...enemy, definitionId: "enemy.missing" }, "state.registryInvalid", /enemy/);
  expectRestoreError({ ...enemy, definitionId: "not-an-enemy-id" }, "state.invalidShape", /enemy id/);
  expectRestoreError({ ...enemy, pathId: 1 }, "state.invalidShape", /pathId/);
  expectRestoreError({ ...enemy, pathId: "not-a-path-id" }, "state.invalidShape", /path id/);
  expectRestoreError({ ...enemy, pathId: "path.missing" }, "state.registryInvalid", /path/);
  expectRestoreError({ ...enemy, patternId: "not-a-pattern-id" }, "state.invalidShape", /pattern id/);
  expectRestoreError({ ...enemy, patternId: "pattern.missing" }, "state.registryInvalid", /pattern/);
  expectRestoreError({ ...enemy, hp: -1 }, "state.invalidShape", /hp/);
  expectRestoreError({ ...enemy, hp: Number.NaN }, "state.invalidShape", /hp/);
  expectRestoreError({ ...enemy, hp: 11 }, "state.invalidShape", /enemy runtime entity/);
  expectRestoreError({ ...enemy, scoreOnKill: -1 }, "state.invalidShape", /scoreOnKill/);
  expectRestoreError({ ...enemy, scoreOnKill: 1.5 }, "state.invalidShape", /scoreOnKill/);
  expectRestoreError({ ...enemy, scoreOnKill: 101 }, "state.invalidShape", /enemy runtime entity/);
  expectRestoreError({ ...enemy, collisionRadius: 13 }, "state.invalidShape", /enemy runtime entity/);
  expectRestoreError({ ...enemy, position: { x: 193, y: 80 } }, "state.invalidShape", /processed timeline/);
  const throwingEnemyPosition = new Proxy({ x: 192, y: 80 }, {
    get() {
      throw new Error("enemy position should be descriptor-cloned");
    },
  });
  const restoredWithThrowingEnemyPosition = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: serialized.value.state.runtimeEntities.map((entity) => (
        entity.id === enemy.id ? { ...enemy, position: throwingEnemyPosition } : entity
      )),
    },
  } as SerializedGameState);
  assert.equal(restoredWithThrowingEnemyPosition.ok, true);
  if (!restoredWithThrowingEnemyPosition.ok) {
    assert.fail("expected descriptor-cloned enemy position proxy to restore");
  }
  assert.deepEqual(restoredWithThrowingEnemyPosition.value.serialize(), serialized);

  expectRestoreError({ ...player, position: { x: 385, y: 400 } }, "state.invalidShape", /playfield/);
  expectRestoreError({ ...player, lives: 4 }, "state.invalidShape", /counters/);
  expectRestoreError({ ...player, invincibleTicksRemaining: 121 }, "state.invalidShape", /counters/);
  expectRestoreError({ ...player, nextShotAllowedTick: 61 }, "state.invalidShape", /counters/);

  expectRestoreError({ ...enemyBullet, projectile: {} }, "state.invalidShape", /unknown fields/);
  expectRestoreError({ ...enemyBullet, definitionId: "bullet.missing" }, "state.registryInvalid", /bullet/);
  expectRestoreError({ ...enemyBullet, definitionId: "not-a-bullet-id" }, "state.invalidShape", /bullet id/);
  expectRestoreError({ ...enemyBullet, collisionRadius: 5 }, "state.invalidShape", /bullet definition/);
  expectRestoreError({ ...enemyBullet, position: { x: 192, y: 89 } }, "state.invalidShape", /processed timeline/);

  expectRestoreError({ ...playerShot, owner: "player" }, "state.invalidShape", /unknown fields/);
  expectRestoreError({ ...playerShot, definitionId: "playerShot.missing" }, "state.registryInvalid", /player shot/);
  expectRestoreError({ ...playerShot, definitionId: "not-a-player-shot-id" }, "state.invalidShape", /playerShot id/);
  expectRestoreError({ ...playerShot, velocity: { x: 65, y: -8 } }, "state.invalidShape", /velocity/);
  expectRestoreError({ ...playerShot, velocity: { x: 0, y: -7 } }, "state.invalidShape", /player shot definition/);
  expectRestoreError({ ...playerShot, remainingLifetimeTicks: 0 }, "state.invalidShape", /remainingLifetimeTicks/);
  expectRestoreError({ ...playerShot, remainingLifetimeTicks: 4 }, "state.invalidShape", /player shot definition/);
  expectRestoreError({ ...playerShot, damage: 0 }, "state.invalidShape", /damage/);
  expectRestoreError({ ...playerShot, damage: 6 }, "state.invalidShape", /player shot definition/);

  expectRestoreError({ ...enemy, hp: 0 }, "state.invalidShape", /hp/);

  const expectEntityOrderError = (runtimeEntities: typeof serialized.value.state.runtimeEntities) => {
    const restored = loaded.value.restore({
      ...serialized.value,
      state: {
        ...serialized.value.state,
        runtimeEntities,
      },
    });
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", /below nextEntityId/);
  };
  const restoredWithShiftedPlayerId = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: serialized.value.state.runtimeEntities.map((entity) => (
        entity.kind === "player" ? { ...entity, id: 2 } : entity
      )),
    },
  });
  assert.equal(restoredWithShiftedPlayerId.ok, false);
  assert.equal(!restoredWithShiftedPlayerId.ok && restoredWithShiftedPlayerId.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithShiftedPlayerId.ok ? restoredWithShiftedPlayerId.errors[0]?.message ?? "" : "", /initial entity id/);
  const restoredWithoutPlayer = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: serialized.value.state.runtimeEntities.filter((entity) => entity.kind !== "player"),
    },
  });
  assert.equal(restoredWithoutPlayer.ok, false);
  assert.equal(!restoredWithoutPlayer.ok && restoredWithoutPlayer.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithoutPlayer.ok ? restoredWithoutPlayer.errors[0]?.message ?? "" : "", /player matching playerId/);
  const duplicateEnemyBullet = {
    ...enemyBullet,
    id: serialized.value.nextEntityId,
  };
  const restoredWithExtraEnemyBullet = loaded.value.restore({
    ...serialized.value,
    nextEntityId: serialized.value.nextEntityId + 1,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        ...serialized.value.state.runtimeEntities,
        duplicateEnemyBullet,
      ],
    },
  });
  assert.equal(restoredWithExtraEnemyBullet.ok, false);
  assert.equal(!restoredWithExtraEnemyBullet.ok && restoredWithExtraEnemyBullet.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithExtraEnemyBullet.ok ? restoredWithExtraEnemyBullet.errors[0]?.message ?? "" : "", /allocation envelope/);
  const restoredWithDuplicateEnemyBullet = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        serialized.value.state.runtimeEntities[0]!,
        enemy,
        enemyBullet,
        { ...enemyBullet, id: 4 },
      ],
    },
  } as SerializedGameState);
  assert.equal(restoredWithDuplicateEnemyBullet.ok, false);
  assert.equal(!restoredWithDuplicateEnemyBullet.ok && restoredWithDuplicateEnemyBullet.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithDuplicateEnemyBullet.ok ? restoredWithDuplicateEnemyBullet.errors[0]?.message ?? "" : "", /enemy bullet runtime entity/);
  const restoredWithExtraEnemy = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        serialized.value.state.runtimeEntities[0]!,
        enemy,
        { ...enemy, id: 3 },
        { ...enemyBullet, id: 4 },
      ],
    },
  } as SerializedGameState);
  assert.equal(restoredWithExtraEnemy.ok, false);
  assert.equal(!restoredWithExtraEnemy.ok && restoredWithExtraEnemy.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithExtraEnemy.ok ? restoredWithExtraEnemy.errors[0]?.message ?? "" : "", /enemy runtime entity/);
  const restoredWithInflatedNextEntityId = loaded.value.restore({
    ...serialized.value,
    nextEntityId: serialized.value.nextEntityId + 10,
  });
  assert.equal(restoredWithInflatedNextEntityId.ok, false);
  assert.equal(!restoredWithInflatedNextEntityId.ok && restoredWithInflatedNextEntityId.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithInflatedNextEntityId.ok ? restoredWithInflatedNextEntityId.errors[0]?.message ?? "" : "", /allocation envelope/);
  const restoredWithSwappedBulletShotIds = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: [
        serialized.value.state.runtimeEntities[0]!,
        enemy,
        { ...playerShot, id: enemyBullet.id },
        { ...enemyBullet, id: playerShot.id },
      ],
    },
  } as SerializedGameState);
  assert.equal(restoredWithSwappedBulletShotIds.ok, false);
  assert.equal(!restoredWithSwappedBulletShotIds.ok && restoredWithSwappedBulletShotIds.errors[0]?.code, "state.invalidShape");
  assert.match(!restoredWithSwappedBulletShotIds.ok ? restoredWithSwappedBulletShotIds.errors[0]?.message ?? "" : "", /player shot id/);
  expectEntityOrderError(serialized.value.state.runtimeEntities.map((entity) => (
    entity.id === enemy.id ? { ...entity, id: serialized.value.nextEntityId } : entity
  )));
  expectEntityOrderError(serialized.value.state.runtimeEntities.map((entity) => (
    entity.id === enemy.id ? { ...entity, id: enemyBullet.id } : entity
  )));
  expectEntityOrderError([
    ...serialized.value.state.runtimeEntities.slice(0, 1),
    serialized.value.state.runtimeEntities[2]!,
    serialized.value.state.runtimeEntities[1]!,
    ...serialized.value.state.runtimeEntities.slice(3),
  ]);
});

test("restore rejects same-tick allocation order spoofing", () => {
  const definition = createDoubleFireOnSpawnAtZeroDefinition();
  const loaded = createShootingCore("core.test").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);
  const frame = started.tick(createShotInputFrame(0));
  assert.equal(frame.ok, true);
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  const enemies = serialized.value.state.runtimeEntities.filter((entity) => entity.kind === "enemy");
  const enemyBullets = serialized.value.state.runtimeEntities.filter((entity) => entity.kind === "enemyBullet");
  const playerShot = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "playerShot");
  assert.equal(enemies.length, 2);
  assert.equal(enemyBullets.length, 2);
  assert.equal(playerShot?.kind, "playerShot");
  const [firstEnemy, secondEnemy] = enemies;
  const [firstBullet, secondBullet] = enemyBullets;
  if (
    firstEnemy?.kind !== "enemy"
    || secondEnemy?.kind !== "enemy"
    || firstBullet?.kind !== "enemyBullet"
    || secondBullet?.kind !== "enemyBullet"
    || playerShot?.kind !== "playerShot"
  ) {
    assert.fail("expected two enemies, two enemy bullets, and one player shot");
  }
  const validRestore = loaded.value.restore(serialized.value);
  assert.equal(validRestore.ok, true);
  if (!validRestore.ok) {
    assert.fail("expected valid double-spawn snapshot to restore");
  }
  assert.deepEqual(assertSerializeOk(validRestore.value.serialize(), "valid double-spawn restore"), serialized.value);

  const restoreWithEntities = (runtimeEntities: typeof serialized.value.state.runtimeEntities) => loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities,
    },
  } as SerializedGameState);
  const expectAllocationOrderError = (
    runtimeEntities: typeof serialized.value.state.runtimeEntities,
    messagePattern: RegExp,
  ) => {
    const restored = restoreWithEntities(runtimeEntities);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", messagePattern);
  };

  const swappedEnemyIds = serialized.value.state.runtimeEntities.map((entity) => {
    if (entity.id === firstEnemy.id) {
      return { ...secondEnemy, id: firstEnemy.id };
    }
    if (entity.id === secondEnemy.id) {
      return { ...firstEnemy, id: secondEnemy.id };
    }
    return entity;
  });
  expectAllocationOrderError(swappedEnemyIds, /enemy runtime entity ids/);

  const swappedEnemyBulletIds = serialized.value.state.runtimeEntities.map((entity) => {
    if (entity.id === firstBullet.id) {
      return { ...secondBullet, id: firstBullet.id };
    }
    if (entity.id === secondBullet.id) {
      return { ...firstBullet, id: secondBullet.id };
    }
    return entity;
  });
  expectAllocationOrderError(swappedEnemyBulletIds, /enemy bullet runtime entity ids/);

  const enemyBeforeBulletOrderSpoof = [
    serialized.value.state.runtimeEntities[0]!,
    firstEnemy,
    { ...firstBullet, id: secondEnemy.id },
    { ...secondEnemy, id: firstBullet.id },
    secondBullet,
    playerShot,
  ];
  expectAllocationOrderError(enemyBeforeBulletOrderSpoof, /enemy bullet id/);
});

test("restore rejects cross-tick allocation order spoofing", () => {
  const definition = createFutureTimelineAfterRestoreDefinition();
  const loaded = createShootingCore("core.test").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  const started = startStageFromLoadedGame(loaded.value);
  assertTickOk(started.tick(createShotInputFrame(0)), "shot tick");
  assertTickOk(started.tick(createEmptyInputFrame(1)), "advance before future spawn");
  assertTickOk(started.tick(createEmptyInputFrame(2)), "future spawn tick");
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized cross-tick state");
  }

  const validRestore = loaded.value.restore(serialized.value);
  assert.equal(validRestore.ok, true);
  if (!validRestore.ok) {
    assert.fail("expected valid cross-tick snapshot to restore");
  }
  assert.deepEqual(assertSerializeOk(validRestore.value.serialize(), "valid cross-tick restore"), serialized.value);

  const playerShot = serialized.value.state.runtimeEntities.find((entity) => entity.kind === "playerShot");
  const futureEnemy = serialized.value.state.runtimeEntities.find((entity) => (
    entity.kind === "enemy" && entity.position.x === 128 && entity.position.y === 96
  ));
  assert.equal(playerShot?.kind, "playerShot");
  assert.equal(futureEnemy?.kind, "enemy");
  if (playerShot?.kind !== "playerShot" || futureEnemy?.kind !== "enemy") {
    assert.fail("expected earlier player shot and later enemy");
  }

  const crossTickOrderSpoof = serialized.value.state.runtimeEntities.map((entity) => {
    if (entity.id === playerShot.id) {
      return { ...futureEnemy, id: playerShot.id };
    }
    if (entity.id === futureEnemy.id) {
      return { ...playerShot, id: futureEnemy.id };
    }
    return entity;
  });
  const restored = loaded.value.restore({
    ...serialized.value,
    state: {
      ...serialized.value.state,
      runtimeEntities: crossTickOrderSpoof,
    },
  } as SerializedGameState);
  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
  assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", /allocation order across ticks/);
});

function createDoubleFireOnSpawnAtZeroDefinition(): GameDefinition {
  const definition = createFireOnSpawnAtZeroDefinition();
  return {
    ...definition,
    content: {
      ...definition.content,
      stages: [{
        ...definition.content.stages[0]!,
        timeline: [
          definition.content.stages[0]!.timeline[0]!,
          {
            tick: 0,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.spawn_bullet",
              position: { x: 128, y: 96 },
            },
          },
        ],
      }],
    },
  };
}
