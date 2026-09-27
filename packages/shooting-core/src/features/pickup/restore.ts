import type { PickupId } from "../../basic/content/types.ts";
import type { FeatureAllocationContext, FeatureRestoreContext } from "../../basic/extension/feature-module.ts";
import { coreError, okResult } from "../../basic/result.ts";
import type { CoreResult } from "../../basic/result.ts";
import type { SerializedJsonValue } from "../../basic/serialization/types.ts";
import { MAX_ACTIVE_PICKUPS, PICKUP_ATTRACT_TICKS } from "./budgets.ts";
import { countDrops, isOutsidePickupBounds, pickupPositionAt } from "./model.ts";
import type { PickupContent, PickupEntityState, PickupFeatureState } from "./model.ts";

const PICKUP_KEYS = Object.freeze(["id", "definitionId", "spawnTick", "spawnPosition", "attractedTick"]);

/**
 * serialize した pickup feature の state を検証して state にする。
 *
 * pickup は id の昇順で、id は `nextEntityId` より小さく basic の entity と重ならない。定義は content にあり、`spawnTick` までに timeline
 * が出した enemy の drops に含まれる。位置は spawn からの式で求め、出た tick と最後に処理した tick（吸い寄せに入った pickup は入った
 * tick）の位置が cleanup 境界の内側にある（途中で取り除かれていない）。吸い寄せに入った pickup は、まだ回収の tick に達していない。
 */
export function restorePickupState(
  payload: SerializedJsonValue,
  context: FeatureRestoreContext<PickupContent>,
): CoreResult<PickupFeatureState> {
  const record = asRecord(payload);
  if (!record || !hasOnlyKeys(record, ["pickups"]) || !Array.isArray(record.pickups)) {
    return invalid("pickup feature state must be an object with a pickups array");
  }
  if (record.pickups.length > MAX_ACTIVE_PICKUPS) {
    return invalid(`pickup feature state must have at most ${MAX_ACTIVE_PICKUPS} pickups`);
  }
  const lastTick = context.expectedTick - 1;
  const pickups: PickupEntityState[] = [];
  let previousId = 0;
  for (const [index, value] of record.pickups.entries()) {
    const pickup = parsePickup(value);
    if (!pickup) {
      return invalid(`pickups[${index}] must have ${PICKUP_KEYS.join(", ")} with valid values`);
    }
    if (pickup.id <= previousId || pickup.id >= context.nextEntityId || context.entityIds.has(pickup.id)) {
      return invalid(`pickups[${index}].id must be ascending, below nextEntityId and not used by another entity`);
    }
    previousId = pickup.id;
    const definition = context.content.pickupsById.get(pickup.definitionId);
    if (!definition || !canDrop(pickup.definitionId, pickup.spawnTick, context)) {
      return invalid(`pickups[${index}] must be a pickup that an enemy spawned by spawnTick drops`);
    }
    if (pickup.spawnTick > lastTick) {
      return invalid(`pickups[${index}].spawnTick must be before expectedTick`);
    }
    const settledTick = pickup.attractedTick ?? lastTick;
    if (pickup.attractedTick !== null && (
      definition.magnetRadius === undefined
      || pickup.attractedTick < pickup.spawnTick
      || pickup.attractedTick > lastTick
      || lastTick >= pickup.attractedTick + PICKUP_ATTRACT_TICKS
    )) {
      return invalid(`pickups[${index}].attractedTick must be a tick of the attraction that has not been collected yet`);
    }
    if (
      isOutsidePickupBounds(pickupPositionAt(pickup, definition, pickup.spawnTick))
      || isOutsidePickupBounds(pickupPositionAt(pickup, definition, settledTick))
    ) {
      return invalid(`pickups[${index}] must stay inside the cleanup bounds from its spawn`);
    }
    pickups.push(pickup);
  }
  return okResult({ pickups });
}

/** spawn から `expectedTick` までに出し得る pickup の数（処理した timeline の enemy がすべて撃破された場合）。 */
export function maxPickupAllocations(context: FeatureAllocationContext<PickupContent>): number {
  return context.stage.timeline
    .filter((step) => step.tick < context.expectedTick)
    .reduce((total, step) => total + countDrops(context.content.dropsByEnemyId.get(step.action.enemy)), 0);
}

/** `spawnTick` までに timeline が出した enemy のどれかが、`definitionId` の pickup を落とすか。 */
function canDrop(definitionId: PickupId, spawnTick: number, context: FeatureRestoreContext<PickupContent>): boolean {
  return context.stage.timeline.some((step) => step.tick <= spawnTick
    && (context.content.dropsByEnemyId.get(step.action.enemy) ?? []).some((drop) => drop.pickup === definitionId));
}

function parsePickup(value: SerializedJsonValue): PickupEntityState | null {
  const record = asRecord(value);
  const position = asRecord(record?.spawnPosition ?? null);
  if (
    !record || !hasOnlyKeys(record, PICKUP_KEYS)
    || !isPositiveSafeInteger(record.id)
    || typeof record.definitionId !== "string" || !record.definitionId.startsWith("pickup.")
    || !isNonNegativeSafeInteger(record.spawnTick)
    || !position || !hasOnlyKeys(position, ["x", "y"])
    || typeof position.x !== "number" || typeof position.y !== "number"
    || (record.attractedTick !== null && !isNonNegativeSafeInteger(record.attractedTick))
  ) {
    return null;
  }
  return {
    id: record.id,
    definitionId: record.definitionId as PickupId,
    spawnTick: record.spawnTick,
    spawnPosition: { x: position.x, y: position.y },
    attractedTick: record.attractedTick as number | null,
  };
}

function asRecord(value: SerializedJsonValue | undefined): Readonly<Record<string, SerializedJsonValue>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, SerializedJsonValue>>
    : null;
}

function hasOnlyKeys(record: Readonly<Record<string, SerializedJsonValue>>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function isPositiveSafeInteger(value: SerializedJsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: SerializedJsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalid(message: string): CoreResult<never> {
  return coreError("state.invalidShape", message);
}
