import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { cloneRestorePlainRecord, isRestoreTopLevelString } from "../serialization/restore-plain-data.ts";
import { defineFieldOrder } from "../shared/field-order.ts";
import { isPositiveFiniteNumber } from "../shared/guards.ts";
import { RUNTIME_ENTITY_KINDS } from "./entity-kinds.ts";
import type { RuntimeEntityKind } from "./entity-kinds.ts";
import type { Vector2 } from "./model-common.ts";
import type { SerializedRuntimeEntityBase } from "./snapshot-common.ts";

/** 全 kind の restore で受け付ける共通 key。public DTO の共通部分の field 集合と一致させる。 */
export const RESTORE_RUNTIME_ENTITY_COMMON_KEYS = defineFieldOrder<SerializedRuntimeEntityBase>()([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
]);

export type RestoreRuntimeEntityCommon = Readonly<{
  id: number;
  kind: RuntimeEntityKind;
  position: Vector2;
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

function isRestoreRuntimeEntityKind(value: unknown): value is RuntimeEntityKind {
  return typeof value === "string" && (RUNTIME_ENTITY_KINDS as readonly string[]).includes(value);
}

/** serialized vector2 を有限数だけに制限する。 */
export function validateRestoreVector2(value: unknown, fieldName: string): CoreResult<Vector2> {
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

/** restore entity の position が timeline 由来の位置と完全一致することを検証する。 */
export function isSameRestorePosition(
  expected: Vector2,
  actual: Vector2,
): boolean {
  return actual.x === expected.x && actual.y === expected.y;
}
