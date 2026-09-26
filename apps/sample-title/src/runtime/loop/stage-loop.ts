import type { CoreError, GameEvent, GameFrame, InputFrame, StageSession } from "@shooting-sample/shooting-core";

import type { KeyboardInputAdapter } from "../input/keyboard-input.ts";
import { FixedTickClock } from "./fixed-tick-clock.ts";

/** 1 render frame を進めた結果。tick が失敗した後は、同じ error を返し続ける。 */
export type StageLoopStep =
  | Readonly<{
    ok: true;
    /** 直近に実行した tick の frame。まだ 1 tick も実行していなければ null。描画はこの state を正本にする。 */
    latestFrame: GameFrame | null;
    /** 直近の tick で Core へ渡した入力。focus 中の判定表示など、描画側が入力状態を読むために使う。 */
    latestInput: InputFrame | null;
    /** この render frame で実行した全 tick の event を、実行順に連結したもの。 */
    events: readonly GameEvent[];
    ticks: number;
    droppedTicks: number;
  }>
  | Readonly<{ ok: false; errors: readonly CoreError[] }>;

type StageLoopInput = Pick<KeyboardInputAdapter, "sampleTicks" | "reset">;

/**
 * render frame ごとに固定 tick clock、入力 adapter、stage session を 1 本につなぐ loop。
 *
 * clock が返した tick 数だけ入力を sampling して `tick()` を連番で呼ぶ。Core が error を返した tick 以降は session を進めず、
 * 同じ error を返し続ける（tick 番号の食い違いも runtime の不整合なので、fatal と同じく止める）。
 */
export class StageLoop {
  readonly #session: StageSession;
  readonly #input: StageLoopInput;
  readonly #clock: FixedTickClock;
  #nextTick: number;
  #latestFrame: GameFrame | null = null;
  #latestInput: InputFrame | null = null;
  #failure: Extract<StageLoopStep, { ok: false }> | null = null;

  constructor(
    session: StageSession,
    input: StageLoopInput,
    options: Readonly<{ clock?: FixedTickClock; firstTick?: number }> = {},
  ) {
    this.#session = session;
    this.#input = input;
    this.#clock = options.clock ?? new FixedTickClock();
    this.#nextTick = options.firstTick ?? 0;
  }

  /** render frame の経過時間（ms）ぶん stage を進める。 */
  advance(deltaMs: number): StageLoopStep {
    if (this.#failure) {
      return this.#failure;
    }
    const { ticks, droppedTicks } = this.#clock.advance(deltaMs);
    const events: GameEvent[] = [];
    for (const input of this.#input.sampleTicks(this.#nextTick, ticks)) {
      const result = this.#session.tick(input);
      if (!result.ok) {
        this.#failure = Object.freeze({ ok: false, errors: Object.freeze([...result.errors]) });
        return this.#failure;
      }
      this.#nextTick += 1;
      this.#latestFrame = result.value;
      this.#latestInput = input;
      events.push(...result.value.events);
    }
    return Object.freeze({
      ok: true,
      latestFrame: this.#latestFrame,
      latestInput: this.#latestInput,
      events: Object.freeze(events),
      ticks,
      droppedTicks,
    });
  }

  /** pause、focus lost、visibility change で、停止中の経過時間と入力ラッチを捨てる。 */
  reset(): void {
    this.#clock.reset();
    this.#input.reset();
  }

  /** 起動からの `RuntimeDroppedTicks` の合計。 */
  get droppedTicksTotal(): number {
    return this.#clock.droppedTicksTotal;
  }
}
