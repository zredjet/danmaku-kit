import { createHash } from "node:crypto";

import type {
  GameFrame,
  GameplayActionId,
  InputFrame,
  LoadedGame,
  StageSession,
  StartStageOptions,
} from "@shooting-sample/shooting-core";

import { GAMEPLAY_ACTIONS } from "../runtime/input/key-bindings.ts";

/** input script の 1 区間。`fromTick` から次の区間の開始まで、同じ移動方向と押しっぱなしの action を続ける。 */
export type InputScriptSegment = Readonly<{
  fromTick: number;
  moveX?: -1 | 0 | 1;
  moveY?: -1 | 0 | 1;
  held?: readonly GameplayActionId[];
}>;

/**
 * 区間の並びを tick 0 から `tickCount` 個の `InputFrame` にする。
 *
 * 区間は `fromTick` の昇順に並べ、最初の区間は tick 0 から始める。held は Core の canonical order に並べ、前の tick からの変化を
 * `pressed` / `released` にする。
 */
export function expandInputScript(segments: readonly InputScriptSegment[], tickCount: number): readonly InputFrame[] {
  if (segments[0]?.fromTick !== 0 || segments.some((segment, index) => index > 0 && segment.fromTick <= segments[index - 1]!.fromTick)) {
    throw new RangeError("input script segments must start at tick 0 in strictly ascending order");
  }
  const frames: InputFrame[] = [];
  let segmentIndex = 0;
  let previousHeld: readonly GameplayActionId[] = [];
  for (let tick = 0; tick < tickCount; tick += 1) {
    while (segments[segmentIndex + 1] !== undefined && segments[segmentIndex + 1]!.fromTick <= tick) {
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex]!;
    const held = GAMEPLAY_ACTIONS.filter((action) => segment.held?.includes(action) ?? false);
    frames.push({
      tick,
      axes: { moveX: segment.moveX ?? 0, moveY: segment.moveY ?? 0 },
      held,
      pressed: held.filter((action) => !previousHeld.includes(action)),
      released: previousHeld.filter((action) => !held.includes(action)),
    });
    previousHeld = held;
  }
  return frames;
}

/**
 * shot を押し続けながら、`periodTicks` ごとに左右の向きを変えて往復する script。最初の半周期は左へ動き、往復を開始位置の中央にそろえる。
 */
export function weavingShotScript(periodTicks: number, tickCount: number): readonly InputScriptSegment[] {
  const segments: InputScriptSegment[] = [{ fromTick: 0, moveX: -1, held: ["shot"] }];
  let direction: -1 | 1 = -1;
  for (let tick = Math.floor(periodTicks / 2); tick < tickCount; tick += periodTicks) {
    direction = direction === -1 ? 1 : -1;
    segments.push({ fromTick: tick, moveX: direction, held: ["shot"] });
  }
  return segments;
}

export type HeadlessReplayRun = Readonly<{
  session: StageSession;
  /** 実行した tick の frame（tick 順）。stage が終わった tick の frame で終わる。 */
  frames: readonly GameFrame[];
}>;

/**
 * stage を始め、`inputs` を順に渡して stage が終わるか入力が尽きるまで進める。Core が error を返したら throw する。
 *
 * `onFrame` は各 tick の直後に、その tick の frame と session を受け取る（serialize した state を読む checkpoint に使う）。
 */
export function runHeadlessReplay(
  game: Pick<LoadedGame, "startStage">,
  start: StartStageOptions,
  inputs: readonly InputFrame[],
  onFrame?: (frame: GameFrame, session: StageSession) => void,
): HeadlessReplayRun {
  const started = game.startStage(start);
  if (!started.ok) {
    throw new Error(`startStage failed: ${JSON.stringify(started.errors)}`);
  }
  const session = started.value;
  const frames: GameFrame[] = [];
  for (const input of inputs) {
    const result = session.tick(input);
    if (!result.ok) {
      throw new Error(`tick ${input.tick} failed: ${JSON.stringify(result.errors)}`);
    }
    frames.push(result.value);
    onFrame?.(result.value, session);
    if (result.value.state.status !== "playing") {
      break;
    }
  }
  return Object.freeze({ session, frames: Object.freeze(frames) });
}

/**
 * serialize した snapshot の SHA-256 の先頭 16 桁。同じ content、seed、入力から同じ state に着いたかを比べる。
 *
 * Core の state hash は test 用の内部 helper でだけ求まるため、app は公開の `serialize()` の JSON を hash する。serialize の形が
 * 変わると値も変わる。
 */
export function serializedStateDigest(session: StageSession): string {
  const serialized = session.serialize();
  if (!serialized.ok) {
    throw new Error(`serialize failed: ${JSON.stringify(serialized.errors)}`);
  }
  return createHash("sha256").update(JSON.stringify(serialized.value)).digest("hex").slice(0, 16);
}
