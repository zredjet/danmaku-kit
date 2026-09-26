import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createShootingCore } from "@shooting-sample/shooting-core";

import { loadValidatedGameDefinition } from "./game-definition-loader.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const minimumPaths = Object.freeze({
  gameDefinitionPath: path.join(repositoryRoot, "fixtures/game-definition.minimum.yaml"),
  contentRoot: path.join(repositoryRoot, "fixtures/content-minimum"),
});

test("returns a freshly assembled game definition that Core loads when validation passes", async () => {
  const first = await loadValidatedGameDefinition(minimumPaths);
  const second = await loadValidatedGameDefinition(minimumPaths);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) {
    return;
  }
  assert.equal(first.runResult.exitCode, 0);
  assert.deepEqual(first.runResult.output.diagnostics, []);
  assert.equal(first.definition.content.version, "shooting-sample@content.1");
  assert.equal("contentVersion" in first.definition, false);
  assert.deepEqual(first.definition.content.assetKeys.keys, [
    "bullet.red_small",
    "enemy.scout",
    "player.default",
    "shot.player_basic",
  ]);
  assert.equal(createShootingCore().load(first.definition).ok, true);
  assert.deepEqual(second.definition, first.definition);
  assert.notEqual(second.definition, first.definition);
});

test("returns validation errors without a definition when content does not pass", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "validate-content-loader-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const contentRoot = path.join(root, "content");
  const gameDefinitionPath = path.join(root, "game-definition.yaml");
  await mkdir(path.join(contentRoot, "assets"), { recursive: true });
  await writeFile(gameDefinitionPath, [
    'schemaVersion: "1"',
    "enabledFeatures: []",
    "defaultPlayerId: player.missing",
    "contentVersion: sample@content.1",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(contentRoot, "assets", "manifest.yaml"), "version: 1\nassets: {}\n", "utf8");

  const result = await loadValidatedGameDefinition({ gameDefinitionPath, contentRoot });

  assert.equal(result.ok, false);
  assert.equal("definition" in result, false);
  assert.equal(result.runResult.exitCode, 1);
  assert.deepEqual(result.runResult.output.diagnostics.map((diagnostic) => diagnostic.code), ["player.defaultNotFound"]);
});

test("reports arguments that are not a pair of path strings as a tool error instead of throwing", async () => {
  const throwingPaths = Object.defineProperty({ contentRoot: "content" }, "gameDefinitionPath", {
    enumerable: true,
    get() {
      throw new Error("getter failure");
    },
  });
  const invalidArguments: unknown[] = [
    undefined,
    null,
    "fixtures/game-definition.minimum.yaml",
    { gameDefinitionPath: 1, contentRoot: "content" },
    throwingPaths,
  ];

  for (const paths of invalidArguments) {
    const result = await loadValidatedGameDefinition(paths as Parameters<typeof loadValidatedGameDefinition>[0]);
    assert.equal(result.ok, false);
    assert.equal(result.runResult.exitCode, 2);
    assert.deepEqual(result.runResult.output.diagnostics.map((diagnostic) => diagnostic.code), ["tool.invalidInput"]);
  }
});

test("reports unreadable sources as a tool error instead of throwing", async () => {
  const result = await loadValidatedGameDefinition({
    ...minimumPaths,
    gameDefinitionPath: path.join(repositoryRoot, "fixtures/missing-game-definition.yaml"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.runResult.exitCode, 2);
  assert.deepEqual(result.runResult.output.diagnostics.map((diagnostic) => diagnostic.code), ["tool.readFailed"]);
});
