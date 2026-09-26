import type { StageId } from "../content/types.ts";
import { EventLog } from "../events/game-event.ts";
import type { HashablePendingEvent } from "../hash/hashable-state.ts";
import { deepFreezeClone } from "../internal/immutable.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { EntityAllocator } from "../simulation/entity.ts";
import { XorShift32 } from "../simulation/prng.ts";
import type { SerializedPrngState } from "../simulation/prng.ts";
import type { RuntimeEntityState } from "../simulation/runtime-entity.ts";
import { freezeEntitiesInIdOrder } from "../simulation/system-order.ts";

/** Committed state が次 tick へ持ち越してよい deterministic event。 */
export type CommittedPendingEvent = HashablePendingEvent;

export type CommittedStageState = Readonly<{
  expectedTick: number;
  activeEntities: readonly RuntimeEntityState[];
  nextEntityId: number;
  pendingEvents: readonly CommittedPendingEvent[];
  prngState: SerializedPrngState;
  score: number;
  timelineCursor: number;
}>;

/** restore や fault injection 直後の、PRNG / pending event 検証前 committed snapshot。 */
export type UntrustedCommittedStageState = Omit<CommittedStageState, "pendingEvents" | "prngState"> & Readonly<{
  pendingEvents: readonly unknown[];
  prngState: unknown;
}>;

export type WorkingStageState = {
  expectedTick: number;
  activeEntities: RuntimeEntityState[];
  entityAllocator: EntityAllocator;
  eventLog: EventLog;
  prng: XorShift32;
  score: number;
  timelineCursor: number;
};

/** committed 側で保持する値を mutable handle なしの immutable snapshot に正規化する。 */
export function createCommittedStageState(state: {
  expectedTick: number;
  activeEntities: readonly RuntimeEntityState[];
  nextEntityId: number;
  pendingEvents: readonly CommittedPendingEvent[];
  prngState: SerializedPrngState;
  score: number;
  timelineCursor: number;
}): CommittedStageState {
  const orderedEntities = freezeEntitiesInIdOrder(state.activeEntities);
  return Object.freeze({
    expectedTick: state.expectedTick,
    activeEntities: deepFreezeClone(orderedEntities),
    nextEntityId: state.nextEntityId,
    pendingEvents: deepFreezeClone(state.pendingEvents),
    prngState: deepFreezeClone(state.prngState),
    score: state.score,
    timelineCursor: state.timelineCursor,
  });
}

/** 1 tick 分の作業領域を committed snapshot から復元する。 */
export function createWorkingStageState(committedState: UntrustedCommittedStageState, stageId: StageId): CoreResult<WorkingStageState> {
  const restoredPrng = XorShift32.restore(committedState.prngState);
  if (!restoredPrng.ok) {
    return restoredPrng;
  }
  const restoredAllocator = EntityAllocator.restore(committedState.nextEntityId);
  if (!restoredAllocator.ok) {
    return restoredAllocator;
  }
  const entityInvariant = validateCommittedEntityInvariants(committedState);
  if (!entityInvariant.ok) {
    return entityInvariant;
  }
  const pendingEvents = validateCommittedPendingEventInvariants(committedState, stageId);
  if (!pendingEvents.ok) {
    return pendingEvents;
  }

  const eventLog = new EventLog();
  for (const event of pendingEvents.value) {
    eventLog.push(event);
  }

  return okResult({
    activeEntities: [...deepFreezeClone(committedState.activeEntities)],
    entityAllocator: restoredAllocator.value,
    eventLog,
    expectedTick: committedState.expectedTick,
    prng: restoredPrng.value,
    score: committedState.score,
    timelineCursor: committedState.timelineCursor,
  });
}

/** committed snapshot の entity id と allocator snapshot の整合性を検証する。 */
export function validateCommittedEntityInvariants(committedState: UntrustedCommittedStageState): CoreResult<null> {
  const restoredAllocator = EntityAllocator.restore(committedState.nextEntityId);
  if (!restoredAllocator.ok) {
    return restoredAllocator;
  }

  const ids = new Set<number>();
  let maxEntityId = 0;
  let previousEntityId = 0;

  for (const entity of committedState.activeEntities) {
    if (!Number.isSafeInteger(entity.id) || entity.id < 1) {
      return coreError("entityAllocator.invalidState", "active entity id must be a positive safe integer");
    }
    if (entity.id <= previousEntityId) {
      return coreError("entityAllocator.invalidState", "active entity ids must be sorted in strict ascending order");
    }
    if (ids.has(entity.id)) {
      return coreError("entityAllocator.invalidState", `active entity id must be unique: ${entity.id}`);
    }
    ids.add(entity.id);
    maxEntityId = Math.max(maxEntityId, entity.id);
    previousEntityId = entity.id;
  }

  if (committedState.nextEntityId <= maxEntityId) {
    return coreError(
      "entityAllocator.invalidState",
      `nextEntityId must be greater than active entity ids: nextEntityId=${committedState.nextEntityId}, maxEntityId=${maxEntityId}`,
    );
  }

  return okResult(null);
}

/** committed snapshot に持ち越された pending event が tick と stage に整合することを検証する。 */
export function validateCommittedPendingEventInvariants(
  committedState: UntrustedCommittedStageState,
  stageId: StageId,
): CoreResult<readonly CommittedPendingEvent[]> {
  const pendingEvents = committedState.pendingEvents;
  if (committedState.expectedTick === 0) {
    if (
      pendingEvents.length !== 1
      || !isCommittedStageStartedEvent(pendingEvents[0], stageId)
    ) {
      return coreError("stageSession.fatal", "unsupported pending event in committed state");
    }
    return okResult(Object.freeze([{ type: "stageStarted", tick: 0, stageId }]));
  }

  if (pendingEvents.length > 0) {
    return coreError("stageSession.fatal", "unsupported pending event in committed state");
  }
  return okResult(Object.freeze([]));
}

/** 未検証の pending event が、同 stage の stageStarted event かどうかを判定する。 */
function isCommittedStageStartedEvent(value: unknown, stageId: StageId): value is CommittedPendingEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3
    || Object.getOwnPropertySymbols(value).length > 0
    || !keys.includes("type")
    || !keys.includes("tick")
    || !keys.includes("stageId")
  ) {
    return false;
  }
  const event = value as Partial<CommittedPendingEvent>;
  return event.type === "stageStarted" && event.tick === 0 && event.stageId === stageId;
}
