/** Simulation の固定 tick rate（design 7）。 */
export const FIXED_TICKS_PER_SECOND = 60;

/** 1 render frame で実行する catch-up tick の上限（design 7）。 */
export const MAX_CATCH_UP_TICKS_PER_FRAME = 5;

/** 1 render frame の経過時間から決まった、実行する tick 数と破棄した tick 数。 */
export type FixedTickAdvance = Readonly<{
  ticks: number;
  droppedTicks: number;
}>;

/**
 * render frame の可変 delta を固定 tick 数へ変換する accumulator。
 *
 * 経過時間は tick 単位で積み、1 frame で実行する tick を `MAX_CATCH_UP_TICKS_PER_FRAME` に制限する。上限を超えた frame では
 * 超過分を端数も含めて accumulator に残さず破棄し、`RuntimeDroppedTicks` として数える。破棄した tick は Simulation の
 * 入力として補完しないため、tick 番号は実際に実行した tick だけ進む。
 */
export class FixedTickClock {
  #accumulatedTicks = 0;
  #droppedTicksTotal = 0;

  /** render frame の経過時間（ms）を積み、この frame で実行する tick 数を返す。有限でない値と負の値は 0 として扱う。 */
  advance(deltaMs: number): FixedTickAdvance {
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      // ms のまま tick 長（1000 / 60 ms）で割ると 50 ms が 2.999... tick に丸まるため、tick 単位へ先に換算する。
      this.#accumulatedTicks += (deltaMs * FIXED_TICKS_PER_SECOND) / 1000;
    }
    const dueTicks = Math.floor(this.#accumulatedTicks);
    if (dueTicks <= MAX_CATCH_UP_TICKS_PER_FRAME) {
      this.#accumulatedTicks -= dueTicks;
      return Object.freeze({ ticks: dueTicks, droppedTicks: 0 });
    }
    const droppedTicks = dueTicks - MAX_CATCH_UP_TICKS_PER_FRAME;
    this.#accumulatedTicks = 0;
    this.#droppedTicksTotal += droppedTicks;
    return Object.freeze({ ticks: MAX_CATCH_UP_TICKS_PER_FRAME, droppedTicks });
  }

  /** pause、focus lost、visibility change で、停止中の経過時間を Simulation に渡さないよう accumulator を捨てる。 */
  reset(): void {
    this.#accumulatedTicks = 0;
  }

  /** 起動からの `RuntimeDroppedTicks` の合計。debug HUD と optional diagnostics に使う。 */
  get droppedTicksTotal(): number {
    return this.#droppedTicksTotal;
  }
}
