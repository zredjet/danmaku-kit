// ReplayMetadata の exact field set、readonly 性、互換性 field の型を固定する。

import type { Difficulty, EnabledFeature, PlayerId, ReplayMetadata, StageId } from "@danmaku-kit/core";
import type { AssertTrue, IsExactly } from "../support/type-assertions.ts";

type ExpectedReplayMetadata = Readonly<{
  coreVersion: string;
  schemaVersion: string;
  contentVersion: string;
  inputFormatVersion: string;
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
  enabledFeatures: readonly EnabledFeature[];
  seed: string;
}>;

type ReplayMetadataContractAssertions = readonly [
  AssertTrue<IsExactly<ReplayMetadata, ExpectedReplayMetadata>>,
  AssertTrue<IsExactly<ReplayMetadata["coreVersion"], string>>,
  AssertTrue<IsExactly<ReplayMetadata["schemaVersion"], string>>,
  AssertTrue<IsExactly<ReplayMetadata["contentVersion"], string>>,
  AssertTrue<IsExactly<ReplayMetadata["inputFormatVersion"], string>>,
  AssertTrue<IsExactly<ReplayMetadata["stageId"], StageId>>,
  AssertTrue<IsExactly<ReplayMetadata["difficulty"], Difficulty>>,
  AssertTrue<IsExactly<ReplayMetadata["playerId"], PlayerId>>,
  AssertTrue<IsExactly<ReplayMetadata["enabledFeatures"], readonly EnabledFeature[]>>,
  AssertTrue<IsExactly<ReplayMetadata["seed"], string>>,
  AssertTrue<
    IsExactly<
      Extract<"stateHashVersion" | "inputs" | "runtimeDroppedTicks", keyof ReplayMetadata>,
      never
    >
  >,
];

const replayMetadata: ReplayMetadata = {
  coreVersion: "0.0.0",
  schemaVersion: "1",
  contentVersion: "shooting-sample@content.0",
  inputFormatVersion: "1",
  stageId: "stage.stage_01",
  difficulty: "normal",
  playerId: "player.default",
  enabledFeatures: [],
  seed: "replay-seed",
};
const replayMetadataWithFeatures: ReplayMetadata = {
  ...replayMetadata,
  stageId: "stage.alternate",
  difficulty: "hard",
  playerId: "player.alternate",
  enabledFeatures: ["bomb", "graze"],
};
declare let readonlyReplayMetadata: ReplayMetadata;
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.coreVersion = "different-core";
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.schemaVersion = "different-schema";
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.contentVersion = "different-content";
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.inputFormatVersion = "different-input";
declare const sameStageId: ReplayMetadata["stageId"];
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.stageId = sameStageId;
declare const sameDifficulty: ReplayMetadata["difficulty"];
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.difficulty = sameDifficulty;
declare const samePlayerId: ReplayMetadata["playerId"];
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.playerId = samePlayerId;
declare const sameEnabledFeatures: ReplayMetadata["enabledFeatures"];
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.enabledFeatures = sameEnabledFeatures;
// @ts-expect-error replay metadata feature configuration is immutable.
readonlyReplayMetadata.enabledFeatures.push("bomb");
// @ts-expect-error replay metadata fields are immutable.
readonlyReplayMetadata.seed = "different-seed";
// @ts-expect-error replay metadata requires a string seed.
const invalidReplayMetadataSeed: ReplayMetadata = { ...replayMetadata, seed: 1 };
// @ts-expect-error replay metadata requires a stage.* id.
const invalidReplayMetadataStageId: ReplayMetadata = { ...replayMetadata, stageId: "chapter.stage_01" };
// @ts-expect-error replay metadata requires a declared difficulty.
const invalidReplayMetadataDifficulty: ReplayMetadata = { ...replayMetadata, difficulty: "lunatic" };
// @ts-expect-error replay metadata requires a player.* id.
const invalidReplayMetadataPlayerId: ReplayMetadata = { ...replayMetadata, playerId: "ship.default" };
// @ts-expect-error replay metadata feature names must use the known feature union.
const invalidReplayMetadataFeature: ReplayMetadata = { ...replayMetadata, enabledFeatures: ["unknownFeature"] };
// @ts-expect-error replay metadata does not include snapshot-only hash metadata.
const invalidReplayMetadataHashVersion: ReplayMetadata = { ...replayMetadata, stateHashVersion: 1 };
// @ts-expect-error replay metadata does not include replay input frames.
const invalidReplayMetadataInputs: ReplayMetadata = { ...replayMetadata, inputs: [] };
// @ts-expect-error replay metadata does not include runtime diagnostics.
const invalidReplayMetadataDroppedTicks: ReplayMetadata = { ...replayMetadata, runtimeDroppedTicks: [] };
declare const replayMetadataWithoutCoreVersion: Omit<ReplayMetadata, "coreVersion">;
// @ts-expect-error replay metadata requires coreVersion.
const invalidReplayMetadataWithoutCoreVersion: ReplayMetadata = replayMetadataWithoutCoreVersion;
declare const replayMetadataWithoutSchemaVersion: Omit<ReplayMetadata, "schemaVersion">;
// @ts-expect-error replay metadata requires schemaVersion.
const invalidReplayMetadataWithoutSchemaVersion: ReplayMetadata = replayMetadataWithoutSchemaVersion;
declare const replayMetadataWithoutContentVersion: Omit<ReplayMetadata, "contentVersion">;
// @ts-expect-error replay metadata requires contentVersion.
const invalidReplayMetadataWithoutContentVersion: ReplayMetadata = replayMetadataWithoutContentVersion;
declare const replayMetadataWithoutInputFormatVersion: Omit<ReplayMetadata, "inputFormatVersion">;
// @ts-expect-error replay metadata requires inputFormatVersion.
const invalidReplayMetadataWithoutInputFormatVersion: ReplayMetadata = replayMetadataWithoutInputFormatVersion;
declare const replayMetadataWithoutStageId: Omit<ReplayMetadata, "stageId">;
// @ts-expect-error replay metadata requires stageId.
const invalidReplayMetadataWithoutStageId: ReplayMetadata = replayMetadataWithoutStageId;
declare const replayMetadataWithoutDifficulty: Omit<ReplayMetadata, "difficulty">;
// @ts-expect-error replay metadata requires difficulty.
const invalidReplayMetadataWithoutDifficulty: ReplayMetadata = replayMetadataWithoutDifficulty;
declare const replayMetadataWithoutPlayerId: Omit<ReplayMetadata, "playerId">;
// @ts-expect-error replay metadata requires playerId.
const invalidReplayMetadataWithoutPlayerId: ReplayMetadata = replayMetadataWithoutPlayerId;
declare const replayMetadataWithoutEnabledFeatures: Omit<ReplayMetadata, "enabledFeatures">;
// @ts-expect-error replay metadata requires enabledFeatures.
const invalidReplayMetadataWithoutEnabledFeatures: ReplayMetadata = replayMetadataWithoutEnabledFeatures;
declare const replayMetadataWithoutSeed: Omit<ReplayMetadata, "seed">;
// @ts-expect-error replay metadata requires seed.
const invalidReplayMetadataWithoutSeed: ReplayMetadata = replayMetadataWithoutSeed;

void replayMetadata;
void replayMetadataWithFeatures;
void (undefined as unknown as ReplayMetadataContractAssertions);
void invalidReplayMetadataSeed;
void invalidReplayMetadataStageId;
void invalidReplayMetadataDifficulty;
void invalidReplayMetadataPlayerId;
void invalidReplayMetadataFeature;
void invalidReplayMetadataHashVersion;
void invalidReplayMetadataInputs;
void invalidReplayMetadataDroppedTicks;
void invalidReplayMetadataWithoutCoreVersion;
void invalidReplayMetadataWithoutSchemaVersion;
void invalidReplayMetadataWithoutContentVersion;
void invalidReplayMetadataWithoutInputFormatVersion;
void invalidReplayMetadataWithoutStageId;
void invalidReplayMetadataWithoutDifficulty;
void invalidReplayMetadataWithoutPlayerId;
void invalidReplayMetadataWithoutEnabledFeatures;
void invalidReplayMetadataWithoutSeed;
