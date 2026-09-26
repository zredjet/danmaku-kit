import { assertNever } from "../internal/guards.ts";
import { deepFreezeClone } from "../internal/immutable.ts";
import { okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import type { StageSessionSerializationMetadata } from "../serialization/metadata.ts";
import type {
  SerializedDeterministicState,
  SerializedGameState,
  SerializedPendingEvent,
  SerializedRuntimeEntityState,
} from "../serialization/types.ts";
import { XorShift32 } from "../simulation/prng.ts";
import type { RuntimeEntityState } from "../simulation/runtime-entity.ts";
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
    patternRunnerStates: [],
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
      return {
        id: entity.id,
        kind: "player",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        lives: entity.lives,
        invincibleTicksRemaining: entity.invincibleTicksRemaining,
        nextShotAllowedTick: entity.nextShotAllowedTick,
        movement: { speed: entity.movement.speed, focusSpeed: entity.movement.focusSpeed },
        shotDefinitionId: entity.shotDefinitionId,
      };
    case "enemy":
      return {
        id: entity.id,
        kind: "enemy",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        hp: entity.hp,
        scoreOnKill: entity.scoreOnKill,
        pathId: entity.pathId,
        patternId: entity.patternId,
      };
    case "enemyBullet":
      return {
        id: entity.id,
        kind: "enemyBullet",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
      };
    case "playerShot":
      return {
        id: entity.id,
        kind: "playerShot",
        definitionId: entity.definitionId,
        position: { x: entity.position.x, y: entity.position.y },
        collisionRadius: entity.collisionRadius,
        velocity: { x: entity.velocity.x, y: entity.velocity.y },
        remainingLifetimeTicks: entity.remainingLifetimeTicks,
        damage: entity.damage,
      };
  }
}

/** pending queue に残せる event を public serialize 用 DTO に写す。 */
function projectPendingEventForSerializedState(event: CommittedPendingEvent): SerializedPendingEvent {
  switch (event.type) {
    case "stageStarted":
      return {
        type: "stageStarted",
        tick: event.tick,
        stageId: event.stageId,
      };
    default:
      return assertNever(event.type);
  }
}
