import type { EnemyDefinition, GameDefinition, PickupDefinition, PickupId } from "../../basic/content/types.ts";
import {
  validateAllowedKeys,
  validateAssetReference,
  validateContentItem,
  validateFiniteNumberWithinAbs,
  validateNamespacedReference,
  validateNonEmptyString,
  validateNonNegativeInteger,
  validateNonNegativeNumberAtMost,
  validateNumberAtMost,
  validateObjectArray,
  validatePositiveInteger,
  validatePositiveIntegerAtMost,
  validatePositiveNumber,
  validateUniqueIds,
} from "../../basic/extension/content-validation.ts";
import { errorResult, okResult } from "../../basic/result.ts";
import type { CoreError, CoreResult } from "../../basic/result.ts";
import { asRecord } from "../../basic/shared/guards.ts";
import {
  MAX_PICKUP_COLLECT_RADIUS,
  MAX_PICKUP_DROP_SPREAD,
  MAX_PICKUP_DROPS_PER_ENEMY,
  MAX_PICKUP_MAGNET_RADIUS,
  MAX_PICKUP_SPEED_PER_AXIS,
} from "./budgets.ts";
import type { PickupContent } from "./model.ts";

/**
 * pickup feature の content を検証し、pickup の索引を作る（design 9.9 / 20）。
 *
 * 有効な pickup feature は `content.features.pickups` を必要とする（pickup のない content は空の配列にする）。その pickup と enemy の
 * `drops` の形を検証し、形が正しければ pickup の id、asset、drops の参照を解決する。
 */
export function loadPickupContent(definition: GameDefinition): CoreResult<PickupContent> {
  const errors: CoreError[] = [];
  const pickups = definition.content.features?.pickups;
  if (pickups === undefined) {
    return errorResult([{
      code: "definition.invalidShape",
      message: "content.features.pickups must be an array when the pickup feature is enabled",
      schemaPath: "content.features.pickups",
    }]);
  }
  const records = validateObjectArray("content.features.pickups", pickups, errors);
  for (const { record, index } of records.items) {
    validateContentItem(`content.features.pickups[${index}]`, "pickup", record, errors, () => validatePickupShape(record, errors));
  }
  definition.content.enemies.forEach((enemy, index) => {
    if (enemy.drops !== undefined) {
      validateContentItem(`content.enemies[${index}]`, "enemy", enemy, errors, () => validateDropsShape(enemy.drops, errors));
    }
  });
  if (errors.length > 0) {
    return errorResult(errors);
  }

  validateUniqueIds("pickup", "features.pickups", pickups, errors);
  const assetKeys = new Set(definition.content.assetKeys.keys);
  pickups.forEach((pickup, index) => validateAssetReference(
    pickup.asset,
    assetKeys,
    { schemaPath: `content.features.pickups[${index}].asset`, referrerId: pickup.id },
    errors,
  ));
  const pickupsById = new Map(pickups.map((pickup) => [pickup.id, pickup] as const));
  definition.content.enemies.forEach((enemy, enemyIndex) => validateDropReferences(enemy, enemyIndex, pickupsById, errors));
  if (errors.length > 0) {
    return errorResult(errors);
  }
  const dropsByEnemyId = new Map(definition.content.enemies.flatMap((enemy) => enemy.drops ? [[enemy.id, enemy.drops] as const] : []));
  return okResult(Object.freeze({ pickupsById, dropsByEnemyId }));
}

function validatePickupShape(pickup: Record<string, unknown>, errors: CoreError[]): void {
  validateAllowedKeys("pickup", pickup, ["id", "version", "asset", "score", "collectRadius", "magnetRadius", "velocity"], errors);
  validateNonEmptyString("pickup.id", pickup.id, errors);
  validatePositiveInteger("pickup.version", pickup.version, errors);
  validateNonEmptyString("pickup.asset", pickup.asset, errors);
  validateNonNegativeInteger("pickup.score", pickup.score, errors);
  validatePositiveNumber("pickup.collectRadius", pickup.collectRadius, errors);
  validateNumberAtMost("pickup.collectRadius", pickup.collectRadius, MAX_PICKUP_COLLECT_RADIUS, String(MAX_PICKUP_COLLECT_RADIUS), errors);
  if (pickup.magnetRadius !== undefined) {
    validateNonNegativeNumberAtMost("pickup.magnetRadius", pickup.magnetRadius, MAX_PICKUP_MAGNET_RADIUS, errors);
    // 回収する距離より内側の吸い寄せは意味がない。
    if (
      typeof pickup.magnetRadius === "number" && typeof pickup.collectRadius === "number"
      && pickup.magnetRadius <= pickup.collectRadius
    ) {
      errors.push({ code: "definition.invalidShape", message: "pickup.magnetRadius must be greater than pickup.collectRadius" });
    }
  }
  const velocity = asRecord(pickup.velocity);
  if (!velocity) {
    errors.push({ code: "definition.invalidShape", message: "pickup.velocity must be an object" });
    return;
  }
  validateAllowedKeys("pickup.velocity", velocity, ["x", "y"], errors);
  validateFiniteNumberWithinAbs("pickup.velocity.x", velocity.x, MAX_PICKUP_SPEED_PER_AXIS, errors);
  // pickup は下へ落ちて、回収されなければ playfield の下から出て消える（止まったまま残り続けない）。
  validatePositiveNumber("pickup.velocity.y", velocity.y, errors);
  validateNumberAtMost("pickup.velocity.y", velocity.y, MAX_PICKUP_SPEED_PER_AXIS, String(MAX_PICKUP_SPEED_PER_AXIS), errors);
}

/** enemy の `drops`（1 つ以上、`count` の合計が上限以内）の形を検証する。 */
function validateDropsShape(value: unknown, errors: CoreError[]): void {
  const drops = validateObjectArray("enemy.drops", value, errors);
  if (Array.isArray(value) && drops.sourceLength === 0) {
    errors.push({ code: "definition.invalidShape", message: "enemy.drops must contain at least 1 drop" });
  }
  const errorStart = errors.length;
  let total = 0;
  for (const { record: drop, index } of drops.items) {
    const path = `enemy.drops[${index}]`;
    validateAllowedKeys(path, drop, ["pickup", "count", "spread"], errors);
    validateNonEmptyString(`${path}.pickup`, drop.pickup, errors);
    validatePositiveIntegerAtMost(`${path}.count`, drop.count, MAX_PICKUP_DROPS_PER_ENEMY, errors);
    if (drop.spread !== undefined) {
      validateNonNegativeNumberAtMost(`${path}.spread`, drop.spread, MAX_PICKUP_DROP_SPREAD, errors);
    }
    total += typeof drop.count === "number" && Number.isSafeInteger(drop.count) && drop.count > 0 ? drop.count : 0;
  }
  // drop ごとの error があれば、合計は数え直した後にだけ見る。
  if (errors.length === errorStart && total > MAX_PICKUP_DROPS_PER_ENEMY) {
    errors.push({
      code: "definition.invalidConstraint",
      message: `enemy.drops must drop at most ${MAX_PICKUP_DROPS_PER_ENEMY} pickups in total`,
    });
  }
}

/** enemy の drops が参照する pickup が namespace を満たし、`content.features.pickups` にあるか検証する。 */
function validateDropReferences(
  enemy: EnemyDefinition,
  enemyIndex: number,
  pickupsById: ReadonlyMap<PickupId, PickupDefinition>,
  errors: CoreError[],
): void {
  enemy.drops?.forEach((drop, dropIndex) => {
    const schemaPath = `content.enemies[${enemyIndex}].drops[${dropIndex}].pickup`;
    const context = { schemaPath, referrerId: enemy.id, targetId: drop.pickup } as const;
    if (!validateNamespacedReference("enemy.drops[].pickup", "pickup", drop.pickup, errors, context)) {
      return;
    }
    if (!pickupsById.has(drop.pickup)) {
      errors.push({ code: "pickup.notFound", message: `Pickup not found: ${drop.pickup}`, ...context });
    }
  });
}
