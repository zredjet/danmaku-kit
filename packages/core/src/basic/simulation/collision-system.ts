import type { EnemyId } from "../content/types.ts";
import type { GameEvent } from "../events/game-event.ts";
import { CollisionGrid } from "./collision-grid.ts";
import { compareEntityIdAscending } from "./system-order.ts";
import type { EnemyBulletRuntimeEntity } from "../entities/enemy-bullet/model.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { PlayerRuntimeEntity } from "../entities/player/model.ts";
import type { PlayerShotRuntimeEntity } from "../entities/player-shot/model.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";

type CollisionResolutionOptions = Readonly<{
  /** debug serializer を登録した test session だけ true にする。省略時は計測せず hot path に counter を作らない。 */
  collectMetrics?: boolean;
  playerInvincibleTicksAfterHit: number;
  score: number;
  tick: number;
}>;

/** collision / score system が tick へ返す差分。 */
export type CollisionResolutionResult = Readonly<{
  collisionCandidates: number | null;
  entities: readonly RuntimeEntityState[];
  events: readonly GameEvent[];
  score: number;
}>;

/** broad phase を通過した collider の組の数。debug metric としてだけ数える。 */
type CollisionMetrics = {
  candidates: number;
};

type EntityKindDestroyedByCollision = "enemy" | "enemyBullet" | "playerShot";
type EntityDestroyedByCollision = EnemyBulletRuntimeEntity | PlayerShotRuntimeEntity;

/**
 * MVP の collision pair と basic score を deterministic に解決する。
 *
 * 解決順は design の `player hit vs enemy bullet`、`player hit vs enemy contact`、
 * `player shot vs enemy` に固定する。候補は layer ごとの broad phase grid（enemy bullet grid と enemy grid）から entity id 昇順で
 * 取り出し、円判定が成り立つ最初の候補を選ぶ。grid は重なり得る候補を必ず含むため、全探索と同じ組を同じ順で選ぶ。
 */
export function resolveCollisionAndScoring(
  entities: readonly RuntimeEntityState[],
  options: CollisionResolutionOptions,
): CollisionResolutionResult {
  let workingEntities = entities;
  const destroyedEntityIds = new Set<number>();
  const events: GameEvent[] = [];
  const metrics: CollisionMetrics | null = options.collectMetrics === true ? { candidates: 0 } : null;
  let score = options.score;

  // enemy の位置は collision 解決の間に変わらず、hp の変化は player shot の解決側で追う。
  const enemyGrid = new CollisionGrid(getEnemies(workingEntities));
  const player = findPlayer(workingEntities);
  const playerWasInvincibleAtTickStart = Boolean(player && player.invincibleTicksRemaining > 0);
  if (player && player.invincibleTicksRemaining === 0) {
    const bulletGrid = new CollisionGrid(getEnemyBullets(workingEntities));
    const bulletHit = findFirstCollision(player, queryCandidates(bulletGrid, player, metrics));
    if (bulletHit) {
      const hitPlayer = applyPlayerHit(player, options.playerInvincibleTicksAfterHit);
      workingEntities = replaceEntity(workingEntities, hitPlayer);
      destroyedEntityIds.add(bulletHit.id);
      events.push(buildPlayerHitEvent(options.tick, hitPlayer, bulletHit));
      events.push(buildEntityDestroyedEvent(options.tick, bulletHit, "collision"));
    } else {
      const enemyContact = findFirstCollision(player, queryCandidates(enemyGrid, player, metrics));
      if (enemyContact) {
        const hitPlayer = applyPlayerHit(player, options.playerInvincibleTicksAfterHit);
        workingEntities = replaceEntity(workingEntities, hitPlayer);
        events.push(buildPlayerHitEvent(options.tick, hitPlayer, enemyContact));
      }
    }
  }

  if (playerWasInvincibleAtTickStart) {
    workingEntities = decrementPlayerInvincibility(workingEntities);
  }

  const shotHits = resolvePlayerShotEnemyHits(workingEntities, enemyGrid, destroyedEntityIds, metrics);
  for (const hit of shotHits) {
    destroyedEntityIds.add(hit.shot.id);
    events.push(buildEntityDestroyedEvent(options.tick, hit.shot, "collision"));

    if (hit.enemyAfterDamage.hp <= 0) {
      destroyedEntityIds.add(hit.enemy.id);
      score += hit.enemy.scoreOnKill;
      events.push(buildEntityDestroyedEvent(options.tick, hit.enemy, "defeated"));
      events.push(buildScoreChangedEvent(options.tick, hit.enemy, hit.enemy.scoreOnKill, score));
    } else {
      workingEntities = replaceEntity(workingEntities, hit.enemyAfterDamage);
    }
  }

  return Object.freeze({
    collisionCandidates: metrics?.candidates ?? null,
    entities: Object.freeze(workingEntities.filter((entity) => !destroyedEntityIds.has(entity.id))),
    events: Object.freeze(events),
    score,
  });
}

function decrementPlayerInvincibility(entities: readonly RuntimeEntityState[]): readonly RuntimeEntityState[] {
  return Object.freeze(entities.map((entity) => {
    if (entity.kind !== "player" || entity.invincibleTicksRemaining <= 0) {
      return entity;
    }
    return Object.freeze({
      ...entity,
      position: Object.freeze({ x: entity.position.x, y: entity.position.y }),
      movement: Object.freeze({
        speed: entity.movement.speed,
        focusSpeed: entity.movement.focusSpeed,
      }),
      invincibleTicksRemaining: entity.invincibleTicksRemaining - 1,
    });
  }));
}

function resolvePlayerShotEnemyHits(
  entities: readonly RuntimeEntityState[],
  enemyGrid: CollisionGrid<EnemyRuntimeEntity>,
  destroyedEntityIds: ReadonlySet<number>,
  metrics: CollisionMetrics | null,
): Array<Readonly<{
  enemy: EnemyRuntimeEntity;
  enemyAfterDamage: EnemyRuntimeEntity;
  shot: PlayerShotRuntimeEntity;
}>> {
  const hits = [];
  const enemiesById = new Map(getEnemies(entities).map((enemy) => [enemy.id, enemy]));
  const defeatedEnemyIds = new Set<number>();

  for (const shot of getPlayerShots(entities)) {
    if (destroyedEntityIds.has(shot.id)) {
      continue;
    }
    const enemy = findFirstCollidingEnemy(
      shot,
      queryCandidates(enemyGrid, shot, metrics).map((candidate) => candidate.id),
      enemiesById,
      destroyedEntityIds,
      defeatedEnemyIds,
    );
    if (!enemy) {
      continue;
    }

    const enemyAfterDamage = Object.freeze({
      ...enemy,
      position: Object.freeze({ x: enemy.position.x, y: enemy.position.y }),
      hp: enemy.hp - shot.damage,
    });
    enemiesById.set(enemy.id, enemyAfterDamage);
    hits.push(Object.freeze({ enemy, enemyAfterDamage, shot }));
    if (enemyAfterDamage.hp <= 0) {
      defeatedEnemyIds.add(enemy.id);
    }
  }

  return hits;
}

/** broad phase の候補（id 昇順）のうち、まだ倒れていない enemy で shot と重なる最初の enemy を返す。 */
function findFirstCollidingEnemy(
  shot: PlayerShotRuntimeEntity,
  candidateEnemyIds: readonly number[],
  enemiesById: ReadonlyMap<number, EnemyRuntimeEntity>,
  destroyedEntityIds: ReadonlySet<number>,
  defeatedEnemyIds: ReadonlySet<number>,
): EnemyRuntimeEntity | null {
  for (const enemyId of candidateEnemyIds) {
    if (destroyedEntityIds.has(enemyId) || defeatedEnemyIds.has(enemyId)) {
      continue;
    }
    const enemy = enemiesById.get(enemyId);
    if (!enemy || enemy.hp <= 0) {
      continue;
    }
    if (circlesOverlap(shot, enemy)) {
      return enemy;
    }
  }
  return null;
}

function findPlayer(entities: readonly RuntimeEntityState[]): PlayerRuntimeEntity | null {
  const entity = entities.find((candidate) => candidate.kind === "player");
  return entity?.kind === "player" ? entity : null;
}

function getEnemyBullets(entities: readonly RuntimeEntityState[]): EnemyBulletRuntimeEntity[] {
  return entities.filter((entity): entity is EnemyBulletRuntimeEntity => entity.kind === "enemyBullet");
}

function getEnemies(entities: readonly RuntimeEntityState[]): EnemyRuntimeEntity[] {
  return entities.filter((entity): entity is EnemyRuntimeEntity => entity.kind === "enemy");
}

function getPlayerShots(entities: readonly RuntimeEntityState[]): PlayerShotRuntimeEntity[] {
  return entities
    .filter((entity): entity is PlayerShotRuntimeEntity => entity.kind === "playerShot")
    .sort(compareEntityIdAscending);
}

/** id 昇順の候補のうち、source の円と重なる最初の候補を返す。 */
function findFirstCollision<T extends RuntimeEntityState>(source: RuntimeEntityState, candidates: readonly T[]): T | null {
  return candidates.find((candidate) => circlesOverlap(source, candidate)) ?? null;
}

/** source の円と重なり得る候補を grid から取り出し、broad phase を通過した組の数を debug metric として数える。 */
function queryCandidates<T extends RuntimeEntityState>(
  grid: CollisionGrid<T>,
  source: RuntimeEntityState,
  metrics: CollisionMetrics | null,
): T[] {
  const candidates = grid.query(source.position, source.collisionRadius);
  if (metrics) {
    metrics.candidates += candidates.length;
  }
  return candidates;
}

function circlesOverlap(left: RuntimeEntityState, right: RuntimeEntityState): boolean {
  const dx = left.position.x - right.position.x;
  const dy = left.position.y - right.position.y;
  const radius = left.collisionRadius + right.collisionRadius;
  return dx * dx + dy * dy <= radius * radius;
}

function replaceEntity(
  entities: readonly RuntimeEntityState[],
  replacement: RuntimeEntityState,
): readonly RuntimeEntityState[] {
  return Object.freeze(entities.map((entity) => entity.id === replacement.id ? replacement : entity));
}

function applyPlayerHit(
  player: PlayerRuntimeEntity,
  invincibleTicksAfterHit: number,
): PlayerRuntimeEntity {
  return Object.freeze({
    ...player,
    position: Object.freeze({ x: player.position.x, y: player.position.y }),
    movement: Object.freeze({
      speed: player.movement.speed,
      focusSpeed: player.movement.focusSpeed,
    }),
    lives: Math.max(0, player.lives - 1),
    invincibleTicksRemaining: invincibleTicksAfterHit,
  });
}

function buildPlayerHitEvent(
  tick: number,
  player: PlayerRuntimeEntity,
  source: EnemyBulletRuntimeEntity | EnemyRuntimeEntity,
): GameEvent {
  return Object.freeze({
    type: "playerHit",
    tick,
    playerId: player.definitionId,
    sourceEntityId: source.id,
    sourceEntityKind: source.kind,
    livesRemaining: player.lives,
    invincibleTicksRemaining: player.invincibleTicksRemaining,
  });
}

function buildEntityDestroyedEvent(
  tick: number,
  entity: EnemyRuntimeEntity,
  reason: "defeated",
): GameEvent;
function buildEntityDestroyedEvent(
  tick: number,
  entity: EntityDestroyedByCollision,
  reason: "collision",
): GameEvent;
function buildEntityDestroyedEvent(
  tick: number,
  entity: EnemyRuntimeEntity | EntityDestroyedByCollision,
  reason: "collision" | "defeated",
): GameEvent {
  if (reason === "defeated") {
    return Object.freeze({
      type: "entityDestroyed",
      tick,
      entityId: entity.id,
      entityKind: "enemy",
      reason,
    });
  }
  return Object.freeze({
    type: "entityDestroyed",
    tick,
    entityId: entity.id,
    entityKind: entity.kind as Exclude<EntityKindDestroyedByCollision, "enemy">,
    reason,
  });
}

function buildScoreChangedEvent(
  tick: number,
  enemy: EnemyRuntimeEntity,
  delta: number,
  total: number,
): GameEvent {
  return Object.freeze({
    type: "scoreChanged",
    tick,
    delta,
    total,
    reason: "enemyDefeated",
    enemyId: enemy.definitionId as EnemyId,
    entityId: enemy.id,
  });
}
