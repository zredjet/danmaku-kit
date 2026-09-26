/** stage 開始演出（READY 表示）の長さ。 */
export const STAGE_START_DURATION_MS = 1_000;

/**
 * stage 開始演出の timer（design 6）。render frame の経過時間で進み、tick とは関係しない。
 *
 * focus lost / visibility change で `suspend()` すると、focus が戻った後の最初の frame の経過時間（focus 外にいた時間を含む）を
 * 数えず、開始演出が focus 外で進まないようにする。
 */
export class StageStartTimer {
  #remainingMs: number;
  #skipNextDelta = false;

  constructor(durationMs: number = STAGE_START_DURATION_MS) {
    this.#remainingMs = durationMs;
  }

  /** render frame の経過時間だけ進め、開始演出が終わったら true を返す。 */
  advance(deltaMs: number): boolean {
    if (this.#skipNextDelta) {
      this.#skipNextDelta = false;
    } else if (Number.isFinite(deltaMs) && deltaMs > 0) {
      this.#remainingMs -= deltaMs;
    }
    return this.#remainingMs <= 0;
  }

  /** focus 外にいた時間を数えないよう、次の frame の経過時間を捨てる。 */
  suspend(): void {
    this.#skipNextDelta = true;
  }
}
