import assert from "node:assert/strict";
import test from "node:test";

import { resolveCollisionAndScoring } from "./collision-system.ts";
import type {
  EnemyBulletRuntimeEntity,
  EnemyRuntimeEntity,
  PlayerRuntimeEntity,
  PlayerShotRuntimeEntity,
  RuntimeEntityState,
} from "./runtime-entity.ts";

test("resolves player hit by enemy bullet before player shot damage", () => {
  const result = resolveCollisionAndScoring(
    [
      createPlayer({ id: 1, position: { x: 100, y: 100 } }),
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
      createEnemyBullet({ id: 3, position: { x: 100, y: 100 } }),
      createPlayerShot({ id: 4, position: { x: 100, y: 100 }, damage: 10 }),
    ],
    { collectMetrics: true, playerInvincibleTicksAfterHit: 120, score: 0, tick: 7 },
  );

  assert.equal(result.collisionCandidates, 2);
  assert.deepEqual(result.events, [
    {
      type: "playerHit",
      tick: 7,
      playerId: "player.default",
      sourceEntityId: 3,
      sourceEntityKind: "enemyBullet",
      livesRemaining: 2,
      invincibleTicksRemaining: 120,
    },
    {
      type: "entityDestroyed",
      tick: 7,
      entityId: 3,
      entityKind: "enemyBullet",
      reason: "collision",
    },
    {
      type: "entityDestroyed",
      tick: 7,
      entityId: 4,
      entityKind: "playerShot",
      reason: "collision",
    },
    {
      type: "entityDestroyed",
      tick: 7,
      entityId: 2,
      entityKind: "enemy",
      reason: "defeated",
    },
    {
      type: "scoreChanged",
      tick: 7,
      delta: 100,
      total: 100,
      reason: "enemyDefeated",
      enemyId: "enemy.scout",
      entityId: 2,
    },
  ]);
  assert.equal(result.score, 100);
  assert.deepEqual(result.entities, [
    {
      ...createPlayer({ id: 1, position: { x: 100, y: 100 } }),
      lives: 2,
      invincibleTicksRemaining: 120,
    },
  ]);
});

test("uses enemy contact as the player hit source when no bullet hit exists", () => {
  const result = resolveCollisionAndScoring(
    [
      createPlayer({ id: 1, position: { x: 100, y: 100 } }),
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
    ],
    { collectMetrics: true, playerInvincibleTicksAfterHit: 60, score: 0, tick: 3 },
  );

  assert.equal(result.collisionCandidates, 1);
  assert.deepEqual(result.events, [
    {
      type: "playerHit",
      tick: 3,
      playerId: "player.default",
      sourceEntityId: 2,
      sourceEntityKind: "enemy",
      livesRemaining: 2,
      invincibleTicksRemaining: 60,
    },
  ]);
  assert.deepEqual(result.entities.map((entity) => entity.kind), ["player", "enemy"]);
});

test("applies non-lethal player shot damage and destroys the shot", () => {
  const result = resolveCollisionAndScoring(
    [
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
      createPlayerShot({ id: 4, position: { x: 100, y: 100 }, damage: 5 }),
    ],
    { playerInvincibleTicksAfterHit: 120, score: 20, tick: 1 },
  );

  assert.deepEqual(result.events, [
    {
      type: "entityDestroyed",
      tick: 1,
      entityId: 4,
      entityKind: "playerShot",
      reason: "collision",
    },
  ]);
  assert.equal(result.score, 20);
  assert.deepEqual(result.entities, [
    {
      ...createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
      hp: 5,
    },
  ]);
});

test("accumulates same-tick player shot damage and scores a defeated enemy once", () => {
  const result = resolveCollisionAndScoring(
    [
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
      createPlayerShot({ id: 4, position: { x: 100, y: 100 }, damage: 5 }),
      createPlayerShot({ id: 5, position: { x: 100, y: 100 }, damage: 5 }),
    ],
    { playerInvincibleTicksAfterHit: 120, score: 0, tick: 2 },
  );

  assert.deepEqual(result.events, [
    {
      type: "entityDestroyed",
      tick: 2,
      entityId: 4,
      entityKind: "playerShot",
      reason: "collision",
    },
    {
      type: "entityDestroyed",
      tick: 2,
      entityId: 5,
      entityKind: "playerShot",
      reason: "collision",
    },
    {
      type: "entityDestroyed",
      tick: 2,
      entityId: 2,
      entityKind: "enemy",
      reason: "defeated",
    },
    {
      type: "scoreChanged",
      tick: 2,
      delta: 100,
      total: 100,
      reason: "enemyDefeated",
      enemyId: "enemy.scout",
      entityId: 2,
    },
  ]);
  assert.equal(result.score, 100);
  assert.deepEqual(result.entities, []);
});

test("does not hit an already defeated enemy with later same-tick player shots", () => {
  const result = resolveCollisionAndScoring(
    [
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 5 }),
      createPlayerShot({ id: 4, position: { x: 100, y: 100 }, damage: 10 }),
      createPlayerShot({ id: 5, position: { x: 100, y: 100 }, damage: 10 }),
    ],
    { playerInvincibleTicksAfterHit: 120, score: 0, tick: 2 },
  );

  assert.deepEqual(result.events, [
    {
      type: "entityDestroyed",
      tick: 2,
      entityId: 4,
      entityKind: "playerShot",
      reason: "collision",
    },
    {
      type: "entityDestroyed",
      tick: 2,
      entityId: 2,
      entityKind: "enemy",
      reason: "defeated",
    },
    {
      type: "scoreChanged",
      tick: 2,
      delta: 100,
      total: 100,
      reason: "enemyDefeated",
      enemyId: "enemy.scout",
      entityId: 2,
    },
  ]);
  assert.equal(result.score, 100);
  assert.deepEqual(result.entities, [
    createPlayerShot({ id: 5, position: { x: 100, y: 100 }, damage: 10 }),
  ]);
});

test("chooses colliding candidates by entity id even when input order is different", () => {
  const result = resolveCollisionAndScoring(
    [
      createEnemyBullet({ id: 9, position: { x: 100, y: 100 } }),
      createPlayer({ id: 1, position: { x: 100, y: 100 } }),
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
      createEnemyBullet({ id: 3, position: { x: 100, y: 100 } }),
      createEnemy({ id: 8, position: { x: 100, y: 100 }, hp: 10 }),
      createPlayerShot({ id: 7, position: { x: 100, y: 100 }, damage: 10 }),
    ],
    { collectMetrics: true, playerInvincibleTicksAfterHit: 120, score: 0, tick: 4 },
  );

  assert.equal(result.collisionCandidates, 2);
  assert.deepEqual(result.events.map((event) => event.type), [
    "playerHit",
    "entityDestroyed",
    "entityDestroyed",
    "entityDestroyed",
    "scoreChanged",
  ]);
  assert.deepEqual(result.events[0], {
    type: "playerHit",
    tick: 4,
    playerId: "player.default",
    sourceEntityId: 3,
    sourceEntityKind: "enemyBullet",
    livesRemaining: 2,
    invincibleTicksRemaining: 120,
  });
  assert.deepEqual(result.events[3], {
    type: "entityDestroyed",
    tick: 4,
    entityId: 2,
    entityKind: "enemy",
    reason: "defeated",
  });
});

test("treats touching collision circles as hit and separated circles as no hit", () => {
  const touching = resolveCollisionAndScoring(
    [
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
      createPlayerShot({ id: 4, position: { x: 117, y: 100 }, damage: 10 }),
    ],
    { collectMetrics: true, playerInvincibleTicksAfterHit: 120, score: 0, tick: 5 },
  );
  const separated = resolveCollisionAndScoring(
    [
      createEnemy({ id: 2, position: { x: 100, y: 100 }, hp: 10 }),
      createPlayerShot({ id: 4, position: { x: 117.01, y: 100 }, damage: 10 }),
    ],
    { collectMetrics: true, playerInvincibleTicksAfterHit: 120, score: 0, tick: 5 },
  );

  assert.equal(touching.collisionCandidates, 1);
  assert.equal(separated.collisionCandidates, 1);
  assert.equal(touching.score, 100);
  assert.deepEqual(touching.events.map((event) => event.type), [
    "entityDestroyed",
    "entityDestroyed",
    "scoreChanged",
  ]);
  assert.deepEqual(separated.events, []);
  assert.equal(separated.score, 0);
});

test("ignores player hits while invincible and decrements the timer", () => {
  const result = resolveCollisionAndScoring(
    [
      createPlayer({ id: 1, position: { x: 100, y: 100 }, invincibleTicksRemaining: 2 }),
      createEnemyBullet({ id: 3, position: { x: 100, y: 100 } }),
    ],
    { collectMetrics: true, playerInvincibleTicksAfterHit: 120, score: 0, tick: 10 },
  );

  assert.equal(result.collisionCandidates, 0);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.entities, [
    {
      ...createPlayer({ id: 1, position: { x: 100, y: 100 }, invincibleTicksRemaining: 2 }),
      invincibleTicksRemaining: 1,
    },
    createEnemyBullet({ id: 3, position: { x: 100, y: 100 } }),
  ]);
});

test("keeps the player protected for the final invincibility tick", () => {
  const result = resolveCollisionAndScoring(
    [
      createPlayer({ id: 1, position: { x: 100, y: 100 }, invincibleTicksRemaining: 1 }),
      createEnemyBullet({ id: 3, position: { x: 100, y: 100 } }),
    ],
    { collectMetrics: true, playerInvincibleTicksAfterHit: 120, score: 0, tick: 11 },
  );

  assert.equal(result.collisionCandidates, 0);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.entities, [
    {
      ...createPlayer({ id: 1, position: { x: 100, y: 100 }, invincibleTicksRemaining: 1 }),
      invincibleTicksRemaining: 0,
    },
    createEnemyBullet({ id: 3, position: { x: 100, y: 100 } }),
  ]);
});

test("skips collision candidate counting unless runtime metrics are requested", () => {
  const entities = [
    createPlayer({ id: 1, position: { x: 100, y: 100 } }),
    createEnemyBullet({ id: 3, position: { x: 100, y: 100 } }),
  ];
  const disabled = resolveCollisionAndScoring(
    entities,
    { collectMetrics: false, playerInvincibleTicksAfterHit: 120, score: 0, tick: 12 },
  );
  const omitted = resolveCollisionAndScoring(
    entities,
    { playerInvincibleTicksAfterHit: 120, score: 0, tick: 12 },
  );

  assert.equal(disabled.collisionCandidates, null);
  assert.equal(disabled.events[0]?.type, "playerHit");
  assert.equal(omitted.collisionCandidates, null);
  assert.equal(omitted.events[0]?.type, "playerHit");
});

function createPlayer(options: {
  id: number;
  invincibleTicksRemaining?: number;
  position: { x: number; y: number };
}): PlayerRuntimeEntity {
  return Object.freeze({
    id: options.id,
    kind: "player",
    definitionId: "player.default",
    position: Object.freeze({ x: options.position.x, y: options.position.y }),
    movement: Object.freeze({ speed: 4, focusSpeed: 1.8 }),
    collisionRadius: 3,
    lives: 3,
    invincibleTicksRemaining: options.invincibleTicksRemaining ?? 0,
    shotDefinitionId: "playerShot.basic",
    nextShotAllowedTick: 0,
  });
}

function createEnemy(options: {
  id: number;
  hp: number;
  position: { x: number; y: number };
}): EnemyRuntimeEntity {
  return Object.freeze({
    id: options.id,
    kind: "enemy",
    definitionId: "enemy.scout",
    position: Object.freeze({ x: options.position.x, y: options.position.y }),
    pathId: "path.none",
    patternId: "pattern.none",
    collisionRadius: 12,
    hp: options.hp,
    scoreOnKill: 100,
  });
}

function createEnemyBullet(options: {
  id: number;
  position: { x: number; y: number };
}): EnemyBulletRuntimeEntity {
  return Object.freeze({
    id: options.id,
    kind: "enemyBullet",
    definitionId: "bullet.red_small",
    position: Object.freeze({ x: options.position.x, y: options.position.y }),
    collisionRadius: 4,
  });
}

function createPlayerShot(options: {
  damage: number;
  id: number;
  position: { x: number; y: number };
}): PlayerShotRuntimeEntity {
  return Object.freeze({
    id: options.id,
    kind: "playerShot",
    definitionId: "playerShot.basic",
    position: Object.freeze({ x: options.position.x, y: options.position.y }),
    velocity: Object.freeze({ x: 0, y: -8 }),
    collisionRadius: 5,
    damage: options.damage,
    remainingLifetimeTicks: 3,
  });
}

void (undefined as unknown as RuntimeEntityState);
