import assert from "node:assert/strict";
import test from "node:test";

import type { ReplayMetadata } from "../replay/metadata.ts";
import {
  compareReplayCompatibility,
  toReplayCompatibilitySnapshot,
  validateReplayMetadataForComparison,
} from "./replay-metadata.ts";
import type { ReplayMetadataValidationResult, ValidatedReplayCompatibilityMetadata } from "./replay-metadata.ts";

const validMetadata: ReplayMetadata = Object.freeze({
  coreVersion: "1.2.3-rc.1+build.5",
  schemaVersion: "1",
  contentVersion: "shooting-sample@content.1",
  inputFormatVersion: "1",
  stageId: "stage.stage_01",
  difficulty: "normal",
  playerId: "player.default",
  enabledFeatures: Object.freeze(["bomb", "rank"] as const),
  seed: "replay-seed",
});

test("accepts canonical replay metadata and projects it to a plain snapshot", () => {
  const validated = assertValid(validateReplayMetadataForComparison(validMetadata, "expected"));

  assert.deepEqual(toReplayCompatibilitySnapshot(validated), validMetadata);
  assert.equal(Object.isFrozen(validated), true);
  assert.deepEqual(Object.keys(toReplayCompatibilitySnapshot(validated)), Object.keys(validMetadata));
});

test("rejects replay metadata that is not canonical without reordering it", () => {
  for (const [overrides, field] of [
    [{ enabledFeatures: ["rank", "bomb"] }, "enabledFeatures"],
    [{ enabledFeatures: ["bomb", "bomb"] }, "enabledFeatures"],
    [{ enabledFeatures: ["laser"] }, "enabledFeatures"],
    [{ coreVersion: "core.test" }, "coreVersion"],
    [{ coreVersion: "01.2.3" }, "coreVersion"],
    [{ schemaVersion: "" }, "schemaVersion"],
    [{ stageId: "stage_01" }, "stageId"],
    [{ playerId: "enemy.default" }, "playerId"],
    [{ difficulty: "lunatic" }, "difficulty"],
    [{ seed: 1 }, "seed"],
  ] as const) {
    const result = validateReplayMetadataForComparison({ ...validMetadata, ...overrides }, "actual");
    assert.deepEqual(
      result.ok ? [] : result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.side, diagnostic.field]),
      [["replay.metadataInvalid", "actual", field]],
      field,
    );
  }

  for (const difficulty of ["lunatic", "Normal", 1]) {
    const result = validateReplayMetadataForComparison({ ...validMetadata, difficulty }, "actual");
    assert.deepEqual(
      result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.message),
      ["difficulty must be normal or hard"],
    );
  }

  const { seed: _seed, ...withoutSeed } = validMetadata;
  assert.deepEqual(fieldsOf(validateReplayMetadataForComparison(withoutSeed, "expected")), ["seed"]);
  assert.deepEqual(fieldsOf(validateReplayMetadataForComparison({ ...validMetadata, extra: true }, "expected")), [null]);
  assert.deepEqual(fieldsOf(validateReplayMetadataForComparison(null, "expected")), [null]);
});

test("classifies core version drift by SemVer major and other fields by exact match", () => {
  const expected = assertValid(validateReplayMetadataForComparison(validMetadata, "expected"));
  const actualWith = (overrides: Record<string, unknown>) => assertValid(
    validateReplayMetadataForComparison({ ...validMetadata, ...overrides }, "actual"),
  );

  assert.deepEqual(compareReplayCompatibility(expected, actualWith({})), { errors: [], warnings: [] });
  const sameMajor = compareReplayCompatibility(expected, actualWith({ coreVersion: "1.9.0" }));
  assert.deepEqual(sameMajor.errors, []);
  assert.deepEqual(sameMajor.warnings.map((warning) => [warning.code, warning.severity]), [
    ["replay.coreVersionMismatch", "warning"],
  ]);
  const different = compareReplayCompatibility(
    expected,
    actualWith({ coreVersion: "2.0.0", enabledFeatures: ["bomb"], playerId: "player.alt" }),
  );
  assert.deepEqual(different.errors.map((error) => error.field), ["coreVersion", "playerId", "enabledFeatures"]);
  assert.deepEqual(different.warnings, []);
});

function assertValid(result: ReplayMetadataValidationResult): ValidatedReplayCompatibilityMetadata {
  if (!result.ok) {
    assert.fail(`expected valid replay metadata: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.value;
}

function fieldsOf(result: ReplayMetadataValidationResult): readonly (string | null)[] {
  return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.field);
}
