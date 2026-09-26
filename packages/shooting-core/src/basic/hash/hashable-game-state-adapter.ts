import { KNOWN_ENABLED_FEATURES } from "../content/types.ts";
import type { EnabledFeature } from "../content/types.ts";
import {
  HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER,
  HASHABLE_FIXED_STRUCT_NAME_BY_DTO,
  HASHABLE_GAME_STATE_FIELD_ORDER,
  HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER,
  HASHABLE_PENDING_EVENT_FIELD_ORDER,
  HASHABLE_PRNG_STATE_FIELD_ORDER,
  HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND,
  HASHABLE_VECTOR2_FIELD_ORDER,
} from "./hashable-state.ts";
import { HASHABLE_ENEMY_PATH_RUNNER_STATE_FIELD_ORDER } from "../entities/enemy/snapshot.ts";
import type { HashableEnemyPathRunnerState } from "../entities/enemy/snapshot.ts";
import { HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER } from "../entities/player/snapshot.ts";
import type {
  HashableEnabledFeatureState,
  HashableGameState,
  HashableJsonValue,
  HashablePatternRunnerState,
  HashablePendingEvent,
  HashablePrngState,
  HashableRuntimeEntityState,
} from "./hashable-state.ts";
import type { HashablePlayerMovement } from "../entities/player/snapshot.ts";
import type { HashableVector2 } from "../entities/snapshot-common.ts";
import { compareUtf8Lexicographic } from "../shared/utf8-order.ts";
import { fixedStruct } from "./canonical-encoder.ts";
import type { CanonicalFixedStruct, CanonicalValue } from "./canonical-encoder.ts";

/**
 * HashableGameState を canonical encoder 専用の fixedStruct tree へ変換する。
 *
 * field order と struct name は `hashable-state.ts` の versioned table からのみ取得する。呼び出し元の配列は
 * 変更せず、runtime entity / pattern runner / feature state は設計書で定めた順序の copy を作る。
 */
export function adaptHashableGameStateToCanonicalValue(state: HashableGameState): CanonicalFixedStruct {
  const canonicalState = {
    stateHashVersion: state.stateHashVersion,
    coreVersion: state.coreVersion,
    schemaVersion: state.schemaVersion,
    expectedTick: state.expectedTick,
    nextEntityId: state.nextEntityId,
    timelineCursor: state.timelineCursor,
    prngState: adaptHashablePrngStateToCanonicalValue(state.prngState),
    score: state.score,
    runtimeEntities: [...state.runtimeEntities]
      .sort((left, right) => left.id - right.id)
      .map(adaptRuntimeEntity),
    pendingEvents: state.pendingEvents.map(adaptPendingEvent),
    patternRunnerStates: [...state.patternRunnerStates]
      .sort((left, right) => compareUtf8Lexicographic(left.runnerId, right.runnerId))
      .map(adaptPatternRunnerState),
    enabledFeatureStates: [...state.enabledFeatureStates]
      .sort(compareEnabledFeatureState)
      .map(adaptEnabledFeatureState),
  } satisfies Record<keyof HashableGameState, CanonicalValue>;

  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.gameState,
    HASHABLE_GAME_STATE_FIELD_ORDER,
    canonicalState,
  );
}

/** PRNG state 単体を state hash と同じ fixedStruct format へ変換する。 */
export function adaptHashablePrngStateToCanonicalValue(state: HashablePrngState): CanonicalFixedStruct {
  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.prngState,
    HASHABLE_PRNG_STATE_FIELD_ORDER,
    state,
  );
}

function adaptVector2(value: HashableVector2): CanonicalFixedStruct {
  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.vector2,
    HASHABLE_VECTOR2_FIELD_ORDER,
    value,
  );
}

function adaptPlayerMovement(value: HashablePlayerMovement): CanonicalFixedStruct {
  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.playerMovement,
    HASHABLE_PLAYER_MOVEMENT_FIELD_ORDER,
    value,
  );
}

function adaptEnemyPathRunnerState(value: HashableEnemyPathRunnerState): CanonicalFixedStruct {
  const canonicalState = {
    ...value,
    segmentStart: adaptVector2(value.segmentStart),
  } satisfies Record<keyof HashableEnemyPathRunnerState, CanonicalEntityFieldValue>;
  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.enemyPathRunnerState,
    HASHABLE_ENEMY_PATH_RUNNER_STATE_FIELD_ORDER,
    canonicalState,
  );
}

/**
 * runtime entity の field として canonical encode してよい値。
 *
 * position / velocity / movement のような nested struct は fixedStruct へ変換してから渡す。変換し忘れた object や
 * array は canonical object として別の byte 列になるため、型エラーにする。
 */
type CanonicalEntityFieldValue = null | boolean | number | string | CanonicalFixedStruct;

function adaptRuntimeEntity(value: HashableRuntimeEntityState): CanonicalFixedStruct {
  switch (value.kind) {
    case "player": {
      const canonicalEntity = {
        ...value,
        position: adaptVector2(value.position),
        movement: adaptPlayerMovement(value.movement),
      } satisfies Record<keyof typeof value, CanonicalEntityFieldValue>;
      return fixedStructFromFieldOrder(
        HASHABLE_FIXED_STRUCT_NAME_BY_DTO.playerRuntimeEntity,
        HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.player,
        canonicalEntity,
      );
    }
    case "enemy": {
      const canonicalEntity = {
        ...value,
        position: adaptVector2(value.position),
        pathRunnerState: adaptEnemyPathRunnerState(value.pathRunnerState),
      } satisfies Record<keyof typeof value, CanonicalEntityFieldValue>;
      return fixedStructFromFieldOrder(
        HASHABLE_FIXED_STRUCT_NAME_BY_DTO.enemyRuntimeEntity,
        HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.enemy,
        canonicalEntity,
      );
    }
    case "enemyBullet": {
      const canonicalEntity = {
        ...value,
        position: adaptVector2(value.position),
        velocity: adaptVector2(value.velocity),
        spawnPosition: adaptVector2(value.spawnPosition),
      } satisfies Record<keyof typeof value, CanonicalEntityFieldValue>;
      return fixedStructFromFieldOrder(
        HASHABLE_FIXED_STRUCT_NAME_BY_DTO.enemyBulletRuntimeEntity,
        HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.enemyBullet,
        canonicalEntity,
      );
    }
    case "playerShot": {
      const canonicalEntity = {
        ...value,
        position: adaptVector2(value.position),
        velocity: adaptVector2(value.velocity),
      } satisfies Record<keyof typeof value, CanonicalEntityFieldValue>;
      return fixedStructFromFieldOrder(
        HASHABLE_FIXED_STRUCT_NAME_BY_DTO.playerShotRuntimeEntity,
        HASHABLE_RUNTIME_ENTITY_FIELD_ORDER_BY_KIND.playerShot,
        canonicalEntity,
      );
    }
  }
}

function adaptPendingEvent(value: HashablePendingEvent): CanonicalFixedStruct {
  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.pendingEvent,
    HASHABLE_PENDING_EVENT_FIELD_ORDER,
    value,
  );
}

function adaptPatternRunnerState(value: HashablePatternRunnerState): CanonicalFixedStruct {
  const canonicalState = {
    ...value,
    payload: asCanonicalJsonValue(value.payload),
  } satisfies Record<keyof HashablePatternRunnerState, CanonicalValue>;
  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.patternRunnerState,
    HASHABLE_PATTERN_RUNNER_STATE_FIELD_ORDER,
    canonicalState,
  );
}

function adaptEnabledFeatureState(value: HashableEnabledFeatureState): CanonicalFixedStruct {
  const canonicalState = {
    ...value,
    payload: asCanonicalJsonValue(value.payload),
  } satisfies Record<keyof HashableEnabledFeatureState, CanonicalValue>;
  return fixedStructFromFieldOrder(
    HASHABLE_FIXED_STRUCT_NAME_BY_DTO.enabledFeatureState,
    HASHABLE_ENABLED_FEATURE_STATE_FIELD_ORDER,
    canonicalState,
  );
}

function fixedStructFromFieldOrder<State extends object>(
  name: string,
  fieldOrder: readonly (keyof State)[],
  value: State,
): CanonicalFixedStruct {
  return fixedStruct(name, fieldOrder.map((field) => value[field] as CanonicalValue));
}

function compareEnabledFeatureState(
  left: HashableEnabledFeatureState,
  right: HashableEnabledFeatureState,
): number {
  return enabledFeatureOrder(left.feature) - enabledFeatureOrder(right.feature);
}

function enabledFeatureOrder(feature: EnabledFeature): number {
  return KNOWN_ENABLED_FEATURES.indexOf(feature);
}

/** validation 済み extension payload は canonical object / array と構造互換である。 */
function asCanonicalJsonValue(value: HashableJsonValue): CanonicalValue {
  return value as CanonicalValue;
}
