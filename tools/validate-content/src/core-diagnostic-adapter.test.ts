import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../tests/fixtures/minimum-game-definition.ts";
import type { ContentSourceIndex } from "./content-source-index.ts";
import { validateContentDefinition } from "./core-diagnostic-adapter.ts";

test("maps Core reference errors to the structured source and referrer id", () => {
  const minimum = createMinimumDefinition();
  const definition = {
    ...minimum,
    content: {
      ...minimum.content,
      players: [{ ...minimum.content.players[0]!, asset: "enemy.missing" }],
      stages: [{
        ...minimum.content.stages[0]!,
        timeline: [{
          ...minimum.content.stages[0]!.timeline[0]!,
          action: {
            ...minimum.content.stages[0]!.timeline[0]!.action,
            enemy: "enemy.missing" as const,
          },
        }],
      }],
    },
  };

  const diagnostics = validateContentDefinition(definition, sourceIndexStub());

  const reference = diagnostics.find((diagnostic) => diagnostic.code === "enemy.notFound");
  assert.deepEqual(reference, {
    kind: "reference",
    code: "enemy.notFound",
    severity: "error",
    message: "Enemy not found: enemy.missing",
    path: "content/stages/stage_01.yaml",
    line: 8,
    column: 16,
    endLine: 8,
    endColumn: 29,
    schemaPath: "content.stages[0].timeline[0].action.enemy",
    referrerId: "stage.stage_01",
    targetId: "enemy.missing",
  });
});

test("maps feature and schema errors to their stable diagnostic kinds", () => {
  const minimum = createMinimumDefinition();
  const featureDefinition = { ...minimum, enabledFeatures: ["bomb"] as const };
  const schemaDefinition = { ...minimum, schemaVersion: "2" };

  const feature = validateContentDefinition(featureDefinition, sourceIndexStub());
  const schema = validateContentDefinition(schemaDefinition, sourceIndexStub());

  assert.equal(feature.every((diagnostic) => diagnostic.kind === "featureGate"), true);
  assert.deepEqual(feature.map((diagnostic) => diagnostic.code), ["feature.unsupported"]);
  assert.deepEqual(schema, [{
    kind: "schema",
    code: "schema.unsupportedVersion",
    severity: "error",
    message: "Unsupported schema version: 2",
    path: "game-definition.yaml",
    line: 1,
    column: 16,
    endLine: 1,
    endColumn: 19,
    schemaPath: "schemaVersion",
    sourceId: "gameDefinition",
  }]);
});

test("maps a later definition schema error by structured referrer context", () => {
  const minimum = createMinimumDefinition();
  const definition = {
    ...minimum,
    content: {
      ...minimum.content,
      players: [
        minimum.content.players[0]!,
        {
          ...minimum.content.players[0]!,
          id: "player.alt",
          movement: { ...minimum.content.players[0]!.movement, speed: -1 },
        },
      ],
    },
  };

  const diagnostics = validateContentDefinition(definition, sourceIndexStub());
  const speed = diagnostics.find((diagnostic) => diagnostic.schemaPath?.endsWith("movement.speed"));

  assert.deepEqual(speed, {
    kind: "schema",
    code: "definition.invalidShape",
    severity: "error",
    message: "player.movement.speed must be a positive number",
    path: "content/players/alt.yaml",
    line: 4,
    column: 10,
    endLine: 4,
    endColumn: 12,
    schemaPath: "content.players[1].movement.speed",
    sourceId: "player.alt",
  });
});

test("preserves original indexes after non-object content and timeline elements", () => {
  const minimum = createMinimumDefinition();
  const definition = {
    ...minimum,
    content: {
      ...minimum.content,
      players: [
        null,
        {
          ...minimum.content.players[0]!,
          id: "player.alt",
          movement: { ...minimum.content.players[0]!.movement, speed: -1 },
        },
      ],
      stages: [{
        ...minimum.content.stages[0]!,
        timeline: [
          null,
          { ...minimum.content.stages[0]!.timeline[0]!, tick: -1 },
        ],
      }],
    },
  };

  const diagnostics = validateContentDefinition(definition, sourceIndexStub());
  const schemaPaths = diagnostics.map((diagnostic) => diagnostic.schemaPath);

  assert.equal(schemaPaths.includes("content.players[0]"), true);
  assert.equal(schemaPaths.includes("content.players[1].movement.speed"), true);
  assert.equal(schemaPaths.includes("content.stages[0].timeline[0]"), true);
  assert.equal(schemaPaths.includes("content.stages[0].timeline[1].tick"), true);
});

test("points feature gate diagnostics at the definition that uses a disabled feature", () => {
  const minimum = createMinimumDefinition();
  const definition = {
    ...minimum,
    content: {
      ...minimum.content,
      enemies: [{ ...minimum.content.enemies[0]!, drops: [{ pickup: "pickup.score_small", count: 1 }] }],
    },
  };

  assert.deepEqual(validateContentDefinition(definition, sourceIndexStub()), [{
    kind: "featureGate",
    code: "feature.disabled",
    severity: "error",
    message: "enemy.drops requires the pickup feature in enabledFeatures",
    sourceId: "enemy.scout",
    schemaPath: "content.enemies[0].drops",
  }]);
});

function sourceIndexStub(): ContentSourceIndex {
  return Object.freeze({
    locateSchemaPath(schemaPath, referrerId) {
      if (referrerId === "stage.stage_01") {
        return Object.freeze({
          span: Object.freeze({
            path: "content/stages/stage_01.yaml",
            line: 8,
            column: 16,
            endLine: 8,
            endColumn: 29,
          }),
          sourceId: referrerId,
          schemaPath,
        });
      }
      if (referrerId === "enemy.scout") {
        return Object.freeze({
          span: Object.freeze({ path: "content/enemies/scout.yaml", line: 7, column: 1, endLine: 7, endColumn: 6 }),
          sourceId: referrerId,
          schemaPath,
        });
      }
      if (referrerId === "player.alt") {
        return Object.freeze({
          span: Object.freeze({
            path: "content/players/alt.yaml",
            line: 4,
            column: 10,
            endLine: 4,
            endColumn: 12,
          }),
          sourceId: referrerId,
          schemaPath,
        });
      }
      return Object.freeze({
        span: Object.freeze({
          path: "game-definition.yaml",
          line: 1,
          column: 16,
          endLine: 1,
          endColumn: 19,
        }),
        sourceId: "gameDefinition",
        schemaPath,
      });
    },
  });
}
