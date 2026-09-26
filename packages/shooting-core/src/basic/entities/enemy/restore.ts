import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import type { SerializedRuntimeEntityState } from "../../serialization/types.ts";
import { hasOnlyKeys, isNonNegativeSafeInteger, isPositiveFiniteNumber } from "../../shared/guards.ts";
import { RESTORE_RUNTIME_ENTITY_COMMON_KEYS } from "../restore-common.ts";
import type { RestoreRuntimeEntityCommon } from "../restore-common.ts";
import { createRestoredEnemyRuntimeEntity } from "./model.ts";
import type { EnemyRuntimeEntity } from "./model.ts";

type SerializedRestoreEnemyEntity = Extract<SerializedRuntimeEntityState, { kind: "enemy" }>;

export const RESTORE_RUNTIME_ENEMY_KEYS = Object.freeze([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "hp",
  "scoreOnKill",
  "pathId",
  "patternId",
] as const satisfies ReadonlyArray<keyof SerializedRestoreEnemyEntity>);

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
