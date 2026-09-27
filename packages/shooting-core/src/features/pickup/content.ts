import type { EnemyDefinition, GameDefinition, PickupDefinition } from "../../basic/content/types.ts";
import {
  validateAllowedKeys,
  validateAssetReference,
  validateContentItem,
  validateFiniteNumberWithinAbs,
  validateNamespacedReference,
  validateNonEmptyString,
  validateNonNegativeInteger,
  validateNonNegativeNumberAtMost,
  validateObjectArray,
  validatePositiveInteger,
  validatePositiveIntegerAtMost,
  validatePositiveNumber,
  validateUniqueIds,
} from "../../basic/extension/content-validation.ts";
import type { FeatureContentDiagnostics } from "../../basic/extension/feature-module.ts";
import type { CoreError } from "../../basic/result.ts";
import { asRecord } from "../../basic/shared/guards.ts";
import {
  MAX_PICKUP_COLLECT_RADIUS,
  MAX_PICKUP_DROP_SPREAD,
  MAX_PICKUP_DROPS_PER_ENEMY,
  MAX_PICKUP_MAGNET_RADIUS,
  MAX_PICKUP_SPEED_PER_AXIS,
} from "./budgets.ts";

/**
 * pickup feature の content を検証する（design 9.9 / 20）。
 *
 * basic の検証に通った definition の `content.features.pickups` と、enemy の `drops` の形を検証し、形が正しければ pickup の id、
 * asset、drops の参照を解決する。pickup を持たない（`content.features.pickups` のない）content でも、drops は pickup を参照できない
 * ので error になる。
 */
export function validatePickupContent(definition: GameDefinition): FeatureContentDiagnostics {
  const errors: CoreError[] = [];
  const pickups = definition.content.features?.pickups ?? [];
  if (definition.content.features?.pickups !== undefined) {
    const records = validateObjectArray("content.features.pickups", definition.content.features.pickups, errors);
    for (const { record, index } of records.items) {
      validateContentItem(`content.features.pickups[${index}]`, "pickup", record, errors, () => validatePickupShape(record, errors));
    }
  }
  definition.content.enemies.forEach((enemy, index) => {
    if (enemy.drops !== undefined) {
      validateContentItem(`content.enemies[${index}]`, "enemy", enemy, errors, () => validateDropsShape(enemy.drops, errors));
    }
  });
  if (errors.length > 0) {
    return { errors, warnings: [] };
  }

  validateUniqueIds("pickup", "features.pickups", pickups, errors);
  const assetKeys = new Set(definition.content.assetKeys.keys);
  pickups.forEach((pickup, index) => validateAssetReference(
    pickup.asset,
    assetKeys,
    { schemaPath: `content.features.pickups[${index}].asset`, referrerId: pickup.id },
    errors,
  ));
  const pickupIds = new Set(pickups.map((pickup) => pickup.id));
  definition.content.enemies.forEach((enemy, enemyIndex) => validateDropReferences(enemy, enemyIndex, pickupIds, errors));
  return { errors, warnings: [] };
}

function validatePickupShape(pickup: Record<string, unknown>, errors: CoreError[]): void {
  validateAllowedKeys("pickup", pickup, ["id", "version", "asset", "score", "collectRadius", "magnetRadius", "velocity"], errors);
  validateNonEmptyString("pickup.id", pickup.id, errors);
  validatePositiveInteger("pickup.version", pickup.version, errors);
  validateNonEmptyString("pickup.asset", pickup.asset, errors);
  validateNonNegativeInteger("pickup.score", pickup.score, errors);
  validatePositiveNumber("pickup.collectRadius", pickup.collectRadius, errors);
  if (typeof pickup.collectRadius === "number" && pickup.collectRadius > MAX_PICKUP_COLLECT_RADIUS) {
    errors.push({
      code: "definition.invalidShape",
      message: `pickup.collectRadius must be less than or equal to ${MAX_PICKUP_COLLECT_RADIUS}`,
    });
  }
  if (pickup.magnetRadius !== undefined) {
    validateNonNegativeNumberAtMost("pickup.magnetRadius", pickup.magnetRadius, MAX_PICKUP_MAGNET_RADIUS, errors);
  }
  const velocity = asRecord(pickup.velocity);
  if (!velocity) {
    errors.push({ code: "definition.invalidShape", message: "pickup.velocity must be an object" });
    return;
  }
  validateAllowedKeys("pickup.velocity", velocity, ["x", "y"], errors);
  validateFiniteNumberWithinAbs("pickup.velocity.x", velocity.x, MAX_PICKUP_SPEED_PER_AXIS, errors);
  validateFiniteNumberWithinAbs("pickup.velocity.y", velocity.y, MAX_PICKUP_SPEED_PER_AXIS, errors);
}

/** enemy の `drops`（1 つ以上、`count` の合計が上限以内）の形を検証する。 */
function validateDropsShape(value: unknown, errors: CoreError[]): void {
  const drops = validateObjectArray("enemy.drops", value, errors);
  if (Array.isArray(value) && drops.sourceLength === 0) {
    errors.push({ code: "definition.invalidShape", message: "enemy.drops must contain at least 1 drop" });
  }
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
  if (total > MAX_PICKUP_DROPS_PER_ENEMY) {
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
  pickupIds: ReadonlySet<PickupDefinition["id"]>,
  errors: CoreError[],
): void {
  enemy.drops?.forEach((drop, dropIndex) => {
    const schemaPath = `content.enemies[${enemyIndex}].drops[${dropIndex}].pickup`;
    const context = { schemaPath, referrerId: enemy.id, targetId: drop.pickup } as const;
    if (!validateNamespacedReference("enemy.drops[].pickup", "pickup", drop.pickup, errors, context)) {
      return;
    }
    if (!pickupIds.has(drop.pickup)) {
      errors.push({ code: "pickup.notFound", message: `Pickup not found: ${drop.pickup}`, ...context });
    }
  });
}
