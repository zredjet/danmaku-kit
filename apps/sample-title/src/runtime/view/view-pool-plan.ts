import type { GameDefinition, PlayerId, StageId } from "@shooting-sample/shooting-core";

import type { ViewKind } from "./view-entities.ts";

type EntityKind = ViewKind;

/** design 14 の runtime budget。kind ごとの view pool の capacity の上限にする。 */
export const VIEW_POOL_BUDGET: Readonly<Record<EntityKind, number>> = Object.freeze({
  player: 1,
  enemy: 100,
  enemyBullet: 2_000,
  playerShot: 300,
  pickup: 300,
});

/** kind ごとの view pool の capacity か、stage を始められない理由。 */
export type ViewPoolPlan =
  | Readonly<{ ok: true; capacities: Readonly<Record<EntityKind, number>> }>
  | Readonly<{ ok: false; error: string }>;

/**
 * stage start 前に、content と runtime budget から kind ごとの view pool の capacity を見積もる（design 5.4）。
 *
 * - player は 1。
 * - player shot は 1 回の発射で 1 発なので、lifetime の間に interval ごとに撃てる `floor(lifetime / interval) + 1` 発まで同時に
 *   存在し得る。budget を超えるなら stage を始めない。
 * - enemy は timeline の spawn 数と budget の小さい方。退場の時刻は path から静的に見積もらないため、spawn 数が budget を超える
 *   stage では同時数が budget を超えた時点で pool が枯渇する。
 * - enemy bullet は、timeline の pattern が `steps` を持つなら Core の active 上限（budget と同じ 2,000）、`fireOnSpawn` だけなら
 *   その spawn 数と budget の小さい方。
 * - pickup は、pickup feature が有効なら timeline の enemy がすべて落とした場合の数と budget（Core の active 上限と同じ 300）の小さい方、
 *   有効でなければ 0。
 */
export function planViewPoolCapacities(definition: GameDefinition, stageId: StageId, playerId: PlayerId): ViewPoolPlan {
  const { content } = definition;
  const stage = content.stages.find((candidate) => candidate.id === stageId);
  const player = content.players.find((candidate) => candidate.id === playerId);
  const playerShot = content.playerShots.find((candidate) => candidate.id === player?.shot.definition);
  if (!stage || !player || !playerShot) {
    return Object.freeze({ ok: false, error: `stage ${stageId} or player ${playerId} is not in the content` });
  }
  const playerShots = Math.floor(playerShot.projectile.lifetimeTicks / playerShot.fire.intervalTicks) + 1;
  if (playerShots > VIEW_POOL_BUDGET.playerShot) {
    return Object.freeze({
      ok: false,
      error: `player shots can reach ${playerShots} at once, over the view budget ${VIEW_POOL_BUDGET.playerShot}`,
    });
  }
  const patternsById = new Map(content.patterns.map((pattern) => [pattern.id, pattern]));
  const spawnedPatterns = stage.timeline.map((step) => patternsById.get(step.action.pattern));
  const enemyBullets = spawnedPatterns.some((pattern) => pattern?.steps !== undefined)
    ? VIEW_POOL_BUDGET.enemyBullet
    : Math.min(VIEW_POOL_BUDGET.enemyBullet, spawnedPatterns.filter((pattern) => pattern?.fireOnSpawn !== undefined).length);
  const dropsByEnemyId = new Map(content.enemies.map((enemy) => [
    enemy.id,
    (enemy.drops ?? []).reduce((total, drop) => total + drop.count, 0),
  ]));
  const pickups = definition.enabledFeatures.includes("pickup")
    ? Math.min(VIEW_POOL_BUDGET.pickup, stage.timeline.reduce((total, step) => total + (dropsByEnemyId.get(step.action.enemy) ?? 0), 0))
    : 0;
  return Object.freeze({
    ok: true,
    capacities: Object.freeze({
      player: VIEW_POOL_BUDGET.player,
      enemy: Math.min(VIEW_POOL_BUDGET.enemy, stage.timeline.length),
      enemyBullet: enemyBullets,
      playerShot: playerShots,
      pickup: pickups,
    }),
  });
}
