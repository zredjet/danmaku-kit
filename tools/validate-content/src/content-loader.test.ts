import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadContentSource,
  createNodeContentFileSystem,
  type ContentFileEntry,
  type ContentFileSystem,
} from "./content-loader.ts";

test("assembles split YAML definitions in deterministic UTF-8 file order", async () => {
  const root = path.join("/project", "content");
  const gameDefinitionPath = path.join("/project", "game-definition.yaml");
  const fileSystem = createMemoryFileSystem({
    files: {
      [gameDefinitionPath]: [
        'schemaVersion: "1"',
        "enabledFeatures: []",
        "defaultPlayerId: player.a",
        "contentVersion: sample@content.1",
        "",
      ].join("\n"),
      [path.join(root, "assets", "manifest.yaml")]: [
        "version: 1",
        "assets:",
        "  player.a: { type: sprite, path: a.png, required: true, usage: gameplay }",
        "  player.b: { type: sprite, path: b.png, required: true, usage: gameplay }",
        "",
      ].join("\n"),
      [path.join(root, "players", "b.yaml")]: [
        "id: player.b",
        "asset: player.shared",
        "movement:",
        "  speed: 5",
        "",
      ].join("\n"),
      [path.join(root, "players", "a.yaml")]: [
        "id: player.a",
        "asset: player.shared",
        "movement:",
        "  speed: 4",
        "",
      ].join("\n"),
    },
    directories: {
      [root]: [directory("players"), directory("assets")],
      [path.join(root, "players")]: [file("b.yaml"), file("a.yaml")],
    },
  });

  const result = await loadContentSource(gameDefinitionPath, root, fileSystem);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.definition, {
    schemaVersion: "1",
    enabledFeatures: [],
    defaultPlayerId: "player.a",
    content: {
      version: "sample@content.1",
      assetKeys: { keys: ["player.a", "player.b"] },
      players: [
        { id: "player.a", asset: "player.shared", movement: { speed: 4 } },
        { id: "player.b", asset: "player.shared", movement: { speed: 5 } },
      ],
      stages: [],
      enemies: [],
      bullets: [],
      playerShots: [],
      patterns: [],
      paths: [],
    },
  });
  assert.deepEqual(result.sourceIndex.locateSchemaPath("content.players[1].movement.speed"), {
    span: {
      path: path.join(root, "players", "b.yaml"),
      line: 4,
      column: 10,
      endLine: 4,
      endColumn: 11,
    },
    sourceId: "player.b",
    schemaPath: "content.players[1].movement.speed",
  });
  assert.equal(
    result.sourceIndex.locateSchemaPath("player.movement.speed", "player.b").span.path,
    path.join(root, "players", "b.yaml"),
  );
});

test("prioritizes an indexed schema path when duplicate ids make referrer ids ambiguous", async () => {
  const root = path.join("/project", "content");
  const gameDefinitionPath = path.join("/project", "game-definition.yaml");
  const firstPath = path.join(root, "players", "a.yaml");
  const duplicatePath = path.join(root, "players", "b.yaml");
  const fileSystem = createMemoryFileSystem({
    files: {
      [gameDefinitionPath]: validGameDefinitionYaml(),
      [path.join(root, "assets", "manifest.yaml")]: "version: 1\nassets: {}\n",
      [firstPath]: "id: player.same\n",
      [duplicatePath]: "id: player.same\n",
    },
    directories: {
      [root]: [directory("assets"), directory("players")],
      [path.join(root, "players")]: [file("a.yaml"), file("b.yaml")],
    },
  });

  const result = await loadContentSource(gameDefinitionPath, root, fileSystem);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.sourceIndex.locateSchemaPath("content.players[1].id", "player.same").span.path,
      duplicatePath,
    );
  }
});

test("reports unknown content-root entries as validation diagnostics", async () => {
  const root = path.join("/project", "content");
  const gameDefinitionPath = path.join("/project", "game-definition.yaml");
  const fileSystem = createMemoryFileSystem({
    files: {
      [gameDefinitionPath]: validGameDefinitionYaml(),
      [path.join(root, "assets", "manifest.yaml")]: "version: 1\nassets: {}\n",
    },
    directories: {
      [root]: [directory("assets"), directory("enemise"), directory(".players")],
    },
  });

  const result = await loadContentSource(gameDefinitionPath, root, fileSystem);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "content.unknownEntry").map((diagnostic) => diagnostic.path),
    [path.join(root, "enemise"), path.join(root, ".players")],
  );
});

test("requires the asset manifest without classifying a missing collection directory as an error", async () => {
  const root = path.join("/project", "content");
  const gameDefinitionPath = path.join("/project", "game-definition.yaml");
  const fileSystem = createMemoryFileSystem({
    files: { [gameDefinitionPath]: validGameDefinitionYaml() },
    directories: { [root]: [] },
  });

  const result = await loadContentSource(gameDefinitionPath, root, fileSystem);

  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["content.assetManifestNotFound"]);
});

test("keeps an invalid known root entry as a schema error without reading through it", async () => {
  const root = path.join("/project", "content");
  const gameDefinitionPath = path.join("/project", "game-definition.yaml");
  const fileSystem = createMemoryFileSystem({
    files: { [gameDefinitionPath]: validGameDefinitionYaml() },
    directories: { [root]: [file("assets"), file("players")] },
  });

  const result = await loadContentSource(gameDefinitionPath, root, fileSystem);

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.every((diagnostic) => diagnostic.kind === "schema"), true);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "content.unknownEntry"), true);
});

test("rejects every unsupported collection entry kind through the loader", async () => {
  const root = path.join("/project", "content");
  const gameDefinitionPath = path.join("/project", "game-definition.yaml");
  const playerDirectory = path.join(root, "players");
  const fileSystem = createMemoryFileSystem({
    files: {
      [gameDefinitionPath]: validGameDefinitionYaml(),
      [path.join(root, "assets", "manifest.yaml")]: "version: 1\nassets: {}\n",
    },
    directories: {
      [root]: [directory("assets"), directory("players")],
      [playerDirectory]: [file("legacy.yml"), directory("nested"), other("linked.yaml")],
    },
  });

  const result = await loadContentSource(gameDefinitionPath, root, fileSystem);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path]),
    [
      ["content.unsupportedEntry", path.join(playerDirectory, "legacy.yml")],
      ["content.unsupportedEntry", path.join(playerDirectory, "linked.yaml")],
      ["content.unsupportedEntry", path.join(playerDirectory, "nested")],
    ],
  );
});

test("rejects a collection file whose document root is not one definition object", async () => {
  const root = path.join("/project", "content");
  const gameDefinitionPath = path.join("/project", "game-definition.yaml");
  const playerPath = path.join(root, "players", "invalid.yaml");
  const fileSystem = createMemoryFileSystem({
    files: {
      [gameDefinitionPath]: validGameDefinitionYaml(),
      [path.join(root, "assets", "manifest.yaml")]: "version: 1\nassets: {}\n",
      [playerPath]: "- player.default\n",
    },
    directories: {
      [root]: [directory("assets"), directory("players")],
      [path.join(root, "players")]: [file("invalid.yaml")],
    },
  });

  const result = await loadContentSource(gameDefinitionPath, root, fileSystem);

  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    path: diagnostic.path,
    sourceId: diagnostic.kind === "schema" ? diagnostic.sourceId : undefined,
  })), [{ code: "definition.invalidShape", path: playerPath, sourceId: playerPath }]);
});

test("reads UTF-8 files and classifies directory entries through the Node filesystem adapter", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "validate-content-loader-"));
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(path.join(temporaryRoot, "nested"));
  await writeFile(path.join(temporaryRoot, "definition.yaml"), "id: player.default\n", "utf8");
  const fileSystem = createNodeContentFileSystem();

  assert.equal(
    await fileSystem.readTextFile(path.join(temporaryRoot, "definition.yaml"), 1_024),
    "id: player.default\n",
  );
  assert.deepEqual(
    [...await fileSystem.readDirectory(temporaryRoot)].sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: "definition.yaml", kind: "file" },
      { name: "nested", kind: "directory" },
    ],
  );
  await assert.rejects(
    fileSystem.readTextFile(path.join(temporaryRoot, "definition.yaml"), 4),
    /exceeds the YAML source budget of 4 bytes/,
  );
});

test("reports invalid UTF-8 from the Node adapter as a positioned parse diagnostic", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "validate-content-utf8-"));
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const gameDefinitionPath = path.join(temporaryRoot, "game-definition.yaml");
  await writeFile(gameDefinitionPath, Buffer.concat([
    Buffer.from('schemaVersion: "1"\ncontentVersion: sample@', "utf8"),
    Buffer.from([0xff]),
    Buffer.from("\n", "utf8"),
  ]));

  const result = await loadContentSource(
    gameDefinitionPath,
    path.join(temporaryRoot, "content"),
    createNodeContentFileSystem(),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    path: diagnostic.path,
    line: diagnostic.line,
    column: diagnostic.column,
  })), [{ code: "yaml.parse.invalid_utf8", path: gameDefinitionPath, line: 1, column: 1 }]);
});

function createMemoryFileSystem(input: Readonly<{
  files: Readonly<Record<string, string>>;
  directories: Readonly<Record<string, readonly ContentFileEntry[]>>;
}>): ContentFileSystem {
  return Object.freeze({
    async readTextFile(filePath) {
      if (!Object.hasOwn(input.files, filePath)) {
        throw notFound(filePath);
      }
      return input.files[filePath]!;
    },
    async readDirectory(directoryPath) {
      if (!Object.hasOwn(input.directories, directoryPath)) {
        throw notFound(directoryPath);
      }
      return input.directories[directoryPath]!;
    },
  });
}

function validGameDefinitionYaml(): string {
  return [
    'schemaVersion: "1"',
    "enabledFeatures: []",
    "defaultPlayerId: player.default",
    "contentVersion: sample@content.1",
    "",
  ].join("\n");
}

function directory(name: string): ContentFileEntry {
  return Object.freeze({ name, kind: "directory" });
}

function file(name: string): ContentFileEntry {
  return Object.freeze({ name, kind: "file" });
}

function other(name: string): ContentFileEntry {
  return Object.freeze({ name, kind: "other" });
}

function notFound(target: string): Error & Readonly<{ code: "ENOENT" }> {
  return Object.assign(new Error(`Not found: ${target}`), { code: "ENOENT" as const });
}
