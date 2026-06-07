import type {
  BulletDefinition,
  BulletId,
  EnemyDefinition,
  EnemyId,
  PathId,
  PatternId,
  PlayerDefinition,
  PlayerId,
  PlayerShotDefinition,
  PlayerShotId,
  StageTimelineAction,
} from "../content/types.ts";
import { okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { EntityAllocator } from "./entity.ts";
import type { EntityId } from "./entity.ts";

const DEFAULT_PLAYER_START_POSITION = Object.freeze({ x: 192, y: 400 });

type SpawnEnemyAction = Extract<StageTimelineAction, { type: "spawnEnemy" }>;

/** Simulation と renderer snapshot が共有する最小座標型。 */
export type Vector2 = Readonly<{
  x: number;
  y: number;
}>;

/**
 * renderer / debug / replay が読む最小 entity snapshot。
 *
 * runtime 内部 component はこの型へ直接混ぜず、`toReadonlyEntityState()` で
 * 表示・検査に必要な値だけを投影する。
 */
export type ReadonlyEntityState =
  | Readonly<{
    id: EntityId;
    kind: "player";
    definitionId: PlayerId;
    position: Vector2;
  }>
  | Readonly<{
    id: EntityId;
    kind: "enemy";
    definitionId: EnemyId;
    position: Vector2;
  }>
  | Readonly<{
    id: EntityId;
    kind: "enemyBullet";
    definitionId: BulletId;
    position: Vector2;
  }>
  | Readonly<{
    id: EntityId;
    kind: "playerShot";
    definitionId: PlayerShotId;
    position: Vector2;
  }>;

/** 自機の runtime component。移動と被弾に必要な最小値だけを保持する。 */
export type PlayerRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "player";
  definitionId: PlayerId;
  position: Vector2;
  movement: Readonly<{
    speed: number;
    focusSpeed: number;
  }>;
  collisionRadius: number;
  lives: number;
  invincibleTicksRemaining: number;
  shotDefinitionId: PlayerShotId;
}>;

/** 敵の runtime component。今後の movement / pattern / score 解決に必要な参照を保持する。 */
export type EnemyRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "enemy";
  definitionId: EnemyId;
  position: Vector2;
  pathId: PathId;
  patternId: PatternId;
  collisionRadius: number;
  hp: number;
  scoreOnKill: number;
}>;

/** 敵弾の runtime component。発射 system 追加時に速度や collider を拡張する。 */
export type EnemyBulletRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "enemyBullet";
  definitionId: BulletId;
  position: Vector2;
  collisionRadius: number;
}>;

/** 自機ショットの runtime component。projectile movement と lifetime cleanup に必要な値を保持する。 */
export type PlayerShotRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "playerShot";
  definitionId: PlayerShotId;
  position: Vector2;
  velocity: Vector2;
  collisionRadius: number;
  damage: number;
  remainingLifetimeTicks: number;
}>;

/** Core basic が扱う runtime entity の union。 */
export type RuntimeEntityState =
  | PlayerRuntimeEntity
  | EnemyRuntimeEntity
  | EnemyBulletRuntimeEntity
  | PlayerShotRuntimeEntity;

/** PlayerDefinition から stage 開始時の player runtime entity を作る。 */
export function createPlayerRuntimeEntity(
  allocator: EntityAllocator,
  player: PlayerDefinition,
): CoreResult<PlayerRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(Object.freeze({
    id: entity.value.id,
    kind: "player",
    definitionId: player.id,
    position: DEFAULT_PLAYER_START_POSITION,
    movement: Object.freeze({
      speed: player.movement.speed,
      focusSpeed: player.movement.focusSpeed,
    }),
    collisionRadius: player.collision.radius,
    lives: player.life.initialLives,
    invincibleTicksRemaining: 0,
    shotDefinitionId: player.shot.definition,
  }));
}

/** Stage timeline の spawnEnemy action から enemy runtime entity を作る。 */
export function createEnemyRuntimeEntity(
  allocator: EntityAllocator,
  enemy: EnemyDefinition,
  action: SpawnEnemyAction,
): CoreResult<EnemyRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(Object.freeze({
    id: entity.value.id,
    kind: "enemy",
    definitionId: enemy.id,
    position: Object.freeze({
      x: action.position.x,
      y: action.position.y,
    }),
    pathId: action.path,
    patternId: action.pattern,
    collisionRadius: enemy.collision.radius,
    hp: enemy.hp,
    scoreOnKill: enemy.score,
  }));
}

/** BulletDefinition から enemy bullet runtime entity を作る。 */
export function createEnemyBulletRuntimeEntity(
  allocator: EntityAllocator,
  bullet: BulletDefinition,
  position: Vector2,
): CoreResult<EnemyBulletRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(Object.freeze({
    id: entity.value.id,
    kind: "enemyBullet",
    definitionId: bullet.id,
    position: Object.freeze({ x: position.x, y: position.y }),
    collisionRadius: bullet.collision.radius,
  }));
}

/** PlayerShotDefinition から player shot runtime entity を作る。 */
export function createPlayerShotRuntimeEntity(
  allocator: EntityAllocator,
  playerShot: PlayerShotDefinition,
  position: Vector2,
): CoreResult<PlayerShotRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(Object.freeze({
    id: entity.value.id,
    kind: "playerShot",
    definitionId: playerShot.id,
    position: Object.freeze({ x: position.x, y: position.y }),
    velocity: Object.freeze({
      x: playerShot.projectile.velocity.x,
      y: playerShot.projectile.velocity.y,
    }),
    collisionRadius: playerShot.collision.radius,
    damage: playerShot.damage,
    remainingLifetimeTicks: playerShot.projectile.lifetimeTicks,
  }));
}

/** runtime entity から公開 frame 用の immutable snapshot を作る。 */
export function toReadonlyEntityState(entity: RuntimeEntityState): ReadonlyEntityState {
  switch (entity.kind) {
    case "player":
      return freezeSnapshot({
        id: entity.id,
        kind: "player",
        definitionId: entity.definitionId,
        position: entity.position,
      });
    case "enemy":
      return freezeSnapshot({
        id: entity.id,
        kind: "enemy",
        definitionId: entity.definitionId,
        position: entity.position,
      });
    case "enemyBullet":
      return freezeSnapshot({
        id: entity.id,
        kind: "enemyBullet",
        definitionId: entity.definitionId,
        position: entity.position,
      });
    case "playerShot":
      return freezeSnapshot({
        id: entity.id,
        kind: "playerShot",
        definitionId: entity.definitionId,
        position: entity.position,
      });
  }
}

function freezeSnapshot<T extends { position: Vector2 }>(entity: T): Readonly<T> {
  return Object.freeze({
    ...entity,
    position: Object.freeze({ x: entity.position.x, y: entity.position.y }),
  });
}
