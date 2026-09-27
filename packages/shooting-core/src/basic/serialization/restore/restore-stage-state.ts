import type { LoadedContentIndex } from "../../content/content-index.ts";
import type { AnyFeatureModule } from "../../extension/feature-module.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import type { SerializedPrngState } from "../../simulation/prng.ts";
import { createCommittedStageState } from "../../state/committed-state.ts";
import type { CommittedFeatureState, CommittedStageState } from "../../state/committed-state.ts";
import { serializeCommittedStageState } from "../../state/serialize-projection.ts";
import {
  SERIALIZED_INPUT_FORMAT_VERSION,
  SERIALIZED_STATE_HASH_VERSION,
  canonicalizeEnabledFeatures,
} from "../metadata.ts";
import type { StageSessionSerializationMetadata } from "../metadata.ts";
import { cloneRestoreTopLevelPlainRecord } from "../restore-plain-data.ts";
import type { SerializedGameState } from "../types.ts";
import { parseRestoreDeterministicPayload, validateRestorePrngSnapshot } from "./deterministic-payload.ts";
import { restoreFeatureStates } from "./feature-states.ts";
import type { ValidatedRestoreDeterministicPayload } from "./deterministic-payload.ts";
import {
  parseRestoreCompatibilityMetadata,
  parseRestoreSchemaMetadata,
  parseRestoreStateHashVersion,
  parseRestoreTopLevelState,
  parseRestoreTopLevelStringField,
  validateRestoreContentCompatibility,
  validateRestoreContentVersionCompatibility,
  validateRestoreInputFormatCompatibility,
  validateRestoreSchemaCompatibility,
  validateRestoreStateHashVersionCompatibility,
} from "./top-level-state.ts";
import type { RestoreCompatibilityMetadata, RestoreTopLevelState, RestoreVersionMetadata } from "./top-level-state.ts";

/** restore 検証を通過した snapshot から stage session を開始するための committed state と metadata。 */
export type RestoredStageState = Readonly<{
  committedState: CommittedStageState;
  serializationMetadata: StageSessionSerializationMetadata;
  serializedSnapshot: SerializedGameState;
}>;

/**
 * 未検証の serialized snapshot を検証し、stage session の初期 committed state へ変換する。
 *
 * core / schema / input format / state hash / content の互換性を nested payload の shape error より
 * 先に分類し、最後に既存 serialize 経路で committed state を再検証する。
 */
export function restoreStageState(
  rawState: unknown,
  content: LoadedContentIndex,
  coreVersion: string,
  features: readonly AnyFeatureModule[],
): CoreResult<RestoredStageState> {
  const schemaMetadata = parseRestoreSchemaMetadata(rawState);
  if (!schemaMetadata.ok) {
    return schemaMetadata;
  }
  const schemaCompatibility = validateRestoreSchemaCompatibility(schemaMetadata.value, content, coreVersion);
  if (!schemaCompatibility.ok) {
    return schemaCompatibility;
  }
  const topLevelState = cloneRestoreTopLevelPlainRecord(rawState);
  if (!topLevelState.ok) {
    return topLevelState;
  }
  const record = topLevelState.value;
  const inputFormatVersion = parseRestoreTopLevelStringField(record, "inputFormatVersion");
  if (!inputFormatVersion.ok) {
    return inputFormatVersion;
  }
  const inputFormatCompatibility = validateRestoreInputFormatCompatibility(inputFormatVersion.value);
  if (!inputFormatCompatibility.ok) {
    return inputFormatCompatibility;
  }
  const stateHashVersion = parseRestoreStateHashVersion(record);
  if (!stateHashVersion.ok) {
    return stateHashVersion;
  }
  const stateHashCompatibility = validateRestoreStateHashVersionCompatibility(stateHashVersion.value);
  if (!stateHashCompatibility.ok) {
    return stateHashCompatibility;
  }
  const metadata = Object.freeze({
    ...schemaMetadata.value,
    contentVersion: "",
    inputFormatVersion: inputFormatVersion.value,
    stateHashVersion: stateHashVersion.value,
  });
  const compatibilityMetadata = parseRestoreCompatibilityMetadata(record, metadata);
  if (!compatibilityMetadata.ok) {
    return compatibilityMetadata;
  }
  const contentVersionCompatibility = validateRestoreContentVersionCompatibility(compatibilityMetadata.value.contentVersion, content);
  if (!contentVersionCompatibility.ok) {
    return contentVersionCompatibility;
  }
  const fullMetadata = Object.freeze({
    ...metadata,
    contentVersion: compatibilityMetadata.value.contentVersion,
  });
  const compatibility = validateRestoreContentCompatibility(compatibilityMetadata.value, content);
  if (!compatibility.ok) {
    return compatibility;
  }
  const state = parseRestoreTopLevelState(record, fullMetadata, compatibilityMetadata.value);
  if (!state.ok) {
    return state;
  }
  const prng = validateRestorePrngSnapshot(state.value.prngState);
  if (!prng.ok) {
    return prng;
  }
  const payload = parseRestoreDeterministicPayload(state.value, content);
  if (!payload.ok) {
    return payload;
  }
  const featureStates = restoreFeatureStates(payload.value.enabledFeatureStates, features, Object.freeze({
    definition: content.definition,
    stage: content.stagesById.get(state.value.stageId)!,
    player: content.playersById.get(state.value.playerId)!,
    difficulty: state.value.difficulty,
    expectedTick: state.value.expectedTick,
  }));
  if (!featureStates.ok) {
    return featureStates;
  }
  const serializationMetadata = createRestoreSerializationMetadata(fullMetadata, compatibilityMetadata.value, content);
  const restoredState = createRestoreCommittedState(
    state.value,
    payload.value,
    featureStates.value,
    prng.value,
    serializationMetadata,
    features,
  );
  if (!restoredState.ok) {
    return restoredState;
  }

  return okResult(Object.freeze({
    committedState: restoredState.value.committedState,
    serializationMetadata,
    serializedSnapshot: restoredState.value.serializedSnapshot,
  }));
}

/** restore metadata を StageSession が保持する serialization metadata と同じ形へ変換する。 */
function createRestoreSerializationMetadata(
  versionMetadata: RestoreVersionMetadata,
  compatibilityMetadata: RestoreCompatibilityMetadata,
  content: LoadedContentIndex,
): StageSessionSerializationMetadata {
  return Object.freeze({
    coreVersion: versionMetadata.coreVersion,
    schemaVersion: versionMetadata.schemaVersion,
    contentVersion: versionMetadata.contentVersion,
    inputFormatVersion: SERIALIZED_INPUT_FORMAT_VERSION,
    stateHashVersion: SERIALIZED_STATE_HASH_VERSION,
    enabledFeatures: canonicalizeEnabledFeatures(content.definition.enabledFeatures),
    stageId: compatibilityMetadata.stageId,
    difficulty: compatibilityMetadata.difficulty,
    playerId: compatibilityMetadata.playerId,
  });
}

/** 検証済み restore DTO を session 初期状態へ変換し、既存 serialize 経路で再検証する。 */
function createRestoreCommittedState(
  state: RestoreTopLevelState,
  payload: ValidatedRestoreDeterministicPayload,
  featureStates: readonly CommittedFeatureState[],
  prngState: SerializedPrngState,
  metadata: StageSessionSerializationMetadata,
  features: readonly AnyFeatureModule[],
): CoreResult<Readonly<{
  committedState: CommittedStageState;
  serializedSnapshot: SerializedGameState;
}>> {
  const committedState = toRestoreCommittedStageState(state, payload, featureStates, prngState);
  const committedSnapshot = serializeCommittedStageState(metadata, committedState, features);
  if (!committedSnapshot.ok) {
    return coreError("state.invalidShape", "SerializedGameState deterministic payload cannot be committed");
  }

  return okResult(Object.freeze({
    committedState,
    serializedSnapshot: committedSnapshot.value,
  }));
}

/** 検証済み restore DTO を committed snapshot へ変換する。 */
function toRestoreCommittedStageState(
  state: RestoreTopLevelState,
  payload: ValidatedRestoreDeterministicPayload,
  featureStates: readonly CommittedFeatureState[],
  prngState: SerializedPrngState,
): CommittedStageState {
  return createCommittedStageState({
    activeEntities: payload.activeEntities,
    patternRunners: payload.patternRunners,
    featureStates,
    expectedTick: state.expectedTick,
    nextEntityId: state.nextEntityId,
    pendingEvents: payload.pendingEvents,
    prngState,
    score: payload.score,
    timelineCursor: payload.timelineCursor,
    stageStatus: payload.stageStatus,
  });
}
