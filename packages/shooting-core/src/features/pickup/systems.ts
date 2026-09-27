import type { ReadonlyFeatureFrameState } from "../../basic/extension/feature-frame.ts";
import type { FeatureFrameContext, FeatureTickContext } from "../../basic/extension/feature-module.ts";
import { coreError, okResult } from "../../basic/result.ts";
import type { CoreResult } from "../../basic/result.ts";
import { MAX_ACTIVE_PICKUPS, PICKUP_ATTRACT_TICKS } from "./budgets.ts";
import { dropOffsets, isOutsidePickupBounds, pickupPositionAt } from "./model.ts";
import type { PickupContent, PickupEntityState, PickupFeatureState } from "./model.ts";

/**
 * system order の scoring（design 7.1）で pickup を進める。
 *
 * 1. この tick に撃破された enemy の drops から、collision resolution の順、drop の順、横の並びの順に pickup を出して採番する。
 *    active な pickup が上限を超えるなら何も出さずに fatal にする。
 * 2. すべての pickup を id の順に見る。吸い寄せに入った pickup は `PICKUP_ATTRACT_TICKS` tick 後に回収する。それ以外は、cleanup 境界の
 *    外なら event を出さずに取り除き、自機の中心から `collectRadius` 以内なら回収し、`magnetRadius` 以内なら吸い寄せに入る。
 *
 * 回収した pickup は `pickupCollected` と、score を足した `scoreChanged`（reason `pickupCollected`）を出す。
 */
export function advancePickups(
  state: PickupFeatureState,
  context: FeatureTickContext<PickupContent>,
): CoreResult<PickupFeatureState> {
  const spawned = spawnDrops(state, context);
  if (!spawned.ok) {
    return spawned;
  }
  const player = context.entities.find((entity) => entity.kind === "player");
  if (!player) {
    return coreError("stageSession.fatal", "pickup feature requires the player entity");
  }
  const kept: PickupEntityState[] = [];
  for (const pickup of [...state.pickups, ...spawned.value]) {
    const definition = context.content.pickupsById.get(pickup.definitionId);
    if (!definition) {
      return coreError("stageSession.fatal", `Pickup definition not found: ${pickup.definitionId}`);
    }
    if (pickup.attractedTick !== null) {
      if (context.tick >= pickup.attractedTick + PICKUP_ATTRACT_TICKS) {
        collect(pickup, definition.score, context);
      } else {
        kept.push(pickup);
      }
      continue;
    }
    const position = pickupPositionAt(pickup, definition, context.tick);
    if (isOutsidePickupBounds(position)) {
      continue;
    }
    const dx = position.x - player.position.x;
    const dy = position.y - player.position.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= definition.collectRadius * definition.collectRadius) {
      collect(pickup, definition.score, context);
    } else if (definition.magnetRadius !== undefined && distanceSquared <= definition.magnetRadius * definition.magnetRadius) {
      kept.push({ ...pickup, attractedTick: context.tick });
    } else {
      kept.push(pickup);
    }
  }
  return okResult({ pickups: kept });
}

/** この tick に撃破された enemy の drops から pickup を出す。出した pickup は `pickupsSpawnedBatch` で知らせる。 */
function spawnDrops(
  state: PickupFeatureState,
  context: FeatureTickContext<PickupContent>,
): CoreResult<readonly PickupEntityState[]> {
  const drops = context.defeatedEnemies.flatMap((enemy) => (context.content.dropsByEnemyId.get(enemy.definitionId) ?? [])
    .flatMap((drop) => dropOffsets(drop).map((offset) => ({
      definitionId: drop.pickup,
      spawnPosition: { x: enemy.position.x + offset, y: enemy.position.y },
    }))));
  if (drops.length === 0) {
    return okResult([]);
  }
  if (state.pickups.length + drops.length > MAX_ACTIVE_PICKUPS) {
    return coreError(
      "pickup.budgetExceeded",
      `active pickups would exceed ${MAX_ACTIVE_PICKUPS}: ${state.pickups.length} active and ${drops.length} dropped`,
    );
  }
  const ids = context.allocateEntityIds(drops.length);
  if (!ids.ok) {
    return ids;
  }
  const pickups = drops.map((drop, index) => ({ id: ids.value[index]!, ...drop, spawnTick: context.tick, attractedTick: null }));
  const [first, ...rest] = pickups.map((pickup) => ({
    entityId: pickup.id,
    definitionId: pickup.definitionId,
    position: pickup.spawnPosition,
  }));
  context.emitEvent({ type: "pickupsSpawnedBatch", tick: context.tick, pickups: [first!, ...rest] });
  return okResult(pickups);
}

function collect(pickup: PickupEntityState, score: number, context: FeatureTickContext<PickupContent>): void {
  context.emitEvent({ type: "pickupCollected", tick: context.tick, entityId: pickup.id, definitionId: pickup.definitionId });
  const total = context.addScore(score);
  context.emitEvent({
    type: "scoreChanged",
    tick: context.tick,
    delta: score,
    total,
    reason: "pickupCollected",
    pickupId: pickup.definitionId,
    entityId: pickup.id,
  });
}

/** frame の `state.features.pickups`。tick の終わりの位置と、吸い寄せに入っているか。 */
export function projectPickupFrame(state: PickupFeatureState, context: FeatureFrameContext<PickupContent>): ReadonlyFeatureFrameState {
  return {
    pickups: state.pickups.map((pickup) => ({
      id: pickup.id,
      definitionId: pickup.definitionId,
      position: pickupPositionAt(pickup, context.content.pickupsById.get(pickup.definitionId)!, context.tick),
      attracted: pickup.attractedTick !== null,
    })),
  };
}
