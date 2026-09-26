import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { cloneRestorePlainRecord, isRestoreTopLevelString } from "../serialization/restore-plain-data.ts";
import type { SerializedRuntimeEntityState } from "../serialization/types.ts";
import { isPositiveFiniteNumber } from "../shared/guards.ts";
import { RUNTIME_ENTITY_KINDS } from "./entity-kinds.ts";

export const RESTORE_RUNTIME_ENTITY_COMMON_KEYS = Object.freeze([
  "id",
  "kind",
  "definitionId",
  "position",
  "collisionRadius",
] as const satisfies ReadonlyArray<keyof SerializedRuntimeEntityState>);

export type RestoreRuntimeEntityCommon = Readonly<{
  id: number;
  kind: SerializedRuntimeEntityState["kind"];
  position: Readonly<{ x: number; y: number }>;
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

/** serialized vector2 を有限数だけに制限する。 */
export function validateRestoreVector2(value: unknown, fieldName: string): CoreResult<Readonly<{ x: number; y: number }>> {
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
  expected: Readonly<{ x: number; y: number }>,
  actual: Readonly<{ x: number; y: number }>,
): boolean {
  return actual.x === expected.x && actual.y === expected.y;
}
