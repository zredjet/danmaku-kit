import type { BulletDefinition, BulletId } from "../../content/types.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import type { HashableVector2, SerializedRuntimeEntityBase, SerializedVector2 } from "../snapshot-common.ts";
import type { EnemyBulletRuntimeEntity } from "./model.ts";

/**
 * restore に必要な enemy bullet runtime state。
 *
 * restore は現在座標から移動を逆算せず、`velocity`、`spawnPosition`、`ageTicks` と `position` が、処理済み timeline の
 * `fireOnSpawn` の生成位置・速度と生成 tick からの経過 tick で求めた値と一致することを検証する。damage と lifetime は Core が
 * 正本を持つ slice まで含めない。
 */
export type SerializedEnemyBulletRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "enemyBullet";
  definitionId: BulletId;
  velocity: SerializedVector2;
  spawnPosition: SerializedVector2;
  ageTicks: number;
}>;

/** enemy bullet runtime entity を public serialize 用 DTO に写す。 */
export function projectEnemyBulletRuntimeEntityForSerializedState(
  entity: EnemyBulletRuntimeEntity,
): SerializedEnemyBulletRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemyBullet",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    velocity: { x: entity.velocity.x, y: entity.velocity.y },
    spawnPosition: { x: entity.spawnPosition.x, y: entity.spawnPosition.y },
    ageTicks: entity.ageTicks,
  };
}

/** HashableGameState に含める enemy bullet runtime entity の内部 hash 専用 DTO。 */
export type HashableEnemyBulletRuntimeEntityState = Readonly<{
  id: number;
  kind: "enemyBullet";
  definitionId: BulletDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
  velocity: HashableVector2;
  spawnPosition: HashableVector2;
  ageTicks: number;
}>;

/** enemy bullet runtime entity の hash DTO field を canonical encoding 順に固定する。 */
export const HASHABLE_ENEMY_BULLET_RUNTIME_ENTITY_FIELD_ORDER = defineFieldOrder<
  HashableEnemyBulletRuntimeEntityState,
  EnemyBulletRuntimeEntity
>()([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
  "velocity",
  "spawnPosition",
  "ageTicks",
]);

/** enemy bullet runtime entity を hash 専用 DTO へ明示的に写す。 */
export function projectEnemyBulletRuntimeEntityForHashableState(
  entity: EnemyBulletRuntimeEntity,
): HashableEnemyBulletRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemyBullet",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    velocity: { x: entity.velocity.x, y: entity.velocity.y },
    spawnPosition: { x: entity.spawnPosition.x, y: entity.spawnPosition.y },
    ageTicks: entity.ageTicks,
  };
}
