import type { Difficulty, GameDefinition, StartStageOptions } from "@shooting-sample/shooting-core";

/**
 * title から始める stage の difficulty を決める。`?difficulty=` の値（`requested`）を stage が持っていればそれを、なければ stage の
 * 最初の difficulty を使う。stage が difficulty を持たなければ null。
 */
export function selectStageDifficulty(difficulties: readonly Difficulty[], requested: string | null): Difficulty | null {
  return difficulties.find((difficulty) => difficulty === requested) ?? difficulties[0] ?? null;
}

/**
 * title から始める stage と difficulty。stage select を置くまでは content の最初の stage を、`?difficulty=` の difficulty（stage が
 * 持たなければ最初の difficulty）で始める。stage か difficulty がなければ null。
 */
export function selectStartStage(
  definition: GameDefinition,
  requestedDifficulty: string | null,
): Omit<StartStageOptions, "seed"> | null {
  const stage = definition.content.stages[0];
  const difficulty = stage ? selectStageDifficulty(stage.difficulties, requestedDifficulty) : null;
  return stage && difficulty ? Object.freeze({ stageId: stage.id, difficulty }) : null;
}
