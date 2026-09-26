import type { LoadedGame, StartStageOptions } from "../api-types.ts";
import type { GameEvent } from "../events/game-event.ts";
import type { HashableGameState } from "../hash/hashable-state.ts";
import type { InputFrame } from "../input/input-frame.ts";
import { parseInputFrame } from "../input/parse-input-frame.ts";
import type { HeadlessDebugStateDump, HeadlessDebugStateError } from "../internal/debug-state.ts";
import { deepFreezePlainData } from "../shared/immutable.ts";
import type { CoreError } from "../result.ts";
import type { ReplayMetadata } from "../replay/metadata.ts";
import { captureHeadlessDebugStateForTest } from "./debug-state.ts";

/**
 * replay の1 checkpoint における片側の観測値。
 *
 * `ok` は tick 後の committed state、`error` は `tick()` または capture の失敗、`missing` は replay が
 * その checkpoint より前に終わったことを表す。存在しない state / events は持たない。
 */
export type ReplayDivergenceSide =
  | Readonly<{
    status: "ok";
    inputFrame: InputFrame | null;
    stateHash: string;
    summary: HeadlessDebugStateDump;
    state: HashableGameState;
    events: readonly GameEvent[];
  }>
  | Readonly<{ status: "missing"; inputFrame: InputFrame | null }>
  | Readonly<{ status: "error"; inputFrame: InputFrame | null; errors: readonly HeadlessDebugStateError[] }>;

/**
 * replay trace の checkpoint。
 *
 * 初期 checkpoint は `frameTick: null` / `checkpointTick: 0`、tick 処理後は
 * `checkpointTick === frameTick + 1` とし、frame と post-tick state を同じ数値で誤結合しない。
 */
export type ReplayTraceCheckpoint = Exclude<ReplayDivergenceSide, Readonly<{ status: "missing" }>> & Readonly<{
  checkpointTick: number;
  frameTick: number | null;
}>;

/** 1 replay run の未検証 metadata と、checkpoint tick 順の観測列。`error` checkpoint は最後にだけ置く。 */
export type ReplayTrace = Readonly<{
  metadata: ReplayMetadata;
  checkpoints: readonly ReplayTraceCheckpoint[];
}>;

export type ReplayTraceRecordingResult =
  | Readonly<{ ok: true; value: ReplayTrace }>
  | Readonly<{ ok: false; errors: readonly CoreError[] }>;

/**
 * hook-enabled `LoadedGame` で stage を開始し、入力列を順に tick した replay trace を記録する。
 *
 * metadata は開始した session の serialize 結果と `options.seed` から作り、記録した run と食い違わせない。
 * `tick()` または checkpoint capture が失敗した時点で `error` checkpoint を記録して止める。
 * `LoadedGame` は `createShootingCoreWithTestingHooksForTest()` から load したものを渡す。
 */
export function recordReplayTraceForTest(
  loaded: LoadedGame,
  options: StartStageOptions,
  inputs: readonly unknown[],
): ReplayTraceRecordingResult {
  const started = loaded.startStage(options);
  if (!started.ok) {
    return Object.freeze({ ok: false, errors: started.errors });
  }
  const session = started.value;
  const serialized = session.serialize();
  if (!serialized.ok) {
    return Object.freeze({ ok: false, errors: serialized.errors });
  }
  const metadata: ReplayMetadata = Object.freeze({
    coreVersion: serialized.value.coreVersion,
    schemaVersion: serialized.value.schemaVersion,
    contentVersion: serialized.value.contentVersion,
    inputFormatVersion: serialized.value.inputFormatVersion,
    stageId: serialized.value.stageId,
    difficulty: serialized.value.difficulty,
    playerId: serialized.value.playerId,
    enabledFeatures: serialized.value.enabledFeatures,
    seed: options.seed,
  });

  const checkpoints: ReplayTraceCheckpoint[] = [captureCheckpoint(session, 0, null, null, Object.freeze([]))];
  for (const [frameTick, rawInput] of inputs.entries()) {
    if (checkpoints.at(-1)!.status === "error") {
      break;
    }
    const inputFrame = parseRecordedInput(rawInput);
    const frame = session.tick(rawInput as InputFrame);
    checkpoints.push(frame.ok
      ? captureCheckpoint(session, frameTick + 1, frameTick, inputFrame, frame.value.events)
      : errorCheckpoint(frameTick + 1, frameTick, inputFrame, frame.errors));
  }
  return Object.freeze({ ok: true, value: Object.freeze({ metadata, checkpoints: Object.freeze(checkpoints) }) });
}

/** tick 後の committed state を capture し、失敗したら `error` checkpoint にする。 */
function captureCheckpoint(
  session: Parameters<typeof captureHeadlessDebugStateForTest>[0],
  checkpointTick: number,
  frameTick: number | null,
  inputFrame: InputFrame | null,
  events: readonly GameEvent[],
): ReplayTraceCheckpoint {
  const captured = captureHeadlessDebugStateForTest(session);
  if (!captured.ok) {
    return errorCheckpoint(checkpointTick, frameTick, inputFrame, captured.errors);
  }
  return Object.freeze({
    status: "ok",
    inputFrame,
    stateHash: captured.value.dump.stateHash,
    summary: captured.value.dump,
    state: captured.value.state,
    events,
    checkpointTick,
    frameTick,
  });
}

function errorCheckpoint(
  checkpointTick: number,
  frameTick: number | null,
  inputFrame: InputFrame | null,
  errors: readonly HeadlessDebugStateError[],
): ReplayTraceCheckpoint {
  return Object.freeze({ status: "error", inputFrame, errors, checkpointTick, frameTick });
}

/** Core と同じ正規化で input を記録する。parse できない入力は `tick()` の error と一緒に null で残す。 */
function parseRecordedInput(rawInput: unknown): InputFrame | null {
  const plainInput = deepFreezePlainData(rawInput);
  if (plainInput === null) {
    return null;
  }
  const parsed = parseInputFrame(plainInput);
  return parsed.ok ? parsed.value : null;
}
