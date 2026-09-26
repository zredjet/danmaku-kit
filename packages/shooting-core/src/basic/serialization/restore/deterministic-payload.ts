import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import { MAX_PLAYER_SHOT_LIFETIME_TICKS, MAX_STAGE_TIMELINE_STEPS } from "../../content/runtime-budgets.ts";
import type { StageDefinition } from "../../content/types.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { isPositiveSafeInteger } from "../../shared/guards.ts";
import { compareUtf8Lexicographic } from "../../shared/utf8-order.ts";
import { XorShift32 } from "../../simulation/prng.ts";
import type { SerializedPrngState } from "../../simulation/prng.ts";
import type { RuntimeEntityState } from "../../simulation/runtime-entity.ts";
import type { CommittedPendingEvent } from "../../state/committed-state.ts";
import {
  createRestoreJsonBudget,
  isRestoreJsonStringWithinSingleValueBudget,
  validateRestoreJsonPayload,
} from "../restore-json.ts";
import type { RestoreJsonBudget } from "../restore-json.ts";
import type { SerializedEnabledFeatureState, SerializedPatternRunnerState } from "../types.ts";
import { cloneRestoreArray, cloneRestorePlainRecord } from "./plain-data.ts";
import { validateRestoreRuntimeEntities } from "./runtime-entities.ts";
import type { RestoreTopLevelState } from "./top-level-state.ts";

const MAX_RESTORE_RUNTIME_ENTITIES_LENGTH = 1
  + (MAX_STAGE_TIMELINE_STEPS * 2)
  + MAX_PLAYER_SHOT_LIFETIME_TICKS;

const MAX_RESTORE_EXTENSION_STATES_LENGTH = 128;

const RESTORE_PATTERN_RUNNER_STATE_KEYS = Object.freeze([
  "runnerId",
  "patternId",
  "stateVersion",
  "payload",
] as const satisfies ReadonlyArray<keyof SerializedPatternRunnerState>);

const RESTORE_ENABLED_FEATURE_STATE_KEYS = Object.freeze([
  "feature",
  "stateVersion",
  "payload",
] as const satisfies ReadonlyArray<keyof SerializedEnabledFeatureState>);

type ValidatedRestorePatternRunnerState = SerializedPatternRunnerState;

type ValidatedRestoreEnabledFeatureState = SerializedEnabledFeatureState;

export type ValidatedRestoreDeterministicPayload = Readonly<{
  activeEntities: readonly RuntimeEntityState[];
  enabledFeatureStates: readonly ValidatedRestoreEnabledFeatureState[];
  pendingEvents: readonly CommittedPendingEvent[];
  patternRunnerStates: readonly ValidatedRestorePatternRunnerState[];
  score: number;
  timelineCursor: number;
}>;

/** PRNG の復元失敗を LoadedGame.restore 用の public error に包み、committed snapshot 用に正規化する。 */
export function validateRestorePrngSnapshot(prngState: unknown): CoreResult<SerializedPrngState> {
  const state = cloneRestorePlainRecord(prngState, "prngState", ["state"]);
  if (!state.ok) {
    return state;
  }
  const prng = XorShift32.restore(state.value);
  if (!prng.ok) {
    return coreError("state.prngInvalid", "prngState cannot be restored by the PRNG");
  }

  return okResult(prng.value.snapshot());
}

/** deterministic payload を検証し、committed 変換前 DTO へ正規化する。 */
export function parseRestoreDeterministicPayload(
  state: RestoreTopLevelState,
  content: LoadedContentIndex,
): CoreResult<ValidatedRestoreDeterministicPayload> {
  const record = cloneRestorePlainRecord(state.state, "state", [
    "runtimeEntities",
    "pendingEvents",
    "score",
    "timelineCursor",
    "patternRunnerStates",
    "enabledFeatureStates",
  ]);
  if (!record.ok) {
    return record;
  }

  const runtimeEntities = cloneRestoreArray(
    record.value.runtimeEntities,
    "state.runtimeEntities",
    MAX_RESTORE_RUNTIME_ENTITIES_LENGTH,
  );
  if (!runtimeEntities.ok) {
    return runtimeEntities;
  }
  const initialEnvelope = validateRestoreInitialRuntimeEntityEnvelope(state, runtimeEntities.value.length);
  if (!initialEnvelope.ok) {
    return initialEnvelope;
  }
  const pendingEvents = cloneRestoreArray(record.value.pendingEvents, "state.pendingEvents");
  if (!pendingEvents.ok) {
    return pendingEvents;
  }
  const patternRunnerStates = cloneRestoreArray(
    record.value.patternRunnerStates,
    "state.patternRunnerStates",
    MAX_RESTORE_EXTENSION_STATES_LENGTH,
  );
  if (!patternRunnerStates.ok) {
    return patternRunnerStates;
  }
  const enabledFeatureStates = cloneRestoreArray(
    record.value.enabledFeatureStates,
    "state.enabledFeatureStates",
    MAX_RESTORE_EXTENSION_STATES_LENGTH,
  );
  if (!enabledFeatureStates.ok) {
    return enabledFeatureStates;
  }

  if (
    typeof record.value.score !== "number"
    || !Number.isSafeInteger(record.value.score)
    || record.value.score < 0
  ) {
    return coreError("state.invalidShape", "state.score must be a non-negative safe integer");
  }
  if (state.expectedTick === 0 && record.value.score !== 0) {
    return coreError("state.invalidShape", "initial restore state score must be zero");
  }
  const stage = content.stagesById.get(state.stageId);
  if (!stage) {
    return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }
  if (
    typeof record.value.timelineCursor !== "number"
    || !Number.isSafeInteger(record.value.timelineCursor)
    || record.value.timelineCursor < 0
    || record.value.timelineCursor > stage.timeline.length
  ) {
    return coreError("state.invalidShape", "state.timelineCursor must be within the stage timeline range");
  }
  const expectedTimelineCursor = findExpectedTimelineCursor(stage, state.expectedTick);
  if (record.value.timelineCursor !== expectedTimelineCursor) {
    return coreError("state.invalidShape", "state.timelineCursor must match expectedTick");
  }
  const pendingEventsContract = validateRestorePendingEvents(state, pendingEvents.value);
  if (!pendingEventsContract.ok) {
    return pendingEventsContract;
  }
  const runtimeEntitiesContract = validateRestoreRuntimeEntities(
    state,
    runtimeEntities.value,
    content,
    stage,
    record.value.timelineCursor,
  );
  if (!runtimeEntitiesContract.ok) {
    return runtimeEntitiesContract;
  }
  const extensionPayloadBudget = createRestoreJsonBudget();
  const patternRunnerStateContract = validateRestorePatternRunnerStates(
    patternRunnerStates.value,
    extensionPayloadBudget,
  );
  if (!patternRunnerStateContract.ok) {
    return patternRunnerStateContract;
  }
  const enabledFeatureStateContract = validateRestoreEnabledFeatureStates(
    enabledFeatureStates.value,
    extensionPayloadBudget,
  );
  if (!enabledFeatureStateContract.ok) {
    return enabledFeatureStateContract;
  }
  if (patternRunnerStates.value.length > 0) {
    return coreError("state.featureMismatch", "state.patternRunnerStates require a compatible pattern runner module");
  }
  if (enabledFeatureStates.value.length > 0) {
    return coreError("state.featureMismatch", "state.enabledFeatureStates require enabled feature modules");
  }

  return okResult(Object.freeze({
    activeEntities: runtimeEntitiesContract.value,
    enabledFeatureStates: enabledFeatureStateContract.value,
    pendingEvents: pendingEventsContract.value,
    patternRunnerStates: patternRunnerStateContract.value,
    score: record.value.score,
    timelineCursor: record.value.timelineCursor,
  }));
}

/** startStage 直後の snapshot だけが持つ entity 数と nextEntityId の不変条件を検証する。 */
function validateRestoreInitialRuntimeEntityEnvelope(
  state: RestoreTopLevelState,
  runtimeEntityCount: number,
): CoreResult<null> {
  if (state.expectedTick === 0 && (runtimeEntityCount !== 1 || state.nextEntityId !== 2)) {
    return coreError("state.invalidShape", "initial restore state must contain only the initial player entity");
  }

  return okResult(null);
}

/** expectedTick 時点で未処理であるべき最初の timeline index を計算する。 */
function findExpectedTimelineCursor(stage: StageDefinition, expectedTick: number): number {
  const index = stage.timeline.findIndex((step) => step.tick >= expectedTick);
  return index === -1 ? stage.timeline.length : index;
}

/** pendingEvents は startStage 直後の stageStarted 再通知だけを許可する。 */
function validateRestorePendingEvents(
  state: RestoreTopLevelState,
  pendingEvents: readonly unknown[],
): CoreResult<readonly CommittedPendingEvent[]> {
  if (state.expectedTick > 0) {
    if (pendingEvents.length !== 0) {
      return coreError("state.invalidShape", "state.pendingEvents must be empty after tick 0");
    }
    return okResult(Object.freeze([]));
  }
  if (pendingEvents.length !== 1) {
    return coreError("state.invalidShape", "state.pendingEvents must contain stageStarted at tick 0");
  }
  const event = cloneRestorePlainRecord(pendingEvents[0], "state.pendingEvents[0]", ["type", "tick", "stageId"]);
  if (!event.ok) {
    return event;
  }
  if (event.value.type !== "stageStarted" || event.value.tick !== 0 || event.value.stageId !== state.stageId) {
    return coreError("state.invalidShape", "state.pendingEvents[0] must be stageStarted for the restored stage");
  }

  return okResult(Object.freeze([{ type: "stageStarted", tick: 0, stageId: state.stageId }]));
}

/** pattern runner extension state の shape、順序、payload JSON 互換性を検証する。 */
function validateRestorePatternRunnerStates(
  states: readonly unknown[],
  budget: RestoreJsonBudget,
): CoreResult<readonly ValidatedRestorePatternRunnerState[]> {
  let previousRunnerId: string | null = null;
  const validatedStates: ValidatedRestorePatternRunnerState[] = [];
  for (let index = 0; index < states.length; index += 1) {
    const state = cloneRestorePlainRecord(
      states[index],
      `state.patternRunnerStates[${index}]`,
      RESTORE_PATTERN_RUNNER_STATE_KEYS,
    );
    if (!state.ok) {
      return state;
    }
    if (typeof state.value.runnerId !== "string" || !isValidPatternRunnerId(state.value.runnerId)) {
      return coreError("state.invalidShape", "pattern runner state runnerId must be patternRunner.* with a non-empty suffix");
    }
    if (previousRunnerId !== null && compareUtf8Lexicographic(previousRunnerId, state.value.runnerId) >= 0) {
      return coreError("state.invalidShape", "state.patternRunnerStates must be ordered by unique runnerId");
    }
    previousRunnerId = state.value.runnerId;
    if (typeof state.value.patternId !== "string" || !isNamespacedId(state.value.patternId, "pattern")) {
      return coreError("state.invalidShape", "pattern runner state patternId must be a valid pattern id");
    }
    if (!isPositiveSafeInteger(state.value.stateVersion)) {
      return coreError("state.invalidShape", "pattern runner stateVersion must be a positive safe integer");
    }
    const payload = validateRestoreJsonPayload(
      state.value.payload,
      `state.patternRunnerStates[${index}].payload`,
      budget,
    );
    if (!payload.ok) {
      return payload;
    }
    validatedStates.push(Object.freeze({
      runnerId: state.value.runnerId as SerializedPatternRunnerState["runnerId"],
      patternId: state.value.patternId as SerializedPatternRunnerState["patternId"],
      stateVersion: state.value.stateVersion,
      payload: payload.value,
    }));
  }

  return okResult(Object.freeze(validatedStates));
}

/** pattern runner id は namespace prefix と空でない suffix を runtime でも保証する。 */
function isValidPatternRunnerId(value: string): boolean {
  return value.startsWith("patternRunner.")
    && value.length > "patternRunner.".length
    && isRestoreJsonStringWithinSingleValueBudget(value);
}

/** enabled feature extension state の shape、順序、payload JSON 互換性を検証する。 */
function validateRestoreEnabledFeatureStates(
  states: readonly unknown[],
  budget: RestoreJsonBudget,
): CoreResult<readonly ValidatedRestoreEnabledFeatureState[]> {
  const validatedStates: ValidatedRestoreEnabledFeatureState[] = [];
  for (let index = 0; index < states.length; index += 1) {
    const state = cloneRestorePlainRecord(
      states[index],
      `state.enabledFeatureStates[${index}]`,
      RESTORE_ENABLED_FEATURE_STATE_KEYS,
    );
    if (!state.ok) {
      return state;
    }
    if (
      typeof state.value.feature !== "string"
      || !isRestoreJsonStringWithinSingleValueBudget(state.value.feature)
    ) {
      return coreError("state.invalidShape", "enabled feature state feature must be a restore-safe string");
    }
    if (!isPositiveSafeInteger(state.value.stateVersion)) {
      return coreError("state.invalidShape", "enabled feature stateVersion must be a positive safe integer");
    }
    const payload = validateRestoreJsonPayload(
      state.value.payload,
      `state.enabledFeatureStates[${index}].payload`,
      budget,
    );
    if (!payload.ok) {
      return payload;
    }
    validatedStates.push(Object.freeze({
      feature: state.value.feature as SerializedEnabledFeatureState["feature"],
      stateVersion: state.value.stateVersion,
      payload: payload.value,
    }));
  }

  return okResult(Object.freeze(validatedStates));
}
