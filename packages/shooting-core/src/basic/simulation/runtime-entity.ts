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
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { EntityAllocator } from "./entity.ts";
import type { EntityId } from "./entity.ts";

/** startStage 直後の player 初期位置。restore の初期 snapshot 検証でも同じ値を使う。 */
export const DEFAULT_PLAYER_START_POSITION = Object.freeze({ x: 192, y: 400 });

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

/** 自機の runtime component。移動、被弾、shot cooldown に必要な最小値を保持する。 */
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
  nextShotAllowedTick: number;
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

/** 検証済み snapshot から player runtime entity を復元するための入力。 */
export type RestoredPlayerRuntimeEntityInput = Readonly<{
  id: EntityId;
  definitionId: PlayerId;
  position: Vector2;
  movement: PlayerRuntimeEntity["movement"];
  collisionRadius: number;
  lives: number;
  invincibleTicksRemaining: number;
  shotDefinitionId: PlayerShotId;
  nextShotAllowedTick: number;
}>;

/** 検証済み snapshot から enemy runtime entity を復元するための入力。 */
export type RestoredEnemyRuntimeEntityInput = Readonly<{
  id: EntityId;
  definitionId: EnemyId;
  position: Vector2;
  pathId: PathId;
  patternId: PatternId;
  collisionRadius: number;
  hp: number;
  scoreOnKill: number;
}>;

/** 検証済み snapshot から enemy bullet runtime entity を復元するための入力。 */
export type RestoredEnemyBulletRuntimeEntityInput = Readonly<{
  id: EntityId;
  definitionId: BulletId;
  position: Vector2;
  collisionRadius: number;
}>;

/** 検証済み snapshot から player shot runtime entity を復元するための入力。 */
export type RestoredPlayerShotRuntimeEntityInput = Readonly<{
  id: EntityId;
  definitionId: PlayerShotId;
  position: Vector2;
  velocity: Vector2;
  collisionRadius: number;
  damage: number;
  remainingLifetimeTicks: number;
}>;

/** PlayerDefinition から stage 開始時の player runtime entity を作る。 */
export function createPlayerRuntimeEntity(
  allocator: EntityAllocator,
  player: PlayerDefinition,
): CoreResult<PlayerRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(createRestoredPlayerRuntimeEntity({
    id: entity.value.id,
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
    nextShotAllowedTick: 0,
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

  return okResult(createRestoredEnemyRuntimeEntity({
    id: entity.value.id,
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
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return coreError("definition.invalidConstraint", `Enemy bullet position must be finite: ${bullet.id}`);
  }

  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(createRestoredEnemyBulletRuntimeEntity({
    id: entity.value.id,
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

  return okResult(createRestoredPlayerShotRuntimeEntity({
    id: entity.value.id,
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

/** restore 済み player component を runtime が使う immutable entity に戻す。 */
export function createRestoredPlayerRuntimeEntity(input: RestoredPlayerRuntimeEntityInput): PlayerRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "player",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    movement: Object.freeze({
      speed: input.movement.speed,
      focusSpeed: input.movement.focusSpeed,
    }),
    collisionRadius: input.collisionRadius,
    lives: input.lives,
    invincibleTicksRemaining: input.invincibleTicksRemaining,
    shotDefinitionId: input.shotDefinitionId,
    nextShotAllowedTick: input.nextShotAllowedTick,
  });
}

/** restore 済み enemy component を runtime が使う immutable entity に戻す。 */
export function createRestoredEnemyRuntimeEntity(input: RestoredEnemyRuntimeEntityInput): EnemyRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "enemy",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    pathId: input.pathId,
    patternId: input.patternId,
    collisionRadius: input.collisionRadius,
    hp: input.hp,
    scoreOnKill: input.scoreOnKill,
  });
}

/** restore 済み enemy bullet component を runtime が使う immutable entity に戻す。 */
export function createRestoredEnemyBulletRuntimeEntity(
  input: RestoredEnemyBulletRuntimeEntityInput,
): EnemyBulletRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "enemyBullet",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    collisionRadius: input.collisionRadius,
  });
}

/** restore 済み player shot component を runtime が使う immutable entity に戻す。 */
export function createRestoredPlayerShotRuntimeEntity(
  input: RestoredPlayerShotRuntimeEntityInput,
): PlayerShotRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "playerShot",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    velocity: Object.freeze({ x: input.velocity.x, y: input.velocity.y }),
    collisionRadius: input.collisionRadius,
    damage: input.damage,
    remainingLifetimeTicks: input.remainingLifetimeTicks,
  });
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
