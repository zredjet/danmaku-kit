import { KNOWN_ENABLED_FEATURES } from "../content/types.ts";
import type { Difficulty, EnabledFeature, PlayerId, StageId } from "../content/types.ts";

/** serialized snapshot / replay が記録する input format の version。 */
export const SERIALIZED_INPUT_FORMAT_VERSION = "1";
/** state hash byte stream の version。serialized snapshot の互換性判定にも使う。 */
export const SERIALIZED_STATE_HASH_VERSION = 2;

/**
 * serialize / restore compatibility 判定に必要な session metadata。
 *
 * tick state だけからは `difficulty` や content / input format version を復元できないため、
 * startStage の時点で確定した値を session context に保持する。
 */
export type StageSessionSerializationMetadata = Readonly<{
  coreVersion: string;
  schemaVersion: string;
  contentVersion: string;
  inputFormatVersion: typeof SERIALIZED_INPUT_FORMAT_VERSION;
  stateHashVersion: typeof SERIALIZED_STATE_HASH_VERSION;
  enabledFeatures: readonly EnabledFeature[];
  stageId: StageId;
  difficulty: Difficulty;
  playerId: PlayerId;
}>;

/** optional feature set を snapshot / hash 用の安定順に並べる。 */
export function canonicalizeEnabledFeatures(features: readonly EnabledFeature[]): readonly EnabledFeature[] {
  return Object.freeze(KNOWN_ENABLED_FEATURES.filter((feature) => features.includes(feature)));
}
