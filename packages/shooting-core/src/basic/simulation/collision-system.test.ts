import assert from "node:assert/strict";
import test from "node:test";

import type { EnemyBulletRuntimeEntity } from "../entities/enemy-bullet/model.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { PlayerShotRuntimeEntity } from "../entities/player-shot/model.ts";
import type { PlayerRuntimeEntity } from "../entities/player/model.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import { resolveCollisionAndScoring } from "./collision-system.ts";
import { createPathRunnerState } from "./path-runner.ts";
import { XorShift32 } from "./prng.ts";

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

  // broad phase を通過した組は、自機と敵弾 3 / 9、shot 7 と enemy 2 / 8 の 4 組。
  assert.equal(result.collisionCandidates, 4);
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

test("resolves the same hits through the broad phase grid as a full scan of dense random scenes", () => {
  const prng = new XorShift32("collision-full-scan");
  const random = (min: number, max: number) => min + (prng.nextUint32() / 0x1_0000_0000) * (max - min);
  const totals = { playerHits: 0, shotHits: 0, defeated: 0 };
  for (let round = 0; round < 60; round += 1) {
    const player = createPlayer({ id: 1, position: { x: random(0, 384), y: random(0, 448) } });
    let id = 2;
    const cluster = () => ({ x: player.position.x + random(-60, 60), y: player.position.y + random(-60, 60) });
    const enemies = Array.from({ length: 12 }, () => createEnemy({ id: id++, hp: random(1, 12), position: cluster() }));
    const bullets = Array.from({ length: 40 }, () => createEnemyBullet({ id: id++, position: round % 3 === 0 ? cluster() : { x: random(-40, 424), y: random(-40, 488) } }));
    const shots = Array.from({ length: 20 }, () => createPlayerShot({ id: id++, damage: random(1, 6), position: cluster() }));
    const entities = [player, ...enemies, ...bullets, ...shots];

    const result = resolveCollisionAndScoring(entities, { playerInvincibleTicksAfterHit: 120, score: 0, tick: round });
    const expected = resolveByFullScan(player, enemies, bullets, shots);
    totals.playerHits += expected.hitSourceId === null ? 0 : 1;
    totals.shotHits += expected.destroyedShotIds.length;
    totals.defeated += expected.defeatedEnemyIds.length;
    const playerHit = result.events.find((event) => event.type === "playerHit");
    assert.equal(playerHit?.type === "playerHit" ? playerHit.sourceEntityId : null, expected.hitSourceId, `round ${round}`);
    assert.deepEqual(
      result.events.flatMap((event) => event.type === "entityDestroyed" && event.entityKind === "playerShot" ? [event.entityId] : []),
      expected.destroyedShotIds,
      `round ${round}`,
    );
    assert.deepEqual(
      result.events.flatMap((event) => event.type === "entityDestroyed" && event.entityKind === "enemy" ? [event.entityId] : []),
      expected.defeatedEnemyIds,
      `round ${round}`,
    );
    assert.deepEqual(
      result.entities.flatMap((entity) => entity.kind === "enemy" ? [[entity.id, entity.hp]] : []),
      expected.survivingEnemyHp,
      `round ${round}`,
    );
  }
  assert.ok(totals.playerHits > 10 && totals.shotHits > 100 && totals.defeated > 50, JSON.stringify(totals));
});

/** broad phase を使わず、id 昇順の全探索で design 13 の解決順をたどる test 用の参照実装。 */
function resolveByFullScan(
  player: PlayerRuntimeEntity,
  enemies: readonly EnemyRuntimeEntity[],
  bullets: readonly EnemyBulletRuntimeEntity[],
  shots: readonly PlayerShotRuntimeEntity[],
) {
  const overlaps = (left: RuntimeEntityState, right: RuntimeEntityState) => {
    const dx = left.position.x - right.position.x;
    const dy = left.position.y - right.position.y;
    const radius = left.collisionRadius + right.collisionRadius;
    return dx * dx + dy * dy <= radius * radius;
  };
  const byId = <T extends RuntimeEntityState>(entities: readonly T[]) => [...entities].sort((left, right) => left.id - right.id);
  const hitSourceId = byId(bullets).find((bullet) => overlaps(player, bullet))?.id
    ?? byId(enemies).find((enemy) => overlaps(player, enemy))?.id
    ?? null;
  const hp = new Map(enemies.map((enemy) => [enemy.id, enemy.hp]));
  const destroyedShotIds: number[] = [];
  const defeatedEnemyIds: number[] = [];
  for (const shot of byId(shots)) {
    const enemy = byId(enemies).find((candidate) => hp.get(candidate.id)! > 0 && overlaps(shot, candidate));
    if (!enemy) {
      continue;
    }
    destroyedShotIds.push(shot.id);
    hp.set(enemy.id, hp.get(enemy.id)! - shot.damage);
    if (hp.get(enemy.id)! <= 0) {
      defeatedEnemyIds.push(enemy.id);
    }
  }
  return {
    hitSourceId,
    destroyedShotIds,
    defeatedEnemyIds,
    survivingEnemyHp: byId(enemies).flatMap((enemy) => hp.get(enemy.id)! > 0 ? [[enemy.id, hp.get(enemy.id)!]] : []),
  };
}

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
    pathRunnerState: createPathRunnerState(options.position),
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
    velocity: Object.freeze({ x: 0, y: 0 }),
    spawnPosition: Object.freeze({ x: options.position.x, y: options.position.y }),
    ageTicks: 1,
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
