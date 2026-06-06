import { deepFreezePlainData } from "../internal/immutable.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";

/** replay restore 用に保存する PRNG 内部状態。 */
export type SerializedPrngState = Readonly<{
  state: number;
}>;

/**
 * Core 内で使う決定的な 32bit PRNG。
 *
 * `Math.random()` を使わず、同じ seed と入力列なら同じ tick 結果になることを優先する。
 */
export class XorShift32 {
  #state: number;

  /** 文字列 seed または復元用の数値 seed から PRNG を初期化する。 */
  constructor(seed: string | number) {
    const parsedSeed = typeof seed === "number" ? seed : hashSeed(seed);
    this.#state = parsedSeed === 0 ? 0x6d2b79f5 : parsedSeed >>> 0;
  }

  /** 次の uint32 値を返し、内部状態を 1 step 進める。 */
  nextUint32(): number {
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state;
  }

  /** 現在の PRNG 状態を serialize 可能な値として取り出す。 */
  snapshot(): SerializedPrngState {
    return Object.freeze({ state: this.#state });
  }

  /**
   * snapshot から PRNG を復元する。
   *
   * 壊れた replay state を受け入れないよう、復元時も uint32 の範囲を検証する。
   */
  static restore(state: unknown): CoreResult<XorShift32> {
    const plainState = deepFreezePlainData(state);
    if (!plainState || typeof plainState !== "object" || Array.isArray(plainState)) {
      return coreError("prng.invalidState", "PRNG state must be a non-zero uint32");
    }
    const record = plainState as Record<string, unknown>;
    if (
      typeof record.state !== "number"
      || !Number.isSafeInteger(record.state)
      || record.state <= 0
      || record.state > 0xffffffff
    ) {
      return coreError("prng.invalidState", "PRNG state must be a non-zero uint32");
    }

    const restored = new XorShift32(1);
    restored.#state = record.state >>> 0;
    return okResult(restored);
  }
}

function hashSeed(seed: string): number {
  // FNV-1a で文字列 seed を platform-independent な 32bit 値へ寄せる。
  let hash = 0x811c9dc5;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
