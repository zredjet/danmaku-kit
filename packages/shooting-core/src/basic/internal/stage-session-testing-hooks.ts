import type { HashableGameState } from "../hash/hashable-state.ts";
import { coreError } from "../result.ts";
import type { CoreResult } from "../result.ts";
import type { SerializedGameState } from "../serialization/types.ts";
import type { CommittedStageState, UntrustedCommittedStageState, WorkingStageState } from "../state/committed-state.ts";
import type { RegisterHeadlessDebugStateSerializer } from "./debug-state.ts";
import { deepFreezeClone } from "./immutable.ts";

export type StageSessionTestingHookOptions = Readonly<{
  corruptCommittedPrngStateTicks?: readonly number[];
  failAfterWorkingMutationTicks?: readonly number[];
  overrideCommittedNextEntityIdTicks?: ReadonlyArray<Readonly<{
    tick: number;
    nextEntityId: number;
  }>>;
  overrideCommittedPendingEventsTicks?: ReadonlyArray<Readonly<{
    tick: number;
    pendingEvents: readonly unknown[];
  }>>;
  reverseCommittedEntitiesOnSerialize?: boolean;
  overrideCommittedNextEntityIdOnSerialize?: number;
  overrideCommittedPendingEventsOnSerialize?: readonly unknown[];
  overrideCommittedPrngStateOnSerialize?: unknown;
  failHeadlessDebugStateSerialization?: boolean;
  recordCommittedStateOnFatal?: (state: CommittedStageState) => void;
  recordHashableStateOnSerialize?: (state: HashableGameState) => void;
  recordRestoreSerializedSnapshot?: (state: SerializedGameState) => void;
  registerHeadlessDebugStateSerializer?: RegisterHeadlessDebugStateSerializer;
}>;

export type ActiveStageSessionTestingHooks = Readonly<{
  corruptCommittedPrngStateTicks: Set<number>;
  failAfterWorkingMutationTicks: Set<number>;
  overrideCommittedNextEntityIdByTick: Map<number, number>;
  overrideCommittedPendingEventsByTick: Map<number, readonly unknown[]>;
  reverseCommittedEntitiesOnSerialize: boolean;
  overrideCommittedNextEntityIdOnSerialize?: number;
  overrideCommittedPendingEventsOnSerialize?: readonly unknown[];
  overrideCommittedPrngStateOnSerialize?: unknown;
  failHeadlessDebugStateSerialization: boolean;
  recordCommittedStateOnFatal?: (state: CommittedStageState) => void;
  recordHashableStateOnSerialize?: (state: HashableGameState) => void;
  registerHeadlessDebugStateSerializer?: RegisterHeadlessDebugStateSerializer;
}>;

/** 内部テスト用 hook を stage session ごとの消費状態へ変換する。 */
export function createActiveStageSessionTestingHooks(
  testingHooks: StageSessionTestingHookOptions,
): ActiveStageSessionTestingHooks {
  return Object.freeze({
    corruptCommittedPrngStateTicks: new Set(testingHooks.corruptCommittedPrngStateTicks ?? []),
    failAfterWorkingMutationTicks: new Set(testingHooks.failAfterWorkingMutationTicks ?? []),
    overrideCommittedNextEntityIdByTick: createUniqueTickOverrideMap(
      testingHooks.overrideCommittedNextEntityIdTicks ?? [],
      (override) => override.nextEntityId,
    ),
    overrideCommittedPendingEventsByTick: createUniqueTickOverrideMap(
      testingHooks.overrideCommittedPendingEventsTicks ?? [],
      (override) => override.pendingEvents,
    ),
    reverseCommittedEntitiesOnSerialize: testingHooks.reverseCommittedEntitiesOnSerialize ?? false,
    overrideCommittedNextEntityIdOnSerialize: testingHooks.overrideCommittedNextEntityIdOnSerialize,
    overrideCommittedPendingEventsOnSerialize: testingHooks.overrideCommittedPendingEventsOnSerialize,
    overrideCommittedPrngStateOnSerialize: testingHooks.overrideCommittedPrngStateOnSerialize,
    failHeadlessDebugStateSerialization: testingHooks.failHeadlessDebugStateSerialization ?? false,
    recordCommittedStateOnFatal: testingHooks.recordCommittedStateOnFatal,
    recordHashableStateOnSerialize: testingHooks.recordHashableStateOnSerialize,
    registerHeadlessDebugStateSerializer: testingHooks.registerHeadlessDebugStateSerializer,
  });
}

/** hook fixture の重複 tick を setup 時に検出し、silent overwrite を防ぐ。 */
function createUniqueTickOverrideMap<TOverride extends Readonly<{ tick: number }>, TValue>(
  overrides: readonly TOverride[],
  selectValue: (override: TOverride) => TValue,
): Map<number, TValue> {
  const map = new Map<number, TValue>();
  for (const override of overrides) {
    if (map.has(override.tick)) {
      throw new Error(`Duplicate testing hook override tick: ${override.tick}`);
    }
    map.set(override.tick, selectValue(override));
  }
  return map;
}

/** serialize 専用 fault injection を committed snapshot の clone へだけ反映する。 */
export function createSerializeSourceState(
  committedState: CommittedStageState,
  testingHooks: ActiveStageSessionTestingHooks,
): UntrustedCommittedStageState {
  return {
    ...committedState,
    activeEntities: testingHooks.reverseCommittedEntitiesOnSerialize
      ? [...committedState.activeEntities].reverse()
      : committedState.activeEntities,
    nextEntityId: testingHooks.overrideCommittedNextEntityIdOnSerialize ?? committedState.nextEntityId,
    pendingEvents: testingHooks.overrideCommittedPendingEventsOnSerialize === undefined
      ? committedState.pendingEvents
      : deepFreezeClone(testingHooks.overrideCommittedPendingEventsOnSerialize),
    prngState: testingHooks.overrideCommittedPrngStateOnSerialize === undefined
      ? committedState.prngState
      : testingHooks.overrideCommittedPrngStateOnSerialize,
  };
}

/** rollback regression 用に、working state を実際に汚してから失敗させる。 */
export function failAfterWorkingMutationForTesting(working: WorkingStageState): CoreResult<never> {
  const beforeEntityCount = working.activeEntities.length;
  const beforeExpectedTick = working.expectedTick;
  const beforeNextEntityId = working.entityAllocator.snapshot();
  const beforeScore = working.score;
  const beforeTimelineCursor = working.timelineCursor;
  const allocatedEntity = working.entityAllocator.create();
  if (allocatedEntity.ok && working.activeEntities[0]) {
    working.activeEntities.push({ ...working.activeEntities[0], id: allocatedEntity.value.id });
  }
  working.expectedTick += 1;
  working.eventLog.push({ type: "tickAdvanced", tick: working.expectedTick });
  working.prng.nextUint32();
  working.score += 1;
  working.timelineCursor += 1;
  return coreError(
    "testHook.failure",
    [
      "test hook failed after mutating working stage state",
      `entities=${beforeEntityCount}->${working.activeEntities.length}`,
      `expectedTick=${beforeExpectedTick}->${working.expectedTick}`,
      `nextEntityId=${beforeNextEntityId}->${working.entityAllocator.snapshot()}`,
      `score=${beforeScore}->${working.score}`,
      `timelineCursor=${beforeTimelineCursor}->${working.timelineCursor}`,
    ].join("; "),
  );
}
