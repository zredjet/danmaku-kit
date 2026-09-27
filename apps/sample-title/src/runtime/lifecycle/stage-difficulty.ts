import type { Difficulty } from "@shooting-sample/shooting-core";

/**
 * title から始める stage の difficulty を決める。`?difficulty=` の値（`requested`）を stage が持っていればそれを、なければ stage の
 * 最初の difficulty を使う。stage が difficulty を持たなければ null。
 */
export function selectStageDifficulty(difficulties: readonly Difficulty[], requested: string | null): Difficulty | null {
  return difficulties.find((difficulty) => difficulty === requested) ?? difficulties[0] ?? null;
}
