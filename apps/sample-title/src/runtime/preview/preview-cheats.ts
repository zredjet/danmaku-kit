import type { GameDefinition, StageDefinition, StageId } from "@danmaku-kit/core";

import { unusedId } from "./preview-definition.ts";

/**
 * Preview の dev-only の cheat（design 19 / 25、Phase 2B-10）。Core に cheat の API は足さず、合成する definition で表す。cheat は
 * content を変えるだけなので、Core へ渡す入力と再生記録の入力には混ぜない。
 */
export type PreviewCheats = Readonly<{
  /** 被弾しても stage が終わらない自機（lives を `PREVIEW_INVINCIBLE_LIVES` にする）。 */
  invincible: boolean;
  /** stage jump。stage の timeline のこの tick より前の spawn を除いて詰める。0 は jump しない。 */
  jumpTick: number;
}>;

export const NO_PREVIEW_CHEATS: PreviewCheats = Object.freeze({ invincible: false, jumpTick: 0 });

/**
 * invincible の自機の lives。被弾の判定、無敵時間、lives の減り方は content のままで、stage が終わらないだけの数にする（1 tick に 1 回
 * 被弾し続けても約 16 分もつ）。
 */
export const PREVIEW_INVINCIBLE_LIVES = 60_000;

/** cheat を当てた stage の id の suffix。content の stage と同じ id の再生記録にならないよう、cheat を当てた stage は複製する。 */
export const PREVIEW_CHEAT_STAGE_SUFFIX = "_preview_cheat";

/** stage jump で選べる tick（0 と、timeline の spawn の tick を重複なく昇順に）。 */
export function stageJumpTicks(stage: StageDefinition): readonly number[] {
  return Object.freeze([...new Set([0, ...stage.timeline.map((step) => step.tick)])].sort((left, right) => left - right));
}

/**
 * `tick` を `stage` の jump で選べる tick に寄せる（`tick` 以下で最大の spawn の tick）。hot reload で jump 先の spawn の tick が
 * 動いても、その近くから始め直せるようにする。
 */
export function snapStageJumpTick(stage: StageDefinition, tick: number): number {
  return stageJumpTicks(stage).findLast((candidate) => candidate <= tick) ?? 0;
}

/**
 * 合成した definition に cheat を当てる。cheat を 1 つでも当てるなら、`stageId` の stage を content の id と重ならない id
 * （`<id>_preview_cheat`）で複製し、その stage で始める（content の stage は変えないので、cheat を当てた再生記録が content の stage の
 * 記録に見えない）。
 *
 * - stage jump は、複製した stage の timeline から `jumpTick` より前の spawn を除き、残りを `jumpTick` だけ前へ詰める。
 * - invincible は既定の自機の lives を `PREVIEW_INVINCIBLE_LIVES` にする。
 */
export function applyPreviewCheats(
  definition: GameDefinition,
  stageId: StageId,
  cheats: PreviewCheats,
): Readonly<{ definition: GameDefinition; stageId: StageId }> {
  const stage = definition.content.stages.find((candidate) => candidate.id === stageId);
  if (!stage || (!cheats.invincible && cheats.jumpTick <= 0)) {
    return Object.freeze({ definition, stageId });
  }
  const cheatStage: StageDefinition = {
    ...stage,
    id: unusedId(`${stage.id}${PREVIEW_CHEAT_STAGE_SUFFIX}` as StageId, definition.content.stages),
    timeline: stage.timeline
      .filter((step) => step.tick >= cheats.jumpTick)
      .map((step) => ({ ...step, tick: step.tick - cheats.jumpTick })),
  };
  const content = { ...definition.content, stages: [...definition.content.stages, cheatStage] };
  return Object.freeze({
    definition: {
      ...definition,
      content: cheats.invincible
        ? {
          ...content,
          players: content.players.map((player) => player.id === definition.defaultPlayerId
            ? { ...player, life: { ...player.life, initialLives: PREVIEW_INVINCIBLE_LIVES } }
            : player),
        }
        : content,
    },
    stageId: cheatStage.id,
  });
}
