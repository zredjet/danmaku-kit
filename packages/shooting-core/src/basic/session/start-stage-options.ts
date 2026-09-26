import type { StartStageOptions } from "../api-types.ts";
import { isNamespacedId } from "../content/identifier.ts";
import { isKnownDifficulty } from "../content/types.ts";
import type { PlayerId, StageId } from "../content/types.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { asRecord, hasOnlyKeys } from "../shared/guards.ts";
import { deepFreezeClone } from "../shared/immutable.ts";

const MAX_SEED_LENGTH = 128;

/**
 * public API 境界で受け取る stage start option を検証する。
 *
 * `load()` 以外の API も runtime adapter から呼ばれるため、壊れた入力は throw ではなく
 * `CoreResult` の失敗として返す。
 */
export function parseStartStageOptions(value: unknown): CoreResult<StartStageOptions> {
  const record = asRecord(value);
  if (!record) {
    return coreError("startStage.invalidShape", "StartStageOptions must be an object");
  }
  if (!hasOnlyKeys(record, ["stageId", "difficulty", "playerId", "seed"])) {
    return coreError("startStage.invalidShape", "StartStageOptions contains unknown fields");
  }
  if (typeof record.stageId !== "string") {
    return coreError("startStage.invalidShape", "stageId must be a string");
  }
  if (!isNamespacedId(record.stageId, "stage")) {
    return coreError("startStage.invalidShape", "stageId must use the stage.* namespace");
  }
  if (!isKnownDifficulty(record.difficulty)) {
    return coreError("startStage.invalidShape", "difficulty must be normal or hard");
  }
  if (typeof record.seed !== "string") {
    return coreError("startStage.invalidShape", "seed must be a string");
  }
  if (record.seed.trim().length === 0 || record.seed.length > MAX_SEED_LENGTH) {
    return coreError("startStage.invalidShape", `seed must be a non-empty string up to ${MAX_SEED_LENGTH} characters`);
  }
  if (record.playerId !== undefined && typeof record.playerId !== "string") {
    return coreError("startStage.invalidShape", "playerId must be a string when provided");
  }
  if (typeof record.playerId === "string" && !isNamespacedId(record.playerId, "player")) {
    return coreError("startStage.invalidShape", "playerId must use the player.* namespace");
  }
  return okResult(deepFreezeClone({
    stageId: record.stageId as StageId,
    difficulty: record.difficulty,
    playerId: record.playerId as PlayerId | undefined,
    seed: record.seed,
  }));
}
