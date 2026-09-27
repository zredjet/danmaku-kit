import type {
  CoreError,
  Difficulty,
  GameEvent,
  GameFrame,
  InputFrame,
  LoadedGame,
  SerializedGameState,
  StartStageOptions,
} from "@shooting-sample/shooting-core";

import type { BrowserReplayRecord } from "../debug/browser-replay-record.ts";
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

type ShellInput = Pick<KeyboardInputAdapter, "handleKeyEvent" | "sampleTicks" | "reset" | "takeUiInput" | "latchedEdgeCount">;

/** stage を始める content。dev server の hot reload で `replaceContent()` が差し替える。 */
export type GameShellContent = Readonly<{
  loadedGame: Pick<LoadedGame, "startStage">;
  /** title から始める stage。seed は stage を始めるたびに `nextSeed()` で決める。 */
  stage: Omit<StartStageOptions, "seed">;
}>;

export type GameShellOptions = GameShellContent & Readonly<{
  nextSeed: () => string;
  input: ShellInput;
  startDurationMs?: number;
  /** debug overlay（collider と debug HUD）を最初から表示するか。`toggleDebug` で切り替える。 */
  debugOverlay?: boolean;
  /** stage ごとに Core が受け付けた入力を残し、`replayRecord()` で返せるようにする。dev / test build だけで使う。 */
  recordInputs?: boolean;
}>;

/** 1 render frame を進めた結果。Core が error を返した後や stage を始められなかった後は、同じ error を返し続ける。 */
export type GameShellStep =
  | Readonly<{
    ok: true;
    lifecycle: GameLifecycle;
    /** 現在の stage の seed。stage の外（loading、title）では null。 */
    seed: string | null;
    /** 現在の stage の difficulty。stage の外では null。 */
    difficulty: Difficulty | null;
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
    /** debug overlay を表示するか。 */
    debugOverlay: boolean;
  }>
  | Readonly<{ ok: false; errors: readonly CoreError[] }>;

type ActiveStage = {
  readonly start: Readonly<StartStageOptions>;
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
 * focus lost では開始演出の timer を focus が戻るまで止める。stage は title から始めるたびに新しい seed で作り直す。`toggleDebug` は lifecycle を
 * 変えず、どの状態でも debug overlay の表示を切り替える。
 */
export class GameShell {
  readonly #options: GameShellOptions;
  #content: GameShellContent;
  #lifecycle: GameLifecycle = INITIAL_GAME_LIFECYCLE;
  #stage: ActiveStage | null = null;
  #stageChanged = false;
  #failure: Extract<GameShellStep, { ok: false }> | null = null;
  #debugOverlay: boolean;
  /** browser の focus を失っているか。focus がない間に始めた stage（content の hot reload）の開始演出は、focus が戻るまで進めない。 */
  #focusLost = false;
  /** pause 中に 1 tick 送りで進めた tick と event。次の `advance()` の結果に含め、scene が view を同期できるようにする。 */
  #steppedEvents: GameEvent[] = [];
  #steppedTicks = 0;
  #pauseOnStageStart = false;

  constructor(options: GameShellOptions) {
    this.#options = options;
    this.#content = { loadedGame: options.loadedGame, stage: options.stage };
    this.#debugOverlay = options.debugOverlay ?? false;
  }

  get lifecycle(): GameLifecycle {
    return this.#lifecycle;
  }

  get debugOverlay(): boolean {
    return this.#debugOverlay;
  }

  /** 現在の stage の seed。stage の外では null。 */
  get seed(): string | null {
    return this.#stage?.seed ?? null;
  }

  /** 現在の stage で直近に実行した tick の frame。 */
  get latestFrame(): GameFrame | null {
    return this.#stage?.frame ?? null;
  }

  /** まだ tick や render frame に渡していない入力の edge の数。 */
  get inputQueueDepth(): number {
    return this.#options.input.latchedEdgeCount;
  }

  /**
   * 現在の stage の開始条件、Core が受け付けた入力、現在の serialize 結果。`recordInputs` を指定していないとき、stage の外、
   * serialize に失敗したときは null。
   */
  replayRecord(): BrowserReplayRecord | null {
    const stage = this.#stage;
    const inputs = stage?.loop.recordedInputs;
    if (!stage || !inputs) {
      return null;
    }
    const serialized = stage.loop.serialize();
    if (!serialized.ok) {
      return null;
    }
    return Object.freeze({
      schemaVersion: "1",
      kind: "browserReplay",
      stage: stage.start,
      inputs: Object.freeze([...inputs]),
      state: serialized.value,
    });
  }

  /** keyboard event を入力 adapter へ渡し、割り当てのある key なら true を返す（呼び出し側が既定動作を止める）。 */
  handleKeyEvent(event: KeyboardInputEvent): boolean {
    return this.#options.input.handleKeyEvent(event);
  }

  /**
   * dev server の content の hot reload。以後の stage は `content` で始め、stage の中なら新しい content で stage を最初から始め直す（seed
   * は `nextSeed()` の次の値、入力と開始演出は捨て、前の stage の入力の記録には混ぜない）。title と loading では次の stage から使う。
   * Core の error で止まった後は何もしない（呼び出し側は page を読み込み直す）。
   */
  replaceContent(content: GameShellContent): void {
    this.#content = content;
    this.#apply({ type: "contentReloaded" });
  }

  /**
   * Preview（design 19）の restart。以後の stage は `content` で始め、stage の中なら始め直し、title なら stage を始める。
   */
  startOrRestart(content: GameShellContent): void {
    this.#content = content;
    this.#apply(this.#lifecycle.state === "title" ? { type: "startRequested" } : { type: "contentReloaded" });
  }

  /**
   * Preview の start paused。有効なら、開始演出を終えた render frame で tick を進めずに pause し、tick 0 から 1 tick 送りで進められる
   * ようにする（browser regression の決定的な画面、Phase 2B-14）。
   */
  setPauseOnStageStart(enabled: boolean): void {
    this.#pauseOnStageStart = enabled;
  }

  /** Preview の panel の pause button。`pause` の UI action と同じく、stage の中なら pause を切り替える。 */
  togglePause(): void {
    this.#apply({ type: "pauseToggled" });
  }

  /**
   * Preview の 1 tick 送り。pause 中の stage を 1 tick だけ進め、進めた tick と event は次の `advance()` の結果に含める。pause 中でない
   * とき、stage が終わった後は何もせず false を返す。1 tick 送りで stage が終わったら pause のまま止め、pause を解いたときに stage の
   * 終わりへ進める。
   */
  stepPausedTick(): boolean {
    const stage = this.#stage;
    if (this.#failure || !stage || this.#lifecycle.state !== "paused" || endedStatus(stage.frame) !== null) {
      return false;
    }
    const step = stage.loop.stepTick();
    if (!step.ok) {
      this.#failure = step;
      return true;
    }
    stage.frame = step.latestFrame;
    stage.latestInput = step.latestInput;
    this.#steppedEvents.push(...step.events);
    this.#steppedTicks += step.ticks;
    return true;
  }

  /** 現在の stage の state を serialize する（Preview の overlay の pattern cursor と PRNG state）。stage の外や失敗なら null。 */
  serializeStage(): SerializedGameState | null {
    const serialized = this.#stage?.loop.serialize();
    return serialized?.ok ? serialized.value : null;
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
    this.#focusLost = true;
    this.#apply({ type: "focusLost" });
  }

  /**
   * browser の focus が戻ったとき。focus lost で止めた開始演出の timer を再開する。
   *
   * lifecycle は変えない。`paused` は focus が戻っただけでは再開せず、`pause` を待つ（design 6）。
   */
  regainFocus(): void {
    this.#focusLost = false;
    if (!this.#failure) {
      this.#stage?.timer.resume();
    }
  }

  /** render frame の経過時間（ms）ぶん進める。 */
  advance(deltaMs: number): GameShellStep {
    for (const action of this.#options.input.takeUiInput().pressed) {
      if (action === "toggleDebug") {
        this.#debugOverlay = !this.#debugOverlay;
        continue;
      }
      const event = this.#eventForUiAction(action);
      if (event) {
        this.#apply(event);
      }
    }
    let events: readonly GameEvent[] = this.#steppedEvents.length > 0 ? Object.freeze(this.#steppedEvents) : NO_EVENTS;
    let ticks = this.#steppedTicks;
    this.#steppedEvents = [];
    this.#steppedTicks = 0;
    const stage = this.#stage;
    if (!this.#failure && stage && this.#lifecycle.state === "stageStarting") {
      if (stage.timer.advance(deltaMs)) {
        this.#apply({ type: "stageStartFinished" });
        if (this.#pauseOnStageStart) {
          this.#apply({ type: "pauseToggled" });
        }
      }
    } else if (!this.#failure && stage && this.#lifecycle.state === "playing") {
      // pause 中の 1 tick 送りで終わった stage は、終わった後の tick を Core に渡さずに終わりへ進める。
      const step = endedStatus(stage.frame) === null ? stage.loop.advance(deltaMs) : null;
      if (step && !step.ok) {
        this.#failure = step;
      } else {
        if (step) {
          events = events.length > 0 ? Object.freeze([...events, ...step.events]) : step.events;
          ticks += step.ticks;
          stage.frame = step.latestFrame;
          stage.latestInput = step.latestInput;
        }
        const status = endedStatus(stage.frame);
        if (status !== null) {
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
      difficulty: current?.start.difficulty ?? null,
      frame: current?.frame ?? null,
      latestInput: current?.latestInput ?? null,
      events,
      ticks,
      stageChanged,
      droppedTicksTotal: current?.loop.droppedTicksTotal ?? 0,
      debugOverlay: this.#debugOverlay,
    });
  }

  #eventForUiAction(action: Exclude<UiActionId, "toggleDebug">): LifecycleEvent | null {
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
    // content の hot reload は、開始演出の途中でも stage を作り直す。
    if (next === previous && event.type !== "contentReloaded") {
      return;
    }
    if (next === "stageStarting") {
      this.#startStage();
    } else if (next === "title") {
      this.#stageChanged ||= this.#stage !== null;
      this.#stage = null;
    }
  }

  #createStartTimer(): StageStartTimer {
    const timer = new StageStartTimer(this.#options.startDurationMs ?? STAGE_START_DURATION_MS);
    if (this.#focusLost) {
      timer.suspend();
    }
    return timer;
  }

  #startStage(): void {
    this.#steppedEvents = [];
    this.#steppedTicks = 0;
    const seed = this.#options.nextSeed();
    const start = Object.freeze({ ...this.#content.stage, seed });
    const session = this.#content.loadedGame.startStage(start);
    if (!session.ok) {
      this.#failure = Object.freeze({ ok: false, errors: Object.freeze([...session.errors]) });
      return;
    }
    this.#stage = {
      start,
      seed,
      loop: new StageLoop(session.value, this.#options.input, { recordInputs: this.#options.recordInputs ?? false }),
      timer: this.#createStartTimer(),
      frame: null,
      latestInput: null,
    };
    this.#stageChanged = true;
  }
}

/** frame の stage が終わっていれば、その結果。 */
function endedStatus(frame: GameFrame | null): "stageCleared" | "gameOver" | null {
  const status = frame?.state.status;
  return status === "stageCleared" || status === "gameOver" ? status : null;
}
