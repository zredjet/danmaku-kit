import type { GameDefinition } from "@shooting-sample/shooting-core";

import { enabledPickups } from "./definition-assets.ts";

/**
 * content 定義の collision radius を definition id から引ける表にする。
 *
 * `GameFrame` の entity は位置と definition id だけを持つため、自機判定や collider の表示は app が持つ content 定義から半径を引く。
 * definition id は種類ごとの namespace prefix を持つので、全種類を 1 つの表にまとめても衝突しない。
 */
export function collectCollisionRadii(definition: GameDefinition): ReadonlyMap<string, number> {
  const { players, enemies, bullets, playerShots } = definition.content;
  return new Map<string, number>([
    ...[...players, ...enemies, ...bullets, ...playerShots].map((item) => [item.id, item.collision.radius] as const),
    // pickup は自機の中心がこの半径に入ると回収される。
    ...enabledPickups(definition).map((pickup) => [pickup.id, pickup.collectRadius] as const),
  ]);
}
