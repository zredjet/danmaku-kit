import type { CoreError, GameEvent, GameFrame, InputFrame, LoadedGame, StartStageOptions } from "@shooting-sample/shooting-core";

import type { KeyboardInputAdapter, KeyboardInputEvent } from "../input/keyboard-input.ts";
import type { UiActionId } from "../input/key-bindings.ts";
import { StageLoop } from "../loop/stage-loop.ts";
import {
  INITIAL_GAME_LIFECYCLE,
  transitionLifecycle,
  type GameLifecycle,
  type LifecycleEvent,
} from "./game-lifecycle.ts";
import { StageStartTimer, STAGE_START_DURATION_MS } from "./stage-start-timer.ts";

type ShellInput = Pick<KeyboardInputAdapter, "handleKeyEvent" | "sampleTicks" | "reset" | "takeUiInput">;

export type GameShellOptions = Readonly<{
  loadedGame: Pick<LoadedGame, "startStage">;
  /** title から始める stage。seed は stage を始めるたびに `nextSeed()` で決める。 */
  stage: Omit<StartStageOptions, "seed">;
  nextSeed: () => string;
  input: ShellInput;
  startDurationMs?: number;
}>;

/** 1 render frame を進めた結果。Core が error を返した後や stage を始められなかった後は、同じ error を返し続ける。 */
export type GameShellStep =
  | Readonly<{
    ok: true;
    lifecycle: GameLifecycle;
    /** 現在の stage の seed。stage の外（loading、title）では null。 */
    seed: string | null;
    /** 現在の stage で直近に実行した tick の frame。stage の外や、開始演出中でまだ tick を実行していなければ null。 */
    frame: GameFrame | null;
    latestInput: InputFrame | null;
    /** この render frame で実行した tick の event（実行順）。 */
    events: readonly GameEvent[];
    ticks: number;
    /** この render frame で stage を始めたか離れた。前の stage の view を片付ける合図。 */
    stageChanged: boolean;
    /** 現在の stage で捨てた tick の合計。 */
    droppedTicksTotal: number;
  }>
  | Readonly<{ ok: false; errors: readonly CoreError[] }>;

type ActiveStage = {
  readonly seed: string;
  readonly loop: StageLoop;
  readonly timer: StageStartTimer;
  frame: GameFrame | null;
  latestInput: InputFrame | null;
};

const NO_EVENTS: readonly GameEvent[] = Object.freeze([]);

/**
 * lifecycle（design 6）に沿って title、stage 開始演出、stage、pause、stage 終了を進める Runtime shell。Phaser に依存しない。
 *
 * render frame ごとに UI action を lifecycle の出来事へ変え（`pause` は pause の切り替え、`confirm` は title で stage 開始、
 * stageCleared / gameOver で title へ戻る）、`stageStarting` では開始演出の timer を、`playing` では stage loop を進める。stage が
 * 終わった frame で `stageCleared` / `gameOver` へ移る。lifecycle が入力を捨てる遷移では入力と loop の accumulator を捨て、
 * focus lost では開始演出の timer を止める。stage は title から始めるたびに新しい seed で作り直す。
 */
export class GameShell {
  readonly #options: GameShellOptions;
  #lifecycle: GameLifecycle = INITIAL_GAME_LIFECYCLE;
  #stage: ActiveStage | null = null;
  #stageChanged = false;
  #failure: Extract<GameShellStep, { ok: false }> | null = null;

  constructor(options: GameShellOptions) {
    this.#options = options;
  }

  get lifecycle(): GameLifecycle {
    return this.#lifecycle;
  }

  /** keyboard event を入力 adapter へ渡し、割り当てのある key なら true を返す（呼び出し側が既定動作を止める）。 */
  handleKeyEvent(event: KeyboardInputEvent): boolean {
    return this.#options.input.handleKeyEvent(event);
  }

  /** asset と view pool の準備を始める。 */
  beginLoading(): void {
    this.#apply({ type: "loadingStarted" });
  }

  /** asset と view pool の準備が済み、title へ進む。 */
  finishLoading(): void {
    this.#apply({ type: "loadingFinished" });
  }

  /** browser の focus lost と、visibility が hidden になったとき。 */
  loseFocus(): void {
    this.#apply({ type: "focusLost" });
  }

  /** render frame の経過時間（ms）ぶん進める。 */
  advance(deltaMs: number): GameShellStep {
    for (const action of this.#options.input.takeUiInput().pressed) {
      const event = this.#eventForUiAction(action);
      if (event) {
        this.#apply(event);
      }
    }
    let events = NO_EVENTS;
    let ticks = 0;
    const stage = this.#stage;
    if (!this.#failure && stage && this.#lifecycle.state === "stageStarting") {
      if (stage.timer.advance(deltaMs)) {
        this.#apply({ type: "stageStartFinished" });
      }
    } else if (!this.#failure && stage && this.#lifecycle.state === "playing") {
      const step = stage.loop.advance(deltaMs);
      if (!step.ok) {
        this.#failure = step;
      } else {
        ({ events, ticks } = step);
        stage.frame = step.latestFrame;
        stage.latestInput = step.latestInput;
        const status = step.latestFrame?.state.status;
        if (status === "stageCleared" || status === "gameOver") {
          this.#apply({ type: "stageEnded", outcome: status });
        }
      }
    }
    if (this.#failure) {
      return this.#failure;
    }
    const stageChanged = this.#stageChanged;
    this.#stageChanged = false;
    const current = this.#stage;
    return Object.freeze({
      ok: true,
      lifecycle: this.#lifecycle,
      seed: current?.seed ?? null,
      frame: current?.frame ?? null,
      latestInput: current?.latestInput ?? null,
      events,
      ticks,
      stageChanged,
      droppedTicksTotal: current?.loop.droppedTicksTotal ?? 0,
    });
  }

  #eventForUiAction(action: UiActionId): LifecycleEvent | null {
    switch (action) {
      case "pause":
        return { type: "pauseToggled" };
      case "confirm":
        if (this.#lifecycle.state === "title") {
          return { type: "startRequested" };
        }
        return this.#lifecycle.state === "stageCleared" || this.#lifecycle.state === "gameOver"
          ? { type: "returnToTitle" }
          : null;
    }
  }

  #apply(event: LifecycleEvent): void {
    if (this.#failure) {
      return;
    }
    const previous = this.#lifecycle.state;
    const transition = transitionLifecycle(this.#lifecycle, event);
    this.#lifecycle = transition.lifecycle;
    if (transition.discardInput) {
      this.#options.input.reset();
      this.#stage?.loop.reset();
    }
    if (transition.suspendStartTimer) {
      this.#stage?.timer.suspend();
    }
    const next = this.#lifecycle.state;
    if (next === previous) {
      return;
    }
    if (next === "stageStarting") {
      this.#startStage();
    } else if (next === "title") {
      this.#stageChanged ||= this.#stage !== null;
      this.#stage = null;
    }
  }

  #startStage(): void {
    const seed = this.#options.nextSeed();
    const session = this.#options.loadedGame.startStage({ ...this.#options.stage, seed });
    if (!session.ok) {
      this.#failure = Object.freeze({ ok: false, errors: Object.freeze([...session.errors]) });
      return;
    }
    this.#stage = {
      seed,
      loop: new StageLoop(session.value, this.#options.input),
      timer: new StageStartTimer(this.#options.startDurationMs ?? STAGE_START_DURATION_MS),
      frame: null,
      latestInput: null,
    };
    this.#stageChanged = true;
  }
}
