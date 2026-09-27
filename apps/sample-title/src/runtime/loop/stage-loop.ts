import type { CoreError, GameEvent, GameFrame, InputFrame, StageSession } from "@danmaku-kit/core";

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
    /** この render frame で実行した tick 数。stage が終わった tick で止めるため、clock が返した数より少ないことがある。 */
    ticks: number;
    droppedTicks: number;
  }>
  | Readonly<{ ok: false; errors: readonly CoreError[] }>;

type StageLoopInput = Pick<KeyboardInputAdapter, "sampleTicks" | "reset">;

/**
 * render frame ごとに固定 tick clock、入力 adapter、stage session を 1 本につなぐ loop。
 *
 * clock が返した tick 数だけ入力を sampling して `tick()` を連番で呼ぶ。Core が error を返した tick 以降は session を進めず、
 * 同じ error を返し続ける（tick 番号の食い違いも runtime の不整合なので、fatal と同じく止める）。`state.status` が
 * `playing` でない frame（stageCleared / gameOver）を受け取ったら、Core は以後の tick を受け付けないため、その tick で止まり、
 * 以後は clock も入力も進めずに最後の frame を返す。
 */
export class StageLoop {
  readonly #session: StageSession;
  readonly #input: StageLoopInput;
  readonly #clock: FixedTickClock;
  #nextTick: number;
  #latestFrame: GameFrame | null = null;
  #latestInput: InputFrame | null = null;
  #failure: Extract<StageLoopStep, { ok: false }> | null = null;
  readonly #recordedInputs: InputFrame[] | null;

  constructor(
    session: StageSession,
    input: StageLoopInput,
    options: Readonly<{
      clock?: FixedTickClock;
      firstTick?: number;
      /** Core が受け付けた `InputFrame` を順に残す。dev / test build で browser の入力を Node で再生するために使う。 */
      recordInputs?: boolean;
    }> = {},
  ) {
    this.#session = session;
    this.#input = input;
    this.#clock = options.clock ?? new FixedTickClock();
    this.#nextTick = options.firstTick ?? 0;
    this.#recordedInputs = options.recordInputs ? [] : null;
  }

  /** render frame の経過時間（ms）ぶん stage を進める。 */
  advance(deltaMs: number): StageLoopStep {
    if (this.#failure) {
      return this.#failure;
    }
    if (this.ended) {
      return this.#step([], 0, 0);
    }
    const { ticks, droppedTicks } = this.#clock.advance(deltaMs);
    return this.#runTicks(ticks, droppedTicks);
  }

  /**
   * clock を使わずに 1 tick だけ進める（Preview の 1 tick 送り、design 19）。入力は通常の tick と同じく adapter から sampling する。
   * stage が終わっていれば何もしない。
   */
  stepTick(): StageLoopStep {
    if (this.#failure) {
      return this.#failure;
    }
    if (this.ended) {
      return this.#step([], 0, 0);
    }
    return this.#runTicks(1, 0);
  }

  #runTicks(ticks: number, droppedTicks: number): StageLoopStep {
    const events: GameEvent[] = [];
    let executedTicks = 0;
    for (const input of this.#input.sampleTicks(this.#nextTick, ticks)) {
      const result = this.#session.tick(input);
      if (!result.ok) {
        this.#failure = Object.freeze({ ok: false, errors: Object.freeze([...result.errors]) });
        return this.#failure;
      }
      this.#nextTick += 1;
      executedTicks += 1;
      this.#latestFrame = result.value;
      this.#latestInput = input;
      this.#recordedInputs?.push(input);
      events.push(...result.value.events);
      if (this.ended) {
        break;
      }
    }
    return this.#step(events, executedTicks, droppedTicks);
  }

  /** 直近の frame で stage が stageCleared か gameOver になっていれば true。 */
  get ended(): boolean {
    return this.#latestFrame !== null && this.#latestFrame.state.status !== "playing";
  }

  /** pause、focus lost、visibility change で、停止中の経過時間と入力ラッチを捨てる。 */
  reset(): void {
    this.#clock.reset();
    this.#input.reset();
  }

  #step(events: readonly GameEvent[], ticks: number, droppedTicks: number): StageLoopStep {
    return Object.freeze({
      ok: true,
      latestFrame: this.#latestFrame,
      latestInput: this.#latestInput,
      events: Object.freeze([...events]),
      ticks,
      droppedTicks,
    });
  }

  /** Core が受け付けた `InputFrame`（tick 順）。`recordInputs` を指定しなかった loop では null。 */
  get recordedInputs(): readonly InputFrame[] | null {
    return this.#recordedInputs;
  }

  /** stage session の現在の state を serialize する。 */
  serialize(): ReturnType<StageSession["serialize"]> {
    return this.#session.serialize();
  }

  /** 起動からの `RuntimeDroppedTicks` の合計。 */
  get droppedTicksTotal(): number {
    return this.#clock.droppedTicksTotal;
  }
}
