import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { cloneRestorePlainRecord } from "../../serialization/restore-plain-data.ts";
import { defineFieldOrder } from "../../shared/field-order.ts";
import { hasOnlyKeys, isNonNegativeSafeInteger, isPositiveFiniteNumber } from "../../shared/guards.ts";
import type { PathRunnerState } from "../../simulation/path-runner.ts";
import { RESTORE_RUNTIME_ENTITY_COMMON_KEYS, validateRestoreVector2 } from "../restore-common.ts";
import type { RestoreRuntimeEntityCommon } from "../restore-common.ts";
import { createRestoredEnemyRuntimeEntity } from "./model.ts";
import type { EnemyRuntimeEntity } from "./model.ts";
import type { SerializedEnemyPathRunnerState, SerializedEnemyRuntimeEntityState } from "./snapshot.ts";

/** enemy runtime entity の restore で受け付ける key。public DTO と runtime component の field 集合に一致させる。 */
export const RESTORE_RUNTIME_ENEMY_KEYS = defineFieldOrder<
  SerializedEnemyRuntimeEntityState,
  EnemyRuntimeEntity
>()([
  ...RESTORE_RUNTIME_ENTITY_COMMON_KEYS,
  "hp",
  "scoreOnKill",
  "pathId",
  "patternId",
  "pathRunnerState",
]);

/** enemy path runner state の restore で受け付ける key。public DTO と runtime state の field 集合に一致させる。 */
const RESTORE_ENEMY_PATH_RUNNER_STATE_KEYS = defineFieldOrder<
  SerializedEnemyPathRunnerState,
  PathRunnerState
>()([
  "segmentIndex",
  "segmentStart",
  "segmentElapsedTicks",
]);

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
  const pathRunnerState = validateRestoreEnemyPathRunnerState(entity.pathRunnerState, path.segments?.length ?? 0);
  if (!pathRunnerState.ok) {
    return pathRunnerState;
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
    pathRunnerState: pathRunnerState.value,
  }));
}

/**
 * path runner state の shape と、path の segment 数に収まる範囲を検証する。
 *
 * spawn 位置と経過 tick から path を進めた結果との一致は、spawn を特定できる restore の allocation 検証で確かめる。
 */
function validateRestoreEnemyPathRunnerState(value: unknown, segmentCount: number): CoreResult<PathRunnerState> {
  const state = cloneRestorePlainRecord(value, "enemy runtime pathRunnerState", RESTORE_ENEMY_PATH_RUNNER_STATE_KEYS);
  if (!state.ok) {
    return state;
  }
  if (
    !isNonNegativeSafeInteger(state.value.segmentIndex)
    || !isNonNegativeSafeInteger(state.value.segmentElapsedTicks)
    || state.value.segmentIndex > segmentCount
  ) {
    return coreError("state.invalidShape", "enemy pathRunnerState counters must stay within the path segments");
  }
  const segmentStart = validateRestoreVector2(state.value.segmentStart, "enemy runtime pathRunnerState.segmentStart");
  if (!segmentStart.ok) {
    return segmentStart;
  }

  return okResult(Object.freeze({
    segmentIndex: state.value.segmentIndex,
    segmentStart: segmentStart.value,
    segmentElapsedTicks: state.value.segmentElapsedTicks,
  }));
}
