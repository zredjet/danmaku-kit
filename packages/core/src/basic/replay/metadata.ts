import type { Difficulty, EnabledFeature, PlayerId, StageId } from "../content/types.ts";

/**
 * 完全 replay が同一の simulation 文脈かを判定するための公開 metadata。
 *
 * `seed` は `StartStageOptions.seed` に渡して startStage が受理した文字列を、そのまま記録する。
 * Phase 1B では未検証 DTO の公開だけを責務とし、入力列、playback session、runtime diagnostics、
 * runtime validation は replay playback を導入する後続 slice で扱う。version field の文字列形式や
 * `enabledFeatures` の canonical order / 重複禁止はこの型だけでは保証せず、playback 境界で検証する。
 *
 * `enabledFeatures` は `contentVersion` の外にある simulation 構成のため、検証済みの canonical order
 * を記録する。`stateHashVersion` は snapshot 専用の互換性 field なので含めない。
 */
export type ReplayMetadata = Readonly<{
  /** playback 境界で SemVer として検証する Core version。 */
  coreVersion: string;
  /** 完全一致だけを許可する schema epoch。 */
  schemaVersion: string;
  /** title / content pack をまたいで一意な immutable release identity。完全一致だけを許可する。 */
  contentVersion: string;
  /** 完全一致だけを許可する input format epoch。 */
  inputFormatVersion: string;
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
  /** playback 前に既知値、重複、canonical order を検証する未検証 feature 列。 */
  enabledFeatures: readonly EnabledFeature[];
  seed: string;
}>;
