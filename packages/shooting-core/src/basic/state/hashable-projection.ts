import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import type { HashableGameState, HashablePendingEvent, HashableRuntimeEntityState } from "../hash/hashable-state.ts";
import { okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import type { StageSessionSerializationMetadata } from "../serialization/metadata.ts";
import { assertNever } from "../shared/guards.ts";
import { deepFreezeClone } from "../shared/immutable.ts";
import { XorShift32 } from "../simulation/prng.ts";
import { validateCommittedEntityInvariants, validateCommittedPendingEventInvariants } from "./committed-state.ts";
import type { CommittedPendingEvent, CommittedStageState } from "./committed-state.ts";

/** committed snapshot から state hash 用の正規化済み内部 DTO を生成する。 */
export function createHashableGameState(
  metadata: StageSessionSerializationMetadata,
  committedState: CommittedStageState,
): CoreResult<HashableGameState> {
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

  return okResult(deepFreezeClone({
    stateHashVersion: metadata.stateHashVersion,
    coreVersion: metadata.coreVersion,
    schemaVersion: metadata.schemaVersion,
    expectedTick: committedState.expectedTick,
    nextEntityId: committedState.nextEntityId,
    timelineCursor: committedState.timelineCursor,
    prngState: prng.value.snapshot(),
    score: committedState.score,
    runtimeEntities: committedState.activeEntities.map((entity) => projectRuntimeEntityForHashableState(entity)),
    pendingEvents: pendingEvents.value.map((event) => projectPendingEventForHashableState(event)),
    patternRunnerStates: [],
    enabledFeatureStates: [],
  }));
}

/** runtime entity から hash 専用 DTO へ明示的に写す。 */
function projectRuntimeEntityForHashableState(entity: RuntimeEntityState): HashableRuntimeEntityState {
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

/**
 * committed pending event から hash 専用 DTO へ明示的に写す。
 *
 * committed 側の全 field を写すことを `satisfies` で、DTO にない field を写さないことを戻り値型で検査し、
 * committed pending event と DTO の field 集合のずれを型エラーにする。
 */
function projectPendingEventForHashableState(event: CommittedPendingEvent): HashablePendingEvent {
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
