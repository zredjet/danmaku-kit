/**
 * ゲーム全体の状態（design 6）。Runtime shell が持ち、Core の公開 API には含めない。
 *
 * Phase 2A の sample app は `booting`、`loading`、`title`、`stageStarting`、`playing`、`paused`、`stageCleared`、`gameOver` を使う。
 * `result` と `replayPlayback` は design の遷移を先に型として置き、使う slice で遷移を足す。
 */
export type GameLifecycleState =
  | "booting"
  | "loading"
  | "title"
  | "stageStarting"
  | "playing"
  | "paused"
  | "stageCleared"
  | "gameOver"
  | "result"
  | "replayPlayback";

/** `paused` から戻る先になれる状態。 */
export type PausableLifecycleState = "playing" | "replayPlayback";

/** 現在の状態と、`paused` のときに戻る先（`pausedFrom`）。 */
export type GameLifecycle = Readonly<{
  state: GameLifecycleState;
  pausedFrom: PausableLifecycleState | null;
}>;

/** lifecycle を進める出来事。UI action、scene の進行、Core の stage 終了、browser の focus / visibility から作る。 */
export type LifecycleEvent =
  | Readonly<{ type: "loadingStarted" }>
  | Readonly<{ type: "loadingFinished" }>
  | Readonly<{ type: "startRequested" }>
  | Readonly<{ type: "stageStartFinished" }>
  | Readonly<{ type: "pauseToggled" }>
  | Readonly<{ type: "focusLost" }>
  | Readonly<{ type: "stageEnded"; outcome: "stageCleared" | "gameOver" }>
  | Readonly<{ type: "returnToTitle" }>
  | Readonly<{ type: "contentReloaded" }>;

/**
 * 1 つの出来事を当てた結果。
 *
 * `discardInput` は accumulator と入力のラッチ・held・physical key state を捨てる合図、`suspendStartTimer` は stage 開始演出の timer を
 * 止める合図で、どちらも Runtime が実行する。
 */
export type LifecycleTransition = Readonly<{
  lifecycle: GameLifecycle;
  discardInput: boolean;
  suspendStartTimer: boolean;
}>;

export const INITIAL_GAME_LIFECYCLE: GameLifecycle = Object.freeze({ state: "booting", pausedFrom: null });

const PAUSABLE_STATES: readonly GameLifecycleState[] = Object.freeze(["playing", "replayPlayback"]);

/**
 * lifecycle に出来事を当てる（design 6）。その状態で起き得ない出来事は状態を変えない。
 *
 * - `pause` と、`playing` / `replayPlayback` 中の focus lost / visibility change は `paused` にして戻る先を `pausedFrom` に残す。
 *   `paused` 中の `pause` で戻る先へ戻す。focus が戻っただけでは再開しない。
 * - `stageStarting` 中の focus lost / visibility change は状態を保ったまま開始演出の timer を止める。
 * - `loading`、`title`、`stageCleared`、`gameOver`、`result`、`paused` 中の focus lost / visibility change は状態を変えない。
 * - focus lost / visibility change と `paused` の出入りでは、どの状態でも accumulator と入力を捨てる。
 * - loading を終えて `title` へ進むとき、`stageStarting` へ進むとき、`title` へ戻るときも入力を捨て、前の画面で押した key を次の画面へ
 *   持ち越さない。
 * - dev server の content の hot reload（`contentReloaded`）は、stage の中（開始演出から stage の終わりまで）なら新しい content で
 *   stage を始め直すため `stageStarting` へ進め、それ以外（loading、title）では状態を変えない。
 */
export function transitionLifecycle(current: GameLifecycle, event: LifecycleEvent): LifecycleTransition {
  switch (event.type) {
    case "loadingStarted":
      return current.state === "booting" ? moveTo("loading") : stay(current);
    case "loadingFinished":
      return current.state === "loading" ? moveTo("title", { discardInput: true }) : stay(current);
    case "startRequested":
      return current.state === "title" ? moveTo("stageStarting", { discardInput: true }) : stay(current);
    case "stageStartFinished":
      return current.state === "stageStarting" ? moveTo("playing") : stay(current);
    case "pauseToggled":
      if (isPausable(current.state)) {
        return pause(current.state);
      }
      if (current.state === "paused" && current.pausedFrom !== null) {
        return moveTo(current.pausedFrom, { discardInput: true });
      }
      return stay(current);
    case "focusLost":
      if (isPausable(current.state)) {
        return pause(current.state);
      }
      return stay(current, { discardInput: true, suspendStartTimer: current.state === "stageStarting" });
    case "stageEnded":
      return current.state === "playing" ? moveTo(event.outcome) : stay(current);
    case "returnToTitle":
      return current.state === "stageCleared" || current.state === "gameOver" || current.state === "result"
        ? moveTo("title", { discardInput: true })
        : stay(current);
    case "contentReloaded":
      return STAGE_STATES.includes(current.state) ? moveTo("stageStarting", { discardInput: true }) : stay(current);
  }
}

/** stage の中の状態。content の hot reload で stage を始め直す。 */
const STAGE_STATES: readonly GameLifecycleState[] = Object.freeze(["stageStarting", "playing", "paused", "stageCleared", "gameOver", "result"]);

function isPausable(state: GameLifecycleState): state is PausableLifecycleState {
  return PAUSABLE_STATES.includes(state);
}

function pause(from: PausableLifecycleState): LifecycleTransition {
  return transition({ state: "paused", pausedFrom: from }, { discardInput: true });
}

function moveTo(state: Exclude<GameLifecycleState, "paused">, effects: Partial<Omit<LifecycleTransition, "lifecycle">> = {}): LifecycleTransition {
  return transition({ state, pausedFrom: null }, effects);
}

function stay(current: GameLifecycle, effects: Partial<Omit<LifecycleTransition, "lifecycle">> = {}): LifecycleTransition {
  return transition(current, effects);
}

function transition(
  lifecycle: GameLifecycle,
  effects: Partial<Omit<LifecycleTransition, "lifecycle">>,
): LifecycleTransition {
  return Object.freeze({
    lifecycle: Object.freeze({ ...lifecycle }),
    discardInput: effects.discardInput ?? false,
    suspendStartTimer: effects.suspendStartTimer ?? false,
  });
}
