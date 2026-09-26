import { projectEnemyBulletRuntimeEntityForSerializedState } from "../entities/enemy-bullet/snapshot.ts";
import { projectEnemyRuntimeEntityForSerializedState } from "../entities/enemy/snapshot.ts";
import { projectPlayerShotRuntimeEntityForSerializedState } from "../entities/player-shot/snapshot.ts";
import { projectPlayerRuntimeEntityForSerializedState } from "../entities/player/snapshot.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import {
  PATTERN_RUNNER_STATE_VERSION,
  patternRunnerIdOfEnemy,
  projectPatternRunnerPayload,
} from "../patterns/pattern-runner.ts";
import type { EnemyPatternRunner } from "../patterns/pattern-runner.ts";
import { okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import type { StageSessionSerializationMetadata } from "../serialization/metadata.ts";
import type {
  SerializedDeterministicState,
  SerializedGameState,
  SerializedPatternRunnerState,
  SerializedPendingEvent,
  SerializedRuntimeEntityState,
} from "../serialization/types.ts";
import { assertNever } from "../shared/guards.ts";
import { deepFreezeClone } from "../shared/immutable.ts";
import { compareUtf8Lexicographic } from "../shared/utf8-order.ts";
import { XorShift32 } from "../simulation/prng.ts";
import { validateCommittedEntityInvariants, validateCommittedPendingEventInvariants } from "./committed-state.ts";
import type { CommittedPendingEvent, UntrustedCommittedStageState } from "./committed-state.ts";

/** committed snapshot と session metadata から public serialize DTO を生成する。 */
export function serializeCommittedStageState(
  metadata: StageSessionSerializationMetadata,
  committedState: UntrustedCommittedStageState,
): CoreResult<SerializedGameState> {
  const prng = XorShift32.restore(committedState.prngState);
  if (!prng.ok) {
    return prng;
  }
  const entityInvariant = validateCommittedEntityInvariants(committedState);
  if (!entityInvariant.ok) {
    return entityInvariant;
  }
  const pendingEvents = validateCommittedPendingEventInvariants(committedState, metadata.stageId);
  if (!pendingEvents.ok) {
    return pendingEvents;
  }

  const deterministicRuntimeEntities = committedState.activeEntities.map((entity) => projectRuntimeEntityForSerializedState(entity));
  const deterministicPendingEvents = pendingEvents.value.map((event) => projectPendingEventForSerializedState(event));
  const state: SerializedDeterministicState = {
    runtimeEntities: deterministicRuntimeEntities,
    pendingEvents: deterministicPendingEvents,
    score: committedState.score,
    timelineCursor: committedState.timelineCursor,
    stageStatus: committedState.stageStatus,
    patternRunnerStates: committedState.patternRunners
      .map((runner) => projectPatternRunnerForSerializedState(runner))
      .sort((left, right) => compareUtf8Lexicographic(left.runnerId, right.runnerId)),
    enabledFeatureStates: [],
  };

  return okResult(deepFreezeClone({
    coreVersion: metadata.coreVersion,
    schemaVersion: metadata.schemaVersion,
    contentVersion: metadata.contentVersion,
    inputFormatVersion: metadata.inputFormatVersion,
    stateHashVersion: metadata.stateHashVersion,
    enabledFeatures: metadata.enabledFeatures,
    stageId: metadata.stageId,
    difficulty: metadata.difficulty,
    playerId: metadata.playerId,
    expectedTick: committedState.expectedTick,
    nextEntityId: committedState.nextEntityId,
    prngState: prng.value.snapshot(),
    state,
  }));
}

/** runtime entity を public serialize 用 DTO に写す。 */
function projectRuntimeEntityForSerializedState(entity: RuntimeEntityState): SerializedRuntimeEntityState {
  switch (entity.kind) {
    case "player":
      return projectPlayerRuntimeEntityForSerializedState(entity);
    case "enemy":
      return projectEnemyRuntimeEntityForSerializedState(entity);
    case "enemyBullet":
      return projectEnemyBulletRuntimeEntityForSerializedState(entity);
    case "playerShot":
      return projectPlayerShotRuntimeEntityForSerializedState(entity);
  }
}

/** enemy の pattern runner を public serialize 用 DTO に写す。 */
function projectPatternRunnerForSerializedState(runner: EnemyPatternRunner): SerializedPatternRunnerState {
  return {
    runnerId: patternRunnerIdOfEnemy(runner.enemyId),
    patternId: runner.patternId,
    stateVersion: PATTERN_RUNNER_STATE_VERSION,
    payload: projectPatternRunnerPayload(runner.state),
  };
}

/**
 * pending queue に残せる event を public serialize 用 DTO に写す。
 *
 * committed 側の全 field を写すことを `satisfies` で、DTO にない field を写さないことを戻り値型で検査し、
 * committed pending event と DTO の field 集合のずれを型エラーにする。
 */
function projectPendingEventForSerializedState(event: CommittedPendingEvent): SerializedPendingEvent {
  switch (event.type) {
    case "stageStarted":
      return {
        type: "stageStarted",
        tick: event.tick,
        stageId: event.stageId,
      } satisfies Required<CommittedPendingEvent>;
    default:
      return assertNever(event.type);
  }
}
