import type { GameLifecycleState } from "../lifecycle/game-lifecycle.ts";

/** 無敵中の点滅の半周期（tick）。この tick 数ずつ自機を隠して表示する。 */
export const INVINCIBILITY_BLINK_HALF_PERIOD_TICKS = 4;

/**
 * 被弾後の無敵中の自機を、`GameFrame.state.player.invincibleTicksRemaining` から点滅させる（render-only）。
 *
 * `playerHit` event ではなく state の残り tick から決めるため、restore した stage や event を取りこぼした frame でも同じ見た目になる。
 * 無敵でなければ常に表示し、無敵中は残り tick を半周期ごとの区間に分けて、残りが少ない側から隠す・表示するを交互に繰り返す。
 */
export function isPlayerVisibleWhileInvincible(invincibleTicksRemaining: number): boolean {
  if (invincibleTicksRemaining <= 0) {
    return true;
  }
  return Math.floor(invincibleTicksRemaining / INVINCIBILITY_BLINK_HALF_PERIOD_TICKS) % 2 === 1;
}

/**
 * lifecycle を踏まえた自機の表示。点滅は tick が進む `playing` の間だけにし、`paused` や stage の終了で tick が止まったときに
 * 隠れた相のまま自機が消えて見えないようにする。
 */
export function isPlayerVisible(lifecycle: GameLifecycleState, invincibleTicksRemaining: number): boolean {
  return lifecycle !== "playing" || isPlayerVisibleWhileInvincible(invincibleTicksRemaining);
}
