import type { LoadedContentIndex } from "../../content/content-index.ts";
import { isNamespacedId } from "../../content/identifier.ts";
import { KNOWN_ENABLED_FEATURES } from "../../content/types.ts";
import type { Difficulty, PlayerId, StageId } from "../../content/types.ts";
import { asRecord, hasOnlyKeys, isPlainObjectContainer } from "../../internal/guards.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { MAX_RESTORABLE_NEXT_ENTITY_ID } from "../../simulation/entity-id-budget.ts";
import {
  SERIALIZED_INPUT_FORMAT_VERSION,
  SERIALIZED_STATE_HASH_VERSION,
  canonicalizeEnabledFeatures,
} from "../metadata.ts";
import type { SerializedGameState } from "../types.ts";
import { MAX_RESTORE_TOP_LEVEL_STRING_LENGTH, cloneRestoreArray, isRestoreTopLevelString } from "./plain-data.ts";

const RESTORE_TOP_LEVEL_KEY_MAP = Object.freeze({
  coreVersion: true,
  schemaVersion: true,
  contentVersion: true,
  inputFormatVersion: true,
  stateHashVersion: true,
  enabledFeatures: true,
  stageId: true,
  difficulty: true,
  playerId: true,
  expectedTick: true,
  nextEntityId: true,
  prngState: true,
  state: true,
} satisfies Record<keyof SerializedGameState, true>);

const RESTORE_TOP_LEVEL_KEYS = Object.freeze(Object.keys(RESTORE_TOP_LEVEL_KEY_MAP)) as readonly (keyof SerializedGameState)[];

type RestoreTopLevelField = typeof RESTORE_TOP_LEVEL_KEYS[number];

type RestoreSchemaMetadata = Pick<SerializedGameState, "coreVersion" | "schemaVersion">;

export type RestoreVersionMetadata = Pick<
  SerializedGameState,
  "coreVersion" | "schemaVersion" | "contentVersion" | "inputFormatVersion" | "stateHashVersion"
>;

export type RestoreCompatibilityMetadata = Readonly<RestoreVersionMetadata & {
  enabledFeatures: readonly string[];
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
}>;

/**
 * 復元互換性を判定する top-level serialized state。
 *
 * `enabledFeatures` は将来 feature 名を `state.featureMismatch` に分類できるよう、
 * shape guard では string array までに留める。
 */
export type RestoreTopLevelState = Readonly<
  Omit<Pick<SerializedGameState, RestoreTopLevelField>, "enabledFeatures" | "prngState" | "state"> & {
    enabledFeatures: readonly string[];
    prngState: unknown;
    state: unknown;
  }
>;

const MAX_RESTORE_ENABLED_FEATURES_LENGTH = 64;

/** core / schema mismatch を現行 schema の key set より先に分類するための metadata だけを読む。 */
export function parseRestoreSchemaMetadata(value: unknown): CoreResult<RestoreSchemaMetadata> {
  const coreVersion = readRestoreTopLevelDataProperty(value, "coreVersion");
  if (!coreVersion.ok) {
    return coreVersion;
  }
  if (!isRestoreTopLevelString(coreVersion.value)) {
    return coreError("state.invalidShape", "coreVersion must be a string");
  }

  const schemaVersion = readRestoreTopLevelDataProperty(value, "schemaVersion");
  if (!schemaVersion.ok) {
    return schemaVersion;
  }
  if (!isRestoreTopLevelString(schemaVersion.value)) {
    return coreError("state.invalidShape", "schemaVersion must be a string");
  }

  return okResult(Object.freeze({
    coreVersion: coreVersion.value,
    schemaVersion: schemaVersion.value,
  }));
}

/**
 * restore の early compatibility check 用に top-level data property だけを読む。
 *
 * schema mismatch を未知 field や deep payload shape より先に返したい一方で、
 * getter / Proxy を発火させて public API 境界から例外を漏らさないための helper。
 */
function readRestoreTopLevelDataProperty(value: unknown, key: RestoreTopLevelField): CoreResult<unknown> {
  try {
    if (!isPlainObjectContainer(value)) {
      return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      return coreError("state.invalidShape", `${key} must be provided`);
    }
    if (!("value" in descriptor) || !descriptor.enumerable) {
      return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }

    return okResult(descriptor.value);
  } catch {
    return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
  }
}

/** core / schema mismatch は現行 schema の key set や詳細 shape より先に分類する。 */
export function validateRestoreSchemaCompatibility(
  state: RestoreSchemaMetadata,
  content: LoadedContentIndex,
  coreVersion: string,
): CoreResult<null> {
  if (state.coreVersion !== coreVersion) {
    return coreError("state.coreVersionMismatch", `coreVersion mismatch: expected ${coreVersion}, got ${state.coreVersion}`);
  }
  if (state.schemaVersion !== content.definition.schemaVersion) {
    return coreError("state.schemaVersionMismatch", `schemaVersion mismatch: expected ${content.definition.schemaVersion}, got ${state.schemaVersion}`);
  }

  return okResult(null);
}

/** top-level string metadata を field 単位で読む。 */
export function parseRestoreTopLevelStringField(
  record: Record<string, unknown>,
  key: keyof Pick<SerializedGameState, "contentVersion" | "inputFormatVersion" | "stageId" | "playerId">,
): CoreResult<string> {
  if (!isRestoreTopLevelString(record[key])) {
    return coreError("state.invalidShape", `${key} must be a string`);
  }

  return okResult(record[key]);
}

/** input format mismatch は現行 schema の key set や後続 metadata より先に分類する。 */
export function validateRestoreInputFormatCompatibility(inputFormatVersion: string): CoreResult<null> {
  if (inputFormatVersion !== SERIALIZED_INPUT_FORMAT_VERSION) {
    return coreError("state.inputFormatVersionMismatch", `inputFormatVersion mismatch: expected ${SERIALIZED_INPUT_FORMAT_VERSION}, got ${inputFormatVersion}`);
  }

  return okResult(null);
}

/** state hash version を field 単位で読む。 */
export function parseRestoreStateHashVersion(record: Record<string, unknown>): CoreResult<number> {
  if (typeof record.stateHashVersion !== "number" || !Number.isSafeInteger(record.stateHashVersion)) {
    return coreError("state.invalidShape", "stateHashVersion must be a safe integer");
  }

  return okResult(record.stateHashVersion);
}

/** state hash version mismatch は現行 schema の key set や後続 metadata より先に分類する。 */
export function validateRestoreStateHashVersionCompatibility(stateHashVersion: number): CoreResult<null> {
  if (stateHashVersion !== SERIALIZED_STATE_HASH_VERSION) {
    return coreError("state.stateHashVersionMismatch", `stateHashVersion mismatch: expected ${SERIALIZED_STATE_HASH_VERSION}, got ${stateHashVersion}`);
  }

  return okResult(null);
}

/** content / feature mismatch を payload container shape より先に分類するための metadata を読む。 */
export function parseRestoreCompatibilityMetadata(
  record: Record<string, unknown>,
  metadata: RestoreVersionMetadata,
): CoreResult<RestoreCompatibilityMetadata> {
  const contentVersion = parseRestoreTopLevelStringField(record, "contentVersion");
  if (!contentVersion.ok) {
    return contentVersion;
  }
  const enabledFeatures = parseRestoreEnabledFeatures(record.enabledFeatures);
  if (!enabledFeatures.ok) {
    return enabledFeatures;
  }
  const featureContract = validateRestoreEnabledFeatureContract(enabledFeatures.value);
  if (!featureContract.ok) {
    return featureContract;
  }
  const stageId = parseRestoreTopLevelStringField(record, "stageId");
  if (!stageId.ok) {
    return stageId;
  }
  if (!isNamespacedId(stageId.value, "stage")) {
    return coreError("state.invalidShape", "stageId must use the stage.* namespace");
  }
  if (record.difficulty !== "normal" && record.difficulty !== "hard") {
    return coreError("state.invalidShape", "difficulty must be normal or hard");
  }
  const playerId = parseRestoreTopLevelStringField(record, "playerId");
  if (!playerId.ok) {
    return playerId;
  }
  if (!isNamespacedId(playerId.value, "player")) {
    return coreError("state.invalidShape", "playerId must use the player.* namespace");
  }

  return okResult(Object.freeze({
    ...metadata,
    contentVersion: contentVersion.value,
    enabledFeatures: enabledFeatures.value,
    stageId: stageId.value as StageId,
    difficulty: record.difficulty,
    playerId: playerId.value as PlayerId,
  }));
}

/** enabledFeatures だけは top-level metadata として one-level の dense string array に clone / freeze する。 */
function parseRestoreEnabledFeatures(value: unknown): CoreResult<readonly string[]> {
  const denseFeatures = cloneRestoreArray(value, "enabledFeatures", MAX_RESTORE_ENABLED_FEATURES_LENGTH);
  if (!denseFeatures.ok) {
    return coreError("state.invalidShape", "enabledFeatures must be an array of strings");
  }
  const clone: string[] = [];
  for (const feature of denseFeatures.value) {
    if (typeof feature !== "string" || feature.length > MAX_RESTORE_TOP_LEVEL_STRING_LENGTH) {
      return coreError("state.invalidShape", "enabledFeatures must be an array of strings");
    }
    clone.push(feature);
  }

  return okResult(Object.freeze(clone));
}

/** enabledFeatures の canonical order / duplicate だけを shape contract として検査する。 */
function validateRestoreEnabledFeatureContract(features: readonly string[]): CoreResult<null> {
  const seen = new Set<string>();
  let previousKnownIndex = -1;
  for (const feature of features) {
    if (seen.has(feature)) {
      return coreError("state.invalidShape", "enabledFeatures must use canonical order without duplicates");
    }
    seen.add(feature);
    const knownIndex = (KNOWN_ENABLED_FEATURES as readonly string[]).indexOf(feature);
    if (knownIndex === -1) {
      continue;
    }
    if (knownIndex <= previousKnownIndex) {
      return coreError("state.invalidShape", "enabledFeatures must use canonical order without duplicates");
    }
    previousKnownIndex = knownIndex;
  }

  return okResult(null);
}

/** content version mismatch は deterministic payload container shape より先に分類する。 */
export function validateRestoreContentVersionCompatibility(
  contentVersion: string,
  content: LoadedContentIndex,
): CoreResult<null> {
  if (contentVersion !== content.definition.content.version) {
    return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }

  return okResult(null);
}

/** public error に閉じ込める current schema の content 互換性を検査する。 */
export function validateRestoreContentCompatibility(
  state: RestoreCompatibilityMetadata,
  content: LoadedContentIndex,
): CoreResult<null> {
  if (!content.stagesById.has(state.stageId)
    || !content.playersById.has(state.playerId)
    || !content.stagesById.get(state.stageId)!.difficulties.includes(state.difficulty)
  ) {
    return coreError("state.contentMismatch", "serialized content metadata does not match the loaded content");
  }
  const enabledFeatures = canonicalizeEnabledFeatures(content.definition.enabledFeatures);
  if (!sameOrderedValues(state.enabledFeatures, enabledFeatures)) {
    return coreError("state.featureMismatch", "enabledFeatures do not match the loaded content");
  }

  return okResult(null);
}

/** feature list など、順序まで contract の一部である配列を比較する。 */
function sameOrderedValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** 現行 schema の top-level metadata と deterministic payload container の最小 shape を検証する。 */
export function parseRestoreTopLevelState(
  value: unknown,
  metadata: RestoreVersionMetadata,
  compatibilityMetadata: RestoreCompatibilityMetadata,
): CoreResult<RestoreTopLevelState> {
  const record = asRecord(value);
  if (!record) {
    return coreError("state.invalidShape", "SerializedGameState must be an object");
  }
  if (!hasOnlyKeys(record, RESTORE_TOP_LEVEL_KEYS)) {
    return coreError("state.invalidShape", "SerializedGameState contains unknown top-level fields");
  }
  if (typeof record.expectedTick !== "number" || !Number.isSafeInteger(record.expectedTick) || record.expectedTick < 0) {
    return coreError("state.invalidShape", "expectedTick must be a non-negative safe integer");
  }
  if (
    typeof record.nextEntityId !== "number"
    || !Number.isSafeInteger(record.nextEntityId)
    || record.nextEntityId < 1
    || record.nextEntityId > MAX_RESTORABLE_NEXT_ENTITY_ID
  ) {
    return coreError("state.invalidShape", "nextEntityId must be a positive safe integer");
  }
  if (!isPlainObjectContainer(record.prngState)) {
    return coreError("state.invalidShape", "prngState must be an object");
  }
  if (!isPlainObjectContainer(record.state)) {
    return coreError("state.invalidShape", "state must be an object");
  }

  return okResult(Object.freeze({
    ...metadata,
    enabledFeatures: compatibilityMetadata.enabledFeatures,
    stageId: compatibilityMetadata.stageId,
    difficulty: compatibilityMetadata.difficulty,
    playerId: compatibilityMetadata.playerId,
    expectedTick: record.expectedTick,
    nextEntityId: record.nextEntityId,
    prngState: record.prngState,
    state: record.state,
  }));
}
