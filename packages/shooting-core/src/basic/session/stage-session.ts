import type { StageSession } from "../api-types.ts";
import { parseInputFrame } from "../input/parse-input-frame.ts";
import { createHeadlessDebugCheckpoint, createHeadlessDebugTickMetrics } from "../instrumentation/debug-state.ts";
import type { HeadlessDebugTickMetrics } from "../instrumentation/debug-state.ts";
import { applyCommittedStateFaultsBeforeTick, createSerializeSourceState } from "../instrumentation/stage-session-testing-hooks.ts";
import type { ActiveStageSessionTestingHooks } from "../instrumentation/stage-session-testing-hooks.ts";
import { coreError, errorResult, okResult } from "../result.ts";
import type { CoreError, CoreResult } from "../result.ts";
import type { StageSessionSerializationMetadata } from "../serialization/metadata.ts";
import { deepFreezeClone, deepFreezePlainData } from "../shared/immutable.ts";
import { createWorkingStageState } from "../state/committed-state.ts";
import type { CommittedStageState } from "../state/committed-state.ts";
import { createHashableGameState } from "../state/hashable-projection.ts";
import { serializeCommittedStageState } from "../state/serialize-projection.ts";
import { runStageTick } from "./tick-pipeline.ts";
import type { StageTickContent, StageTickInstrumentation } from "./tick-pipeline.ts";

export type StageSessionContext = Readonly<{
  content: StageTickContent;
  debugSeed: string | null;
  initialState: CommittedStageState;
  serializationMetadata: StageSessionSerializationMetadata;
  testingHooks: ActiveStageSessionTestingHooks;
}>;

/**
 * 1 stage の simulation session を作る。
 *
 * 各 system は working state 上で実行し、frame 構築直前に成功時だけ session state へ
 * commit する。これにより ID 採番、collision、score、event 順序を deterministic に保つ。
 */
export function createStageSession(options: StageSessionContext): StageSession {
  let committedState = options.initialState;
  const instrumentation: StageTickInstrumentation = Object.freeze({
    collectDebugMetrics: options.testingHooks.registerHeadlessDebugStateSerializer !== undefined,
    testingHooks: options.testingHooks,
  });
  let debugTickMetrics: HeadlessDebugTickMetrics | null = null;
  let fatalErrors: readonly CoreError[] | null = null;
  const latchFatalErrors = <T>(errors: readonly CoreError[]): CoreResult<T> => {
    options.testingHooks.recordCommittedStateOnFatal?.(deepFreezeClone(committedState));
    fatalErrors = freezeFatalErrors(errors);
    return errorResult(fatalErrors);
  };

  const session: StageSession = {
    serialize() {
      if (fatalErrors) {
        return errorResult(fatalErrors);
      }
      const serializedState = createSerializeSourceState(committedState, options.testingHooks);
      const serialized = serializeCommittedStageState(options.serializationMetadata, serializedState);
      if (!serialized.ok) {
        return latchFatalErrors(serialized.errors);
      }
      if (options.testingHooks.recordHashableStateOnSerialize) {
        const hashableState = createHashableGameState(options.serializationMetadata, committedState);
        if (!hashableState.ok) {
          return latchFatalErrors(hashableState.errors);
        }
        options.testingHooks.recordHashableStateOnSerialize(hashableState.value);
      }
      return serialized;
    },
    tick(rawInput) {
      if (fatalErrors) {
        return errorResult(fatalErrors);
      }
      const plainInput = deepFreezePlainData(rawInput);
      if (!plainInput) {
        return coreError("input.invalidShape", "InputFrame must be JSON-compatible plain data");
      }
      const input = parseInputFrame(plainInput);
      if (!input.ok) {
        return input;
      }
      // system order の applyInput。入力 tick のズレは状態を進める前に拒否する。
      if (input.value.tick !== committedState.expectedTick) {
        return coreError("input.tickMismatch", `Expected tick ${committedState.expectedTick}, got ${input.value.tick}`);
      }

      const faults = applyCommittedStateFaultsBeforeTick(committedState, options.testingHooks);
      committedState = faults.committedState;
      const working = createWorkingStageState(faults.workingStateSource, options.content.stage.id);
      if (!working.ok) {
        return latchFatalErrors(working.errors);
      }
      const outcome = runStageTick(working.value, input.value, options.content, instrumentation);
      if (outcome.kind === "fatal") {
        return latchFatalErrors(outcome.errors);
      }
      if (outcome.kind === "rejected") {
        return outcome.result;
      }
      committedState = outcome.committedState;
      if (instrumentation.collectDebugMetrics && outcome.collisionCandidates !== null) {
        debugTickMetrics = createHeadlessDebugTickMetrics(outcome.collisionCandidates, outcome.frame.events);
      }
      return okResult(outcome.frame);
    },
  };
  options.testingHooks.registerHeadlessDebugStateSerializer?.(
    session,
    () => fatalErrors
      ? errorResult(fatalErrors)
      : createHeadlessDebugCheckpoint(
        options.serializationMetadata,
        committedState,
        options.debugSeed,
        debugTickMetrics,
        options.testingHooks.failHeadlessDebugStateSerialization,
      ),
  );
  return Object.freeze(session);
}

/** 内部 invariant 破壊を fatal reason として latch できる public error に畳む。 */
function freezeFatalErrors(errors: readonly CoreError[]): readonly CoreError[] {
  const detail = errors.map((error) => `${error.code}: ${error.message}`).join("; ");
  return Object.freeze([
    Object.freeze({
      code: "stageSession.fatal" as const,
      message: `Stage session entered a fatal state: ${detail}`,
    }),
  ]);
}
