import type { GameDefinition, StageDefinition, StageId } from "@shooting-sample/shooting-core";

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

/** stage jump で選べる tick（0 と、timeline の spawn の tick を重複なく昇順に）。 */
export function stageJumpTicks(stage: StageDefinition): readonly number[] {
  return Object.freeze([...new Set([0, ...stage.timeline.map((step) => step.tick)])].sort((left, right) => left - right));
}

/**
 * 合成した definition に cheat を当てる。
 *
 * - stage jump は、`stageId` の stage の timeline から `jumpTick` より前の spawn を除き、残りを `jumpTick` だけ前へ詰めた stage を
 *   content の id と重ならない id で足す（content の stage は変えないので、元の stage の再生記録と混ざらない）。
 * - invincible は既定の自機の lives を `PREVIEW_INVINCIBLE_LIVES` にする。
 */
export function applyPreviewCheats(
  definition: GameDefinition,
  stageId: StageId,
  cheats: PreviewCheats,
): Readonly<{ definition: GameDefinition; stageId: StageId }> {
  const stage = definition.content.stages.find((candidate) => candidate.id === stageId);
  const jumped = stage && cheats.jumpTick > 0 ? jumpStage(definition, stage, cheats.jumpTick) : { definition, stageId };
  return Object.freeze({
    definition: cheats.invincible ? withInvinciblePlayer(jumped.definition) : jumped.definition,
    stageId: jumped.stageId,
  });
}

function jumpStage(
  definition: GameDefinition,
  stage: StageDefinition,
  jumpTick: number,
): Readonly<{ definition: GameDefinition; stageId: StageId }> {
  const stageId = unusedId(`${stage.id}_jump` as StageId, definition.content.stages);
  const timeline = stage.timeline
    .filter((step) => step.tick >= jumpTick)
    .map((step) => ({ ...step, tick: step.tick - jumpTick }));
  return {
    definition: {
      ...definition,
      content: { ...definition.content, stages: [...definition.content.stages, { ...stage, id: stageId, timeline }] },
    },
    stageId,
  };
}

function withInvinciblePlayer(definition: GameDefinition): GameDefinition {
  return {
    ...definition,
    content: {
      ...definition.content,
      players: definition.content.players.map((player) => player.id === definition.defaultPlayerId
        ? { ...player, life: { ...player.life, initialLives: PREVIEW_INVINCIBLE_LIVES } }
        : player),
    },
  };
}
