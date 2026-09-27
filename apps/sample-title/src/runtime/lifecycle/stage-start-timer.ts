/** stage 開始演出（READY 表示）の長さ。 */
export const STAGE_START_DURATION_MS = 1_000;

/**
 * stage 開始演出の timer（design 6）。render frame の経過時間で進み、tick とは関係しない。
 *
 * focus lost / visibility change で `suspend()` すると、`resume()` まで進まない（window が表示されたまま focus だけを失っても
 * render frame は続くため）。`resume()` の後の最初の frame の経過時間は、focus 外にいた時間を含み得るので数えない。
 */
export class StageStartTimer {
  #remainingMs: number;
  #suspended = false;
  #skipNextDelta = false;

  constructor(durationMs: number = STAGE_START_DURATION_MS) {
    this.#remainingMs = durationMs;
  }

  /** render frame の経過時間だけ進め、開始演出が終わったら true を返す。止めている間は進めない。 */
  advance(deltaMs: number): boolean {
    if (this.#suspended) {
      return false;
    }
    if (this.#skipNextDelta) {
      this.#skipNextDelta = false;
    } else if (Number.isFinite(deltaMs) && deltaMs > 0) {
      this.#remainingMs -= deltaMs;
    }
    return this.#remainingMs <= 0;
  }

  /** focus lost / visibility change で、focus が戻るまで止める。 */
  suspend(): void {
    this.#suspended = true;
  }

  /** focus が戻ったら再開する。focus 外にいた時間を数えないよう、次の frame の経過時間は捨てる。止めていなければ何もしない。 */
  resume(): void {
    if (this.#suspended) {
      this.#suspended = false;
      this.#skipNextDelta = true;
    }
  }
}
