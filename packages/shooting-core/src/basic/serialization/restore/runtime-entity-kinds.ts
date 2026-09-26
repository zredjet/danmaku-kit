import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import {
  MAX_PLAYER_MOVEMENT_SPEED,
  MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
  MAX_PLAYER_SHOT_LIFETIME_TICKS,
  MAX_PLAYER_SHOT_SPEED_PER_AXIS,
  PLAYFIELD_HEIGHT,
  PLAYFIELD_WIDTH,
} from "../../content/runtime-budgets.ts";
import { createRestoredEnemyBulletRuntimeEntity } from "../../entities/enemy-bullet/model.ts";
import type { EnemyBulletRuntimeEntity } from "../../entities/enemy-bullet/model.ts";
import { createRestoredEnemyRuntimeEntity } from "../../entities/enemy/model.ts";
import type { EnemyRuntimeEntity } from "../../entities/enemy/model.ts";
import { RUNTIME_ENTITY_KINDS } from "../../entities/entity-kinds.ts";
import { createRestoredPlayerShotRuntimeEntity } from "../../entities/player-shot/model.ts";
import type { PlayerShotRuntimeEntity } from "../../entities/player-shot/model.ts";
import { createRestoredPlayerRuntimeEntity } from "../../entities/player/model.ts";
import type { PlayerRuntimeEntity } from "../../entities/player/model.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { hasOnlyKeys, isNonNegativeSafeInteger, isPositiveFiniteNumber } from "../../shared/guards.ts";
import { cloneRestorePlainRecord, isRestoreTopLevelString } from "../restore-plain-data.ts";
import type { SerializedRuntimeEntityState } from "../types.ts";

type SerializedRestorePlayerEntity = Extract<SerializedRuntimeEntityState, { kind: "player" }>;

type SerializedRestoreEnemyEntity = Extract<SerializedRuntimeEntityState, { kind: "enemy" }>;

type SerializedRestoreEnemyBulletEntity = Extract<SerializedRuntimeEntityState, { kind: "enemyBullet" }>;

type SerializedRestorePlayerShotEntity = Extract<SerializedRuntimeEntityState, { kind: "playerShot" }>;

const RESTORE_RUNTIME_ENTITY_COMMON_KEYS = Object.freeze([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
] as const satisfies ReadonlyArray<keyof SerializedRuntimeEntityState>);

const RESTORE_RUNTIME_PLAYER_KEYS = Object.freeze([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "lives",
  "invincibleTicksRemaining",
  "nextShotAllowedTick",
  "movement",
  "shotDefinitionId",
] as const satisfies ReadonlyArray<keyof SerializedRestorePlayerEntity>);

const RESTORE_RUNTIME_ENEMY_KEYS = Object.freeze([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "hp",
  "scoreOnKill",
  "pathId",
  "patternId",
] as const satisfies ReadonlyArray<keyof SerializedRestoreEnemyEntity>);

const RESTORE_RUNTIME_ENEMY_BULLET_KEYS: ReadonlyArray<keyof SerializedRestoreEnemyBulletEntity> =
  RESTORE_RUNTIME_ENTITY_COMMON_KEYS;

const RESTORE_RUNTIME_PLAYER_SHOT_KEYS = Object.freeze([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "velocity",
  "remainingLifetimeTicks",
  "damage",
] as const satisfies ReadonlyArray<keyof SerializedRestorePlayerShotEntity>);

export const RESTORE_RUNTIME_ENTITY_ALL_KEYS = Object.freeze([
  ...new Set([
    ...RESTORE_RUNTIME_PLAYER_KEYS,
    ...RESTORE_RUNTIME_ENEMY_KEYS,
    ...RESTORE_RUNTIME_PLAYER_SHOT_KEYS,
  ]),
]);

export type RestoreRuntimeEntityCommon = Readonly<{
  id: number;
  kind: SerializedRuntimeEntityState["kind"];
  position: Readonly<{ x: number; y: number }>;
}>;

export type RestorePlayerShotValidation = Readonly<{
  entity: PlayerShotRuntimeEntity;
  spawnTick: number;
}>;

/** runtime entity 共通 field と ID order contract を検証する。 */
export function validateRestoreRuntimeEntityCommon(
  entity: Record<string, unknown>,
  previousEntityId: number,
  nextEntityId: number,
  index: number,
): CoreResult<RestoreRuntimeEntityCommon> {
  if (
    typeof entity.id !== "number"
    || !Number.isSafeInteger(entity.id)
    || entity.id <= 0
    || entity.id <= previousEntityId
    || entity.id >= nextEntityId
  ) {
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].id must be positive, ascending, and below nextEntityId`);
  }
  if (!isRestoreRuntimeEntityKind(entity.kind)) {
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].kind is not supported`);
  }
  if (!isRestoreTopLevelString(entity.definitionId)) {
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].definitionId must be a string`);
  }
  const position = validateRestoreVector2(entity.position, `state.runtimeEntities[${index}].position`);
  if (!position.ok) {
    return position;
  }
  if (!isPositiveFiniteNumber(entity.collisionRadius)) {
    return coreError("state.invalidShape", `state.runtimeEntities[${index}].collisionRadius must be a positive finite number`);
  }

  return okResult(Object.freeze({
    id: entity.id,
    kind: entity.kind,
    position: position.value,
  }));
}

function isRestoreRuntimeEntityKind(value: unknown): value is SerializedRuntimeEntityState["kind"] {
  return typeof value === "string" && (RUNTIME_ENTITY_KINDS as readonly string[]).includes(value);
}

/** player entity 固有 field と registry reference を検証する。 */
export function validateRestorePlayerRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
  expectedTick: number,
): CoreResult<PlayerRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_PLAYER_KEYS)) {
    return coreError("state.invalidShape", "player runtime entity contains unknown fields");
  }
  if (
    !isNonNegativeSafeInteger(entity.lives)
    || !isNonNegativeSafeInteger(entity.invincibleTicksRemaining)
    || !isNonNegativeSafeInteger(entity.nextShotAllowedTick)
  ) {
    return coreError("state.invalidShape", "player runtime counters must be non-negative safe integers");
  }
  const movement = cloneRestorePlainRecord(entity.movement, "player runtime movement", ["speed", "focusSpeed"]);
  if (!movement.ok) {
    return movement;
  }
  if (!isPositiveFiniteNumber(movement.value.speed) || movement.value.speed > MAX_PLAYER_MOVEMENT_SPEED) {
    return coreError("state.invalidShape", "player movement.speed exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(movement.value.focusSpeed) || movement.value.focusSpeed > MAX_PLAYER_MOVEMENT_SPEED) {
    return coreError("state.invalidShape", "player movement.focusSpeed exceeds the runtime budget");
  }
  if (typeof entity.shotDefinitionId !== "string") {
    return coreError("state.invalidShape", "player shotDefinitionId must be a string");
  }
  if (!isNamespacedId(entity.shotDefinitionId, "playerShot")) {
    return coreError("state.invalidShape", "player shotDefinitionId must be a valid playerShot id");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "player")) {
    return coreError("state.invalidShape", "player definitionId must be a valid player id");
  }
  const player = content.playersById.get(entity.definitionId);
  if (!player) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player");
  }
  const playerShot = content.playerShotsById.get(entity.shotDefinitionId);
  if (!playerShot) {
    return coreError("state.registryInvalid", "player runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== player.collision.radius
    || movement.value.speed !== player.movement.speed
    || movement.value.focusSpeed !== player.movement.focusSpeed
    || entity.shotDefinitionId !== player.shot.definition
  ) {
    return coreError("state.invalidShape", "player runtime entity must match immutable player definition fields");
  }
  if (!isPlayerPositionInsidePlayfield(common.position)) {
    return coreError("state.invalidShape", "player runtime position must stay inside the playfield");
  }
  if (
    entity.lives > player.life.initialLives
    || entity.invincibleTicksRemaining > player.life.invincibleTicksAfterHit
    || entity.nextShotAllowedTick > Math.max(0, expectedTick - 1 + Math.min(
      playerShot.fire.intervalTicks,
      MAX_PLAYER_SHOT_FIRE_INTERVAL_TICKS,
    ))
  ) {
    return coreError("state.invalidShape", "player runtime counters exceed restorable gameplay bounds");
  }

  return okResult(createRestoredPlayerRuntimeEntity({
    id: common.id,
    definitionId: player.id,
    position: common.position,
    movement: Object.freeze({
      speed: movement.value.speed,
      focusSpeed: movement.value.focusSpeed,
    }),
    collisionRadius: player.collision.radius,
    lives: entity.lives,
    invincibleTicksRemaining: entity.invincibleTicksRemaining,
    shotDefinitionId: player.shot.definition,
    nextShotAllowedTick: entity.nextShotAllowedTick,
  }));
}

/** player の中心座標は movement system と同じ playfield 範囲だけを restore で受け付ける。 */
function isPlayerPositionInsidePlayfield(position: Readonly<{ x: number; y: number }>): boolean {
  return position.x >= 0 && position.x <= PLAYFIELD_WIDTH && position.y >= 0 && position.y <= PLAYFIELD_HEIGHT;
}

/** enemy entity 固有 field と registry reference を検証する。 */
export function validateRestoreEnemyRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
): CoreResult<EnemyRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_ENEMY_KEYS)) {
    return coreError("state.invalidShape", "enemy runtime entity contains unknown fields");
  }
  if (!isPositiveFiniteNumber(entity.hp) || !isNonNegativeSafeInteger(entity.scoreOnKill)) {
    return coreError("state.invalidShape", "enemy runtime hp must be positive and scoreOnKill must be non-negative");
  }
  if (typeof entity.pathId !== "string") {
    return coreError("state.invalidShape", "enemy pathId must be a string");
  }
  if (typeof entity.patternId !== "string") {
    return coreError("state.invalidShape", "enemy patternId must be a string");
  }
  if (!isNamespacedId(entity.pathId, "path")) {
    return coreError("state.invalidShape", "enemy pathId must be a valid path id");
  }
  if (!isNamespacedId(entity.patternId, "pattern")) {
    return coreError("state.invalidShape", "enemy patternId must be a valid pattern id");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "enemy")) {
    return coreError("state.invalidShape", "enemy definitionId must be a valid enemy id");
  }
  const enemy = content.enemiesById.get(entity.definitionId);
  if (!enemy) {
    return coreError("state.registryInvalid", "enemy runtime entity references an unknown enemy");
  }
  const path = content.pathsById.get(entity.pathId);
  if (!path) {
    return coreError("state.registryInvalid", "enemy runtime entity references an unknown path");
  }
  const pattern = content.patternsById.get(entity.patternId);
  if (!pattern) {
    return coreError("state.registryInvalid", "enemy runtime entity references an unknown pattern");
  }
  if (entity.collisionRadius !== enemy.collision.radius || entity.scoreOnKill !== enemy.score || entity.hp > enemy.hp) {
    return coreError("state.invalidShape", "enemy runtime entity must match immutable enemy definition fields");
  }

  return okResult(createRestoredEnemyRuntimeEntity({
    id: common.id,
    definitionId: enemy.id,
    position: common.position,
    pathId: path.id,
    patternId: pattern.id,
    collisionRadius: enemy.collision.radius,
    hp: entity.hp,
    scoreOnKill: enemy.score,
  }));
}

/** enemy bullet entity 固有 field と registry reference を検証する。 */
export function validateRestoreEnemyBulletRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
): CoreResult<EnemyBulletRuntimeEntity> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_ENEMY_BULLET_KEYS)) {
    return coreError("state.invalidShape", "enemy bullet runtime entity contains unknown fields");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "bullet")) {
    return coreError("state.invalidShape", "enemy bullet definitionId must be a valid bullet id");
  }
  const bullet = content.bulletsById.get(entity.definitionId);
  if (!bullet) {
    return coreError("state.registryInvalid", "enemy bullet runtime entity references an unknown bullet");
  }
  if (entity.collisionRadius !== bullet.collision.radius) {
    return coreError("state.invalidShape", "enemy bullet runtime entity must match immutable bullet definition fields");
  }

  return okResult(createRestoredEnemyBulletRuntimeEntity({
    id: common.id,
    definitionId: bullet.id,
    position: common.position,
    collisionRadius: bullet.collision.radius,
  }));
}

/** player shot entity 固有 field と registry reference を検証する。 */
export function validateRestorePlayerShotRuntimeEntity(
  entity: Record<string, unknown>,
  common: RestoreRuntimeEntityCommon,
  content: LoadedContentIndex,
  expectedTick: number,
): CoreResult<RestorePlayerShotValidation> {
  if (!hasOnlyKeys(entity, RESTORE_RUNTIME_PLAYER_SHOT_KEYS)) {
    return coreError("state.invalidShape", "player shot runtime entity contains unknown fields");
  }
  const velocity = validateRestoreVector2(entity.velocity, "player shot velocity");
  if (!velocity.ok) {
    return velocity;
  }
  if (Math.abs(velocity.value.x) > MAX_PLAYER_SHOT_SPEED_PER_AXIS || Math.abs(velocity.value.y) > MAX_PLAYER_SHOT_SPEED_PER_AXIS) {
    return coreError("state.invalidShape", "player shot velocity exceeds the runtime budget");
  }
  const remainingLifetimeTicks = entity.remainingLifetimeTicks;
  if (
    typeof remainingLifetimeTicks !== "number"
    || !Number.isSafeInteger(remainingLifetimeTicks)
    || remainingLifetimeTicks <= 0
    || remainingLifetimeTicks > MAX_PLAYER_SHOT_LIFETIME_TICKS
  ) {
    return coreError("state.invalidShape", "player shot remainingLifetimeTicks exceeds the runtime budget");
  }
  if (!isPositiveFiniteNumber(entity.damage)) {
    return coreError("state.invalidShape", "player shot damage must be a positive finite number");
  }
  if (typeof entity.definitionId !== "string" || !isNamespacedId(entity.definitionId, "playerShot")) {
    return coreError("state.invalidShape", "player shot definitionId must be a valid playerShot id");
  }
  const playerShot = content.playerShotsById.get(entity.definitionId);
  if (!playerShot) {
    return coreError("state.registryInvalid", "player shot runtime entity references an unknown player shot");
  }
  if (
    entity.collisionRadius !== playerShot.collision.radius
    || velocity.value.x !== playerShot.projectile.velocity.x
    || velocity.value.y !== playerShot.projectile.velocity.y
    || entity.damage !== playerShot.damage
    || remainingLifetimeTicks > playerShot.projectile.lifetimeTicks
  ) {
    return coreError("state.invalidShape", "player shot runtime entity must match immutable player shot definition fields");
  }
  const elapsedTicks = playerShot.projectile.lifetimeTicks - remainingLifetimeTicks;
  const spawnTick = expectedTick - 1 - elapsedTicks;
  if (!Number.isSafeInteger(spawnTick) || spawnTick < 0 || spawnTick >= expectedTick) {
    return coreError("state.invalidShape", "player shot remainingLifetimeTicks is not reachable from expectedTick");
  }

  return okResult(Object.freeze({
    entity: createRestoredPlayerShotRuntimeEntity({
      id: common.id,
      definitionId: playerShot.id,
      position: common.position,
      velocity: velocity.value,
      collisionRadius: playerShot.collision.radius,
      damage: playerShot.damage,
      remainingLifetimeTicks,
    }),
    spawnTick,
  }));
}

/** serialized vector2 を有限数だけに制限する。 */
function validateRestoreVector2(value: unknown, fieldName: string): CoreResult<Readonly<{ x: number; y: number }>> {
  const vector = cloneRestorePlainRecord(value, fieldName, ["x", "y"]);
  if (!vector.ok) {
    return vector;
  }
  if (typeof vector.value.x !== "number" || !Number.isFinite(vector.value.x)) {
    return coreError("state.invalidShape", `${fieldName}.x must be finite`);
  }
  if (typeof vector.value.y !== "number" || !Number.isFinite(vector.value.y)) {
    return coreError("state.invalidShape", `${fieldName}.y must be finite`);
  }

  return okResult(Object.freeze({ x: vector.value.x, y: vector.value.y }));
}
