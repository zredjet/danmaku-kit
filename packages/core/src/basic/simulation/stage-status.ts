import type { RuntimeEntityState } from "../entities/runtime-entity.ts";

/** stage session の進行状態。`playing` 以外は終端で、それ以降の tick を受け付けない。 */
export type StageStatus = "playing" | "stageCleared" | "gameOver";

/** `StageStatus` の実行時一覧。restore は未検証の値をこの一覧で判定する。 */
export const STAGE_STATUSES = Object.freeze(["playing", "stageCleared", "gameOver"] as const satisfies readonly StageStatus[]);

/** tick の終わりに stage の状態を決めるための state。 */
export type StageStatusInput = Readonly<{
  playerLives: number;
  timelineCursor: number;
  timelineLength: number;
  entities: readonly RuntimeEntityState[];
  /** 有効な feature の entity（pickup など）が残っていて、stage の clear を待たせるか。 */
  featuresHoldClear: boolean;
}>;

/**
 * cleanup 後の tick の終わりの state から stage の状態を決める（design 7.1）。
 *
 * 自機の残機が 0 なら gameOver、timeline をすべて処理して active な enemy がいなければ stageCleared とする。同じ tick に両方が
 * 成り立てば gameOver を優先する。敵弾が残っていても stageCleared にするが、有効な feature が待たせている間（回収されていない pickup
 * など）は clear にしない。restore も同じ規則で snapshot の状態を検証する。
 */
export function resolveStageStatusAfterTick(state: StageStatusInput): StageStatus {
  if (state.playerLives === 0) {
    return "gameOver";
  }
  if (
    state.timelineCursor >= state.timelineLength
    && !state.entities.some((entity) => entity.kind === "enemy")
    && !state.featuresHoldClear
  ) {
    return "stageCleared";
  }
  return "playing";
}
