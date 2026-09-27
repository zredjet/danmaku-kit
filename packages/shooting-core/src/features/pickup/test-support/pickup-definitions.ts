import { createMinimumDefinition } from "../../../../../../tests/fixtures/minimum-game-definition.ts";
import type { GameDefinition } from "../../../basic/content/types.ts";

/** 最小の定義の asset を借りた、下へ落ちる score pickup。 */
export const SCORE_SMALL_PICKUP = Object.freeze({
  id: "pickup.score_small",
  version: 1,
  asset: "enemy.scout",
  score: 100,
  collectRadius: 10,
  magnetRadius: 80,
  velocity: Object.freeze({ x: 0, y: 1.5 }),
});

export type PickupDefinitionOptions = Readonly<{
  /** `enabledFeatures` に pickup を入れるか（既定は入れる）。 */
  enabled?: boolean;
  /** `content.features.pickups`（`undefined` なら collection を置かない）。検証の test のため unknown で受ける。 */
  pickups?: unknown;
  /** 最小の定義の enemy の `drops`（`undefined` なら置かない）。 */
  drops?: unknown;
}>;

/** 最小の定義に pickup feature の content を足した定義。形の誤りを試せるよう、値は検証せずに置く。 */
export function createPickupDefinition({ enabled = true, pickups, drops }: PickupDefinitionOptions): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    enabledFeatures: enabled ? ["pickup"] : [],
    content: {
      ...definition.content,
      enemies: definition.content.enemies.map((enemy) => (drops === undefined ? enemy : { ...enemy, drops })),
      ...(pickups === undefined ? {} : { features: { pickups } }),
    },
  } as unknown as GameDefinition;
}

/** `key` を持たない copy。`undefined` の field は JSON 互換でないため、field を省いた定義はこれで作る。 */
export function without(record: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}
