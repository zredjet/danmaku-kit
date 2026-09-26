import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createShootingCore, type GameDefinition } from "@shooting-sample/shooting-core";
import { loadValidatedGameDefinition } from "@shooting-sample/validate-content";

import {
  GAME_DEFINITION_MODULE_ID,
  createGameDefinitionModule,
  isContentSourceFile,
  listContentSourcePaths,
  sampleTitleContentPlugin,
} from "./content-plugin.ts";

const sampleTitleRoot = fileURLToPath(new URL("../", import.meta.url));
const sampleTitlePaths = Object.freeze({
  gameDefinitionPath: path.join(sampleTitleRoot, "config/game-definition.yaml"),
  contentRoot: path.join(sampleTitleRoot, "content"),
});

test("resolves only the game definition virtual module id", () => {
  const plugin = sampleTitleContentPlugin(sampleTitlePaths);
  const resolveId = plugin.resolveId as (id: string) => string | null;

  assert.equal(resolveId(GAME_DEFINITION_MODULE_ID), `\0${GAME_DEFINITION_MODULE_ID}`);
  assert.equal(resolveId("virtual:sample-title/other"), null);
  assert.equal(resolveId("./game-definition.ts"), null);
});

test("builds a module that default-exports the validated sample title definition", async () => {
  const module = await createGameDefinitionModule(sampleTitlePaths);
  const expected = await loadValidatedGameDefinition(sampleTitlePaths);

  assert.equal(module.ok, true);
  assert.equal(expected.ok, true);
  if (!module.ok || !expected.ok) {
    return;
  }
  assert.equal(module.warning, null);
  const prefix = "export default ";
  assert.equal(module.code.startsWith(prefix), true);
  assert.equal(module.code.endsWith(";\n"), true);
  const definition = JSON.parse(module.code.slice(prefix.length, -";\n".length)) as GameDefinition;
  assert.deepEqual(definition, expected.definition);
  assert.equal(createShootingCore().load(definition).ok, true);
});

test("lists the game definition, the content root and everything under it for build watch mode", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "sample-title-content-watch-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const contentRoot = path.join(root, "content");
  const gameDefinitionPath = path.join(root, "game-definition.yaml");
  await mkdir(path.join(contentRoot, "stages"), { recursive: true });
  await writeFile(path.join(contentRoot, "stages", "stage_01.yaml"), "id: stage.stage_01\n", "utf8");

  assert.deepEqual(await listContentSourcePaths({ gameDefinitionPath, contentRoot }), [
    gameDefinitionPath,
    contentRoot,
    path.join(contentRoot, "stages"),
    path.join(contentRoot, "stages", "stage_01.yaml"),
  ]);
  assert.deepEqual(
    await listContentSourcePaths({ gameDefinitionPath, contentRoot: path.join(root, "missing") }),
    [gameDefinitionPath],
  );
});

test("reports content that fails validation as a human diagnostic error", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "sample-title-content-plugin-"));
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

  const module = await createGameDefinitionModule({ gameDefinitionPath, contentRoot });

  assert.equal(module.ok, false);
  if (module.ok) {
    return;
  }
  assert.match(module.error, /player\.defaultNotFound/);
  assert.match(module.error, /player\.missing/);
});

test("treats the game definition file and files under the content root as content sources", () => {
  const cases: ReadonlyArray<readonly [string, boolean]> = [
    [sampleTitlePaths.gameDefinitionPath, true],
    [path.join(sampleTitlePaths.contentRoot, "stages/stage_01.yaml"), true],
    [path.join(sampleTitlePaths.contentRoot, "assets/manifest.yaml"), true],
    [sampleTitlePaths.contentRoot, false],
    [path.join(sampleTitleRoot, "config/other.yaml"), false],
    [path.join(sampleTitlePaths.contentRoot, "..notes.yaml"), true],
    [path.join(sampleTitleRoot, "content-backup/stages/stage_01.yaml"), false],
    [sampleTitleRoot, false],
    [path.join(sampleTitleRoot, "src/main.ts"), false],
  ];

  assert.deepEqual(
    cases.map(([file]) => isContentSourceFile(sampleTitlePaths, file)),
    cases.map(([, expected]) => expected),
  );
});
