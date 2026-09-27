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

/**
 * 自機（192, 400）の shot が tick 0 に真上（192, 380）の scout を撃破し、scout が score pickup を 3 個（幅 20 px）落とす definition。
 *
 * pickup は x = 182, 192, 202 に出て毎 tick 1.5 px 落ちる。`magnetRadius` を渡さなければ、真ん中の pickup だけが tick 7 に自機の
 * `collectRadius`（10）に入って回収され、両脇は tick 67 に playfield の下の cleanup 境界を越えて消える。`magnetRadius: 40` なら
 * 3 個とも tick 0 に吸い寄せに入り、tick 12 に回収される。stage は tick 36,000 の 2 体目まで終わらない。
 */
export function createDroppingEnemyDefinition(options: Readonly<{ magnetRadius?: number }> = {}): GameDefinition {
  const definition = createMinimumDefinition();
  const pickup = { ...without(SCORE_SMALL_PICKUP, "magnetRadius"), ...(options.magnetRadius === undefined ? {} : { magnetRadius: options.magnetRadius }) };
  const spawnScout = (tick: number, y: number) => ({
    tick,
    action: { type: "spawnEnemy", enemy: "enemy.scout", path: "path.none", pattern: "pattern.none", position: { x: 192, y } },
  } as const);
  return {
    ...definition,
    enabledFeatures: ["pickup"],
    content: {
      ...definition.content,
      stages: [{ ...definition.content.stages[0]!, timeline: [spawnScout(0, 380), spawnScout(36_000, -16)] }],
      enemies: definition.content.enemies.map((enemy) => ({ ...enemy, drops: [{ pickup: "pickup.score_small", count: 3, spread: 20 }] })),
      playerShots: [{ ...definition.content.playerShots[0]!, damage: 10 }],
      features: { pickups: [pickup] },
    },
  } as unknown as GameDefinition;
}
