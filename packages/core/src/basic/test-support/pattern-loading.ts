import assert from "node:assert/strict";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { loadUnknown } from "./stage-harness.ts";

/** 最小の定義の pattern（stage が使う `pattern.none`）を差し替えた定義を読む。 */
export function loadWithPattern(pattern: Record<string, unknown>) {
  const definition = createMinimumDefinition();
  return loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      patterns: [{ id: "pattern.none", version: 1, ...pattern }],
    },
  });
}

/** 最小の定義の stage を `difficulties` にして、その stage が使う pattern を差し替えた定義を読む。 */
export function loadWithPatternForDifficulties(pattern: Record<string, unknown>, difficulties: readonly string[]) {
  const definition = createMinimumDefinition();
  return loadUnknown({
    ...definition,
    content: {
      ...definition.content,
      stages: definition.content.stages.map((stage) => ({ ...stage, difficulties })),
      patterns: [{ id: "pattern.none", version: 1, ...pattern }],
    },
  });
}

type LoadResult = ReturnType<typeof loadWithPattern>;

/** 読めなかった定義の error を code、schema path、message の組にする。 */
export function errorsOf(loaded: LoadResult): ReadonlyArray<readonly [string, string | undefined, string]> {
  assert.equal(loaded.ok, false);
  return loaded.ok ? [] : loaded.errors.map((error) => [error.code, error.schemaPath, error.message] as const);
}

/** 読めた定義の warning。 */
export function warningsOf(loaded: LoadResult) {
  assert.equal(loaded.ok, true);
  return loaded.ok ? loaded.warnings : [];
}

/** 真下へ `count` 発の fan（1 発なら fan なし）を撃つ step。 */
export function fanFire(count: number): Record<string, unknown> {
  return { fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 2, ...(count > 1 ? { fan: { count, spreadDeg: count - 1 } } : {}) } };
}
