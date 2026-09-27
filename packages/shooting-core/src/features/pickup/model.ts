import type { EnemyDropDefinition, EnemyId, PickupDefinition, PickupId } from "../../basic/content/types.ts";
import { PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../../basic/extension/playfield.ts";
import { PICKUP_CLEANUP_PLAYFIELD_MARGIN } from "./budgets.ts";

/** pickup feature が load 時に作る content。 */
export type PickupContent = Readonly<{
  pickupsById: ReadonlyMap<PickupId, PickupDefinition>;
  /** drops を持つ enemy の drops。 */
  dropsByEnemyId: ReadonlyMap<EnemyId, readonly EnemyDropDefinition[]>;
}>;

type Position = Readonly<{ x: number; y: number }>;

/**
 * active な pickup の runtime state（JSON 互換）。
 *
 * 位置は持たず、`spawnPosition + velocity * (tick - spawnTick)` で毎 tick 求め直す（加算を積まない）。吸い寄せに入った pickup は
 * `attractedTick` の位置で止まる。
 */
export type PickupEntityState = Readonly<{
  id: number;
  definitionId: PickupId;
  spawnTick: number;
  spawnPosition: Position;
  /** 吸い寄せに入った tick。入っていなければ null。 */
  attractedTick: number | null;
}>;

/** pickup feature の state。pickup は id の昇順に並ぶ。 */
export type PickupFeatureState = Readonly<{
  pickups: readonly PickupEntityState[];
}>;

export const INITIAL_PICKUP_FEATURE_STATE: PickupFeatureState = Object.freeze({ pickups: Object.freeze([]) });

/** `tick` の終わりの pickup の位置。吸い寄せに入った pickup は `attractedTick` の位置のまま。 */
export function pickupPositionAt(pickup: PickupEntityState, definition: PickupDefinition, tick: number): Position {
  const age = (pickup.attractedTick ?? tick) - pickup.spawnTick;
  return {
    x: pickup.spawnPosition.x + definition.velocity.x * age,
    y: pickup.spawnPosition.y + definition.velocity.y * age,
  };
}

/** pickup の中心が cleanup 境界（playfield から `PICKUP_CLEANUP_PLAYFIELD_MARGIN` 外）より外にあるか。 */
export function isOutsidePickupBounds(position: Position): boolean {
  return position.x < -PICKUP_CLEANUP_PLAYFIELD_MARGIN
    || position.x > PLAYFIELD_WIDTH + PICKUP_CLEANUP_PLAYFIELD_MARGIN
    || position.y < -PICKUP_CLEANUP_PLAYFIELD_MARGIN
    || position.y > PLAYFIELD_HEIGHT + PICKUP_CLEANUP_PLAYFIELD_MARGIN;
}

/** drop の `count` 個を、撃破した位置を中心に横へ `spread` px の幅で等間隔に並べた x の差。 */
export function dropOffsets(drop: EnemyDropDefinition): readonly number[] {
  const spread = drop.spread ?? 0;
  return Array.from({ length: drop.count }, (_, index) => (drop.count > 1 ? index * spread / (drop.count - 1) - spread / 2 : 0));
}

/** enemy の drops で出る pickup の数。 */
export function countDrops(drops: readonly EnemyDropDefinition[] | undefined): number {
  return (drops ?? []).reduce((total, drop) => total + drop.count, 0);
}
