/** tick ごとの state hash を比較するための test-only sample。 */
export type StateHashSample = Readonly<{
  tick: number;
  hash: string;
}>;

/** 最初に不一致になった state hash の最小報告。 */
export type FirstStateHashDivergence = Readonly<{
  tick: number;
  expectedHash: string | null;
  actualHash: string | null;
}>;

/**
 * tick 昇順の state hash 列を比較し、最初の hash または列長の不一致を返す。
 *
 * hash 詳細、entity diff、event diff、PRNG diff は Phase 1C の debug artifact 側で扱うため、
 * この helper は replay determinism test に必要な最小情報だけを返す。
 */
export function findFirstStateHashDivergence(
  expected: readonly StateHashSample[],
  actual: readonly StateHashSample[],
): FirstStateHashDivergence | null {
  const commonLength = Math.min(expected.length, actual.length);
  for (let index = 0; index < commonLength; index += 1) {
    const expectedSample = expected[index]!;
    const actualSample = actual[index]!;
    if (expectedSample.tick !== actualSample.tick || expectedSample.hash !== actualSample.hash) {
      return Object.freeze({
        tick: Math.min(expectedSample.tick, actualSample.tick),
        expectedHash: expectedSample.hash,
        actualHash: actualSample.hash,
      });
    }
  }
  if (expected.length === actual.length) {
    return null;
  }
  const expectedSample = expected[commonLength];
  const actualSample = actual[commonLength];
  return Object.freeze({
    tick: expectedSample?.tick ?? actualSample!.tick,
    expectedHash: expectedSample?.hash ?? null,
    actualHash: actualSample?.hash ?? null,
  });
}
