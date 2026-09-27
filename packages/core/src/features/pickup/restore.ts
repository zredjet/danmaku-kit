import type { PickupId } from "../../basic/content/types.ts";
import type { FeatureAllocationContext, FeatureRestoreContext } from "../../basic/extension/feature-module.ts";
import { coreError, okResult } from "../../basic/result.ts";
import type { CoreResult } from "../../basic/result.ts";
import type { SerializedJsonValue } from "../../basic/serialization/types.ts";
import { asRecord, isNonNegativeSafeInteger, isPositiveSafeInteger } from "../../basic/shared/guards.ts";
import { MAX_ACTIVE_PICKUPS, PICKUP_ATTRACT_TICKS } from "./budgets.ts";
import { countDrops, isPickupGone, pickupPositionAt } from "./model.ts";
import type { PickupContent, PickupEntityState, PickupFeatureState } from "./model.ts";

const PICKUP_KEYS = Object.freeze(["id", "definitionId", "spawnTick", "spawnPosition", "attractedTick"]);

/**
 * serialize した pickup feature の state を検証して state にする。
 *
 * - pickup は id の昇順で、出た tick も昇順（同じ tick の pickup はまとめて採番する）。id は `nextEntityId` より小さく、basic の entity
 *   と重ならず、採番の順が system order と合う（出た tick 以前に採番された basic の entity より大きく、後の tick の entity より小さい）。
 * - 定義は content にあり、出た tick までに timeline が出した enemy の drops が落とせる数を超えない（定義ごとに数える）。
 * - 位置は spawn からの式で求め、最後に処理した tick（吸い寄せに入った pickup は入った tick）に cleanup で取り除かれていない。
 * - 吸い寄せに入った pickup は `magnetRadius` を持つ定義で、出た後に入り、まだ回収の tick に達していない。
 *
 * 撃破した位置（`spawnPosition`）は入力で決まる enemy の撃破の tick と path に依存するため、ここでは検証しない。
 */
export function restorePickupState(
  payload: SerializedJsonValue,
  context: FeatureRestoreContext<PickupContent>,
): CoreResult<PickupFeatureState> {
  const record = asRecord(payload);
  if (!record || !hasExactKeys(record, ["pickups"]) || !Array.isArray(record.pickups)) {
    return invalid("pickup feature state must be an object with a pickups array");
  }
  if (record.pickups.length > MAX_ACTIVE_PICKUPS) {
    return invalid(`pickup feature state must have at most ${MAX_ACTIVE_PICKUPS} pickups`);
  }
  const lastTick = context.expectedTick - 1;
  const pickups: PickupEntityState[] = [];
  for (const [index, value] of (record.pickups as readonly SerializedJsonValue[]).entries()) {
    const pickup = parsePickup(value);
    if (!pickup) {
      return invalid(`pickups[${index}] must have ${PICKUP_KEYS.join(", ")} with valid values`);
    }
    const previous = pickups.at(-1);
    if (previous && (pickup.id <= previous.id || pickup.spawnTick < previous.spawnTick)) {
      return invalid(`pickups[${index}] must follow the previous pickup in id and spawnTick`);
    }
    if (pickup.id >= context.nextEntityId || !followsAllocationOrder(pickup, context.entityAllocationTicks)) {
      return invalid(`pickups[${index}].id must be below nextEntityId and follow the entities allocated by spawnTick`);
    }
    const definition = context.content.pickupsById.get(pickup.definitionId);
    if (!definition) {
      return invalid(`pickups[${index}].definitionId must be a pickup in the content`);
    }
    if (pickup.spawnTick > lastTick) {
      return invalid(`pickups[${index}].spawnTick must be before expectedTick`);
    }
    if (pickup.attractedTick !== null && (
      definition.magnetRadius === undefined
      || pickup.attractedTick < pickup.spawnTick
      || pickup.attractedTick > lastTick
      || lastTick >= pickup.attractedTick + PICKUP_ATTRACT_TICKS
    )) {
      return invalid(`pickups[${index}].attractedTick must be a tick of the attraction that has not been collected yet`);
    }
    // 取り除く条件は一度成り立つと成り立ち続けるので、最後に動いた tick だけを見ればよい。
    if (isPickupGone(pickupPositionAt(pickup, definition, pickup.attractedTick ?? lastTick), definition.velocity)) {
      return invalid(`pickups[${index}] must not have been cleaned up since its spawn`);
    }
    pickups.push(pickup);
  }
  const dropBudget = validateDropBudget(pickups, context);
  if (!dropBudget.ok) {
    return dropBudget;
  }
  return okResult({ pickups });
}

/** spawn から `expectedTick` までに出し得る pickup の数（処理した timeline の enemy がすべて撃破された場合）。 */
export function maxPickupAllocations(context: FeatureAllocationContext<PickupContent>): number {
  return context.stage.timeline
    .filter((step) => step.tick < context.expectedTick)
    .reduce((total, step) => total + countDrops(context.content.dropsByEnemyId.get(step.action.enemy)), 0);
}

/**
 * pickup は出た tick の basic の採番（scoring より前）の後に採番する。出た tick 以前に採番された basic の entity は id が小さく、後の
 * tick の entity は id が大きい。
 */
function followsAllocationOrder(pickup: PickupEntityState, allocationTicks: ReadonlyMap<number, number>): boolean {
  if (allocationTicks.has(pickup.id)) {
    return false;
  }
  for (const [id, tick] of allocationTicks) {
    if ((id < pickup.id) !== (tick <= pickup.spawnTick)) {
      return false;
    }
  }
  return true;
}

/** 定義ごとに、各 `spawnTick` までに出た pickup の数が、その tick までに timeline が出した enemy の drops の数を超えないか。 */
function validateDropBudget(
  pickups: readonly PickupEntityState[],
  context: FeatureRestoreContext<PickupContent>,
): CoreResult<null> {
  const dropped = new Map<PickupId, number>();
  for (const pickup of pickups) {
    const count = (dropped.get(pickup.definitionId) ?? 0) + 1;
    dropped.set(pickup.definitionId, count);
    const droppable = context.stage.timeline
      .filter((step) => step.tick <= pickup.spawnTick)
      .reduce((total, step) => total + (context.content.dropsByEnemyId.get(step.action.enemy) ?? [])
        .filter((drop) => drop.pickup === pickup.definitionId)
        .reduce((sum, drop) => sum + drop.count, 0), 0);
    if (count > droppable) {
      return invalid(`pickups must not exceed the ${pickup.definitionId} drops of the enemies spawned by tick ${pickup.spawnTick}`);
    }
  }
  return okResult(null);
}

function parsePickup(value: SerializedJsonValue): PickupEntityState | null {
  const record = asRecord(value);
  const position = asRecord(record?.spawnPosition);
  if (
    !record || !hasExactKeys(record, PICKUP_KEYS)
    || !isPositiveSafeInteger(record.id)
    || typeof record.definitionId !== "string" || !record.definitionId.startsWith("pickup.")
    || !isNonNegativeSafeInteger(record.spawnTick)
    || !position || !hasExactKeys(position, ["x", "y"])
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

/** `keys` をちょうど持つか（`shared/guards.ts` の `hasOnlyKeys` は余分な key だけを見るので、欠けた key も見るこちらを使う）。 */
function hasExactKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function invalid(message: string): CoreResult<never> {
  return coreError("state.invalidShape", message);
}
