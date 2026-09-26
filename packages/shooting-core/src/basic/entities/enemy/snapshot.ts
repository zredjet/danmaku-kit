import type { EnemyDefinition, EnemyId, PathId, PatternDefinition, PatternId } from "../../content/types.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import type { HashableVector2, SerializedRuntimeEntityBase } from "../snapshot-common.ts";
import type { EnemyRuntimeEntity } from "./model.ts";

/**
 * restore に必要な enemy runtime state。sprite / view id は adapter 側の責務に残す。
 *
 * Phase 1B-5 で追加する restore は active enemy hp を正の finite number かつ EnemyDefinition
 * の初期 hp 以下、scoreOnKill / collisionRadius / pathId / patternId は loaded EnemyDefinition
 * と同じ immutable field として検証する。PathRunner が segment state を持つ slice では、この payload に
 * schema version 付きの path runner state を追加し、現在座標から movement state を逆算しない。
 */
export type SerializedEnemyRuntimeEntityState = SerializedRuntimeEntityBase & Readonly<{
  kind: "enemy";
  definitionId: EnemyId;
  hp: number;
  scoreOnKill: number;
  pathId: PathId;
  patternId: PatternId;
}>;

/** enemy runtime entity を public serialize 用 DTO に写す。 */
export function projectEnemyRuntimeEntityForSerializedState(
  entity: EnemyRuntimeEntity,
): SerializedEnemyRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemy",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    hp: entity.hp,
    scoreOnKill: entity.scoreOnKill,
    pathId: entity.pathId,
    patternId: entity.patternId,
  };
}

/** HashableGameState に含める enemy runtime entity の内部 hash 専用 DTO。 */
export type HashableEnemyRuntimeEntityState = Readonly<{
  id: number;
  kind: "enemy";
  definitionId: EnemyDefinition["id"];
  position: HashableVector2;
  collisionRadius: number;
  hp: number;
  scoreOnKill: number;
  pathId: PathId;
  patternId: PatternDefinition["id"];
}>;

/** enemy runtime entity の hash DTO field を canonical encoding 順に固定する。 */
export const HASHABLE_ENEMY_RUNTIME_ENTITY_FIELD_ORDER = defineFieldOrder<
  HashableEnemyRuntimeEntityState,
  EnemyRuntimeEntity
>()([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
  "hp",
  "scoreOnKill",
  "pathId",
  "patternId",
]);

/** enemy runtime entity を hash 専用 DTO へ明示的に写す。 */
export function projectEnemyRuntimeEntityForHashableState(entity: EnemyRuntimeEntity): HashableEnemyRuntimeEntityState {
  return {
    id: entity.id,
    kind: "enemy",
    definitionId: entity.definitionId,
    position: { x: entity.position.x, y: entity.position.y },
    collisionRadius: entity.collisionRadius,
    hp: entity.hp,
    scoreOnKill: entity.scoreOnKill,
    pathId: entity.pathId,
    patternId: entity.patternId,
  };
}
