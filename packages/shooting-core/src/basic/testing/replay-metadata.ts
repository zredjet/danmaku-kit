import { isNamespacedId } from "../content/identifier.ts";
import { KNOWN_ENABLED_FEATURES } from "../content/types.ts";
import type { Difficulty, EnabledFeature, PlayerId, StageId } from "../content/types.ts";
import { asRecord, hasOnlyKeys } from "../internal/guards.ts";
import { deepFreezePlainData } from "../internal/immutable.ts";
import type { ReplayMetadata } from "../replay/metadata.ts";

const REPLAY_METADATA_FIELDS = Object.freeze([
  "coreVersion",
  "schemaVersion",
  "contentVersion",
  "inputFormatVersion",
  "stageId",
  "difficulty",
  "playerId",
  "enabledFeatures",
  "seed",
] as const satisfies readonly (keyof ReplayMetadata)[]);
const KNOWN_DIFFICULTIES: readonly Difficulty[] = Object.freeze(["normal", "hard"]);
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** replay 比較の前提を満たさない理由。public `CoreErrorCode` を増やさない test-only code を使う。 */
export type ReplayComparisonDiagnostic = Readonly<{
  code: "replay.metadataInvalid" | "replay.incompatible" | "replay.coreVersionMismatch" | "replay.traceInvalid";
  severity: "error" | "warning";
  side: "expected" | "actual" | null;
  field: string | null;
  message: string;
}>;

/** 検証済み metadata を artifact へ残すための plain DTO。field 順は `ReplayMetadata` と同じ。 */
export type ReplayCompatibilitySnapshot = Readonly<{
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

declare const validatedReplayMetadata: unique symbol;

/**
 * 既知 feature、重複なし、canonical order、SemVer の `coreVersion` を検証した metadata。
 *
 * 型だけの brand で、未検証の `ReplayMetadata` を互換性比較へ渡せないようにする。
 */
export type ValidatedReplayCompatibilityMetadata = ReplayCompatibilitySnapshot & Readonly<{
  [validatedReplayMetadata]: true;
}>;

export type ReplayMetadataValidationResult =
  | Readonly<{ ok: true; value: ValidatedReplayCompatibilityMetadata }>
  | Readonly<{ ok: false; diagnostics: readonly ReplayComparisonDiagnostic[] }>;

/** 互換性比較の結果。`errors` が空でなければ state divergence report を作らない。 */
export type ReplayCompatibilityResult = Readonly<{
  errors: readonly ReplayComparisonDiagnostic[];
  warnings: readonly ReplayComparisonDiagnostic[];
}>;

/**
 * 未検証の raw `ReplayMetadata` を、比較できる canonical metadata として検証する。
 *
 * 並べ替えや補完はせず、非 canonical な `enabledFeatures` や未知 field は error にする。
 */
export function validateReplayMetadataForComparison(
  raw: unknown,
  side: "expected" | "actual",
): ReplayMetadataValidationResult {
  const diagnostics: ReplayComparisonDiagnostic[] = [];
  const invalid = (field: string | null, message: string) => {
    diagnostics.push(Object.freeze({ code: "replay.metadataInvalid", severity: "error", side, field, message }));
  };
  const record = asRecord(deepFreezePlainData(raw));
  if (!record) {
    invalid(null, "ReplayMetadata must be a JSON-compatible plain object");
    return Object.freeze({ ok: false, diagnostics: Object.freeze(diagnostics) });
  }
  if (!hasOnlyKeys(record, REPLAY_METADATA_FIELDS)) {
    invalid(null, "ReplayMetadata contains unknown fields");
  }
  for (const field of REPLAY_METADATA_FIELDS) {
    if (record[field] === undefined) {
      invalid(field, `${field} is required`);
    }
  }

  const { coreVersion, schemaVersion, contentVersion, inputFormatVersion, stageId, difficulty, playerId, enabledFeatures, seed } =
    record;
  if (coreVersion !== undefined && (typeof coreVersion !== "string" || !SEMVER_PATTERN.test(coreVersion))) {
    invalid("coreVersion", "coreVersion must be a SemVer string");
  }
  for (const [field, value] of [
    ["schemaVersion", schemaVersion],
    ["contentVersion", contentVersion],
    ["inputFormatVersion", inputFormatVersion],
    ["seed", seed],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
      invalid(field, `${field} must be a non-empty string`);
    }
  }
  if (stageId !== undefined && (typeof stageId !== "string" || !isNamespacedId(stageId, "stage"))) {
    invalid("stageId", "stageId must use the stage.* namespace");
  }
  if (playerId !== undefined && (typeof playerId !== "string" || !isNamespacedId(playerId, "player"))) {
    invalid("playerId", "playerId must use the player.* namespace");
  }
  if (difficulty !== undefined && !KNOWN_DIFFICULTIES.includes(difficulty as Difficulty)) {
    invalid("difficulty", "difficulty must be normal or hard");
  }
  if (enabledFeatures !== undefined) {
    const featureError = findEnabledFeaturesError(enabledFeatures);
    if (featureError) {
      invalid("enabledFeatures", featureError);
    }
  }

  if (diagnostics.length > 0) {
    return Object.freeze({ ok: false, diagnostics: Object.freeze(diagnostics) });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      coreVersion,
      schemaVersion,
      contentVersion,
      inputFormatVersion,
      stageId,
      difficulty,
      playerId,
      enabledFeatures,
      seed,
    }) as ValidatedReplayCompatibilityMetadata,
  });
}

/**
 * 検証済み metadata 同士が同じ replay として比較できるかを判定する。
 *
 * full replay の再生条件に合わせ、`coreVersion` の同一 major 不一致は warning 付きで比較し、
 * major 不一致、他の version field、stage / difficulty / player / feature / seed の不一致は error にする。
 */
export function compareReplayCompatibility(
  expected: ValidatedReplayCompatibilityMetadata,
  actual: ValidatedReplayCompatibilityMetadata,
): ReplayCompatibilityResult {
  const errors: ReplayComparisonDiagnostic[] = [];
  const warnings: ReplayComparisonDiagnostic[] = [];
  if (expected.coreVersion !== actual.coreVersion) {
    const sameMajor = semverMajor(expected.coreVersion) === semverMajor(actual.coreVersion);
    (sameMajor ? warnings : errors).push(Object.freeze({
      code: sameMajor ? "replay.coreVersionMismatch" : "replay.incompatible",
      severity: sameMajor ? "warning" : "error",
      side: null,
      field: "coreVersion",
      message: sameMajor
        ? `coreVersion differs within the same major version: ${expected.coreVersion} != ${actual.coreVersion}`
        : `coreVersion major version differs: ${expected.coreVersion} != ${actual.coreVersion}`,
    }));
  }
  for (const field of REPLAY_METADATA_FIELDS) {
    if (field === "coreVersion") {
      continue;
    }
    const same = field === "enabledFeatures"
      ? expected.enabledFeatures.length === actual.enabledFeatures.length
        && expected.enabledFeatures.every((feature, index) => feature === actual.enabledFeatures[index])
      : expected[field] === actual[field];
    if (!same) {
      errors.push(Object.freeze({
        code: "replay.incompatible",
        severity: "error",
        side: null,
        field,
        message: `${field} must match between expected and actual replays`,
      }));
    }
  }
  return Object.freeze({ errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
}

/** brand を外し、artifact に残す plain DTO へ `ReplayMetadata` と同じ field 順で投影する。 */
export function toReplayCompatibilitySnapshot(
  metadata: ValidatedReplayCompatibilityMetadata,
): ReplayCompatibilitySnapshot {
  return Object.freeze({
    coreVersion: metadata.coreVersion,
    schemaVersion: metadata.schemaVersion,
    contentVersion: metadata.contentVersion,
    inputFormatVersion: metadata.inputFormatVersion,
    stageId: metadata.stageId,
    difficulty: metadata.difficulty,
    playerId: metadata.playerId,
    enabledFeatures: metadata.enabledFeatures,
    seed: metadata.seed,
  });
}

/** `enabledFeatures` が既知 feature だけを重複なく canonical order で持たなければ理由を返す。 */
function findEnabledFeaturesError(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return "enabledFeatures must be an array";
  }
  let previousIndex = -1;
  for (const feature of value) {
    const index = KNOWN_ENABLED_FEATURES.indexOf(feature as EnabledFeature);
    if (index < 0) {
      return `enabledFeatures contains an unknown feature: ${String(feature)}`;
    }
    if (index === previousIndex) {
      return `enabledFeatures contains a duplicate feature: ${String(feature)}`;
    }
    if (index < previousIndex) {
      return "enabledFeatures must be in canonical order";
    }
    previousIndex = index;
  }
  return null;
}

function semverMajor(version: string): string {
  return version.slice(0, version.indexOf("."));
}
