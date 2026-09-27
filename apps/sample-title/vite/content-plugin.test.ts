import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDanmakuCore, type GameDefinition } from "@danmaku-kit/core";
import { pickupFeature } from "@danmaku-kit/core/features/pickup";
import { loadValidatedGameDefinition } from "@danmaku-kit/validate-content";

import {
  GAME_DEFINITION_MODULE_ID,
  createGameDefinitionModule,
  isContentSourceFile,
  listContentSourcePaths,
  loadValidatedContent,
  sampleTitleContentPlugin,
  toContentUpdate,
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

test("builds a module that exports the validated sample title definition and asset manifest", async () => {
  const module = await createGameDefinitionModule(sampleTitlePaths);
  const expected = await loadValidatedGameDefinition(sampleTitlePaths);

  assert.equal(module.ok, true);
  assert.equal(expected.ok, true);
  if (!module.ok || !expected.ok) {
    return;
  }
  assert.equal(module.warning, null);
  const lines = module.code.split("\n");
  const [definitionLine, manifestLine, rest] = [lines[0]!, lines[1]!, lines.slice(2)];
  assert.deepEqual(rest, [""]);
  assert.equal(definitionLine.startsWith("export default ") && definitionLine.endsWith(";"), true);
  assert.equal(manifestLine.startsWith("export const assetManifest = ") && manifestLine.endsWith(";"), true);
  const definition = JSON.parse(definitionLine.slice("export default ".length, -1)) as GameDefinition;
  assert.deepEqual(definition, expected.definition);
  assert.deepEqual(JSON.parse(manifestLine.slice("export const assetManifest = ".length, -1)), expected.assetManifest);
  assert.equal(createDanmakuCore({ features: [pickupFeature] }).load(definition).ok, true);
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

test("sends the validated content or the validation error as the content update", async () => {
  const content = await loadValidatedContent(sampleTitlePaths);
  assert.ok(content.ok);

  assert.deepEqual(toContentUpdate(content), { kind: "validated", definition: content.definition, assetManifest: content.assetManifest });
  assert.deepEqual(toContentUpdate({ ok: false, error: "broken" }), { kind: "error", message: "broken" });
});

test("sends content updates to a loaded page and reloads a page that could not load the content", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "sample-title-plugin-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(sampleTitleRoot, "config"), path.join(root, "config"), { recursive: true });
  await cp(path.join(sampleTitleRoot, "content"), path.join(root, "content"), { recursive: true });
  const paths = { gameDefinitionPath: path.join(root, "config/game-definition.yaml"), contentRoot: path.join(root, "content") };
  const plugin = sampleTitleContentPlugin(paths);
  const sent: unknown[] = [];
  const watcher = new EventEmitter();
  const server = {
    watcher: Object.assign(watcher, { add: () => watcher }),
    config: { logger: { warn: () => undefined, error: () => undefined } },
    environments: {
      client: {
        moduleGraph: { getModuleById: () => undefined, invalidateModule: () => undefined },
        hot: { send: (...message: unknown[]) => sent.push(message.length === 1 ? message[0] : message) },
      },
    },
  };
  (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
  (plugin.configureServer as (server: unknown) => void)(server);
  const load = () => (plugin.load as (this: unknown, id: string) => Promise<unknown>).call({
    error: (message: string) => {
      throw new Error(message);
    },
    warn: () => undefined,
    addWatchFile: () => undefined,
  }, `\0${GAME_DEFINITION_MODULE_ID}`);
  const change = async (file: string, search: string, replace: string) => {
    const target = path.join(paths.contentRoot, file);
    await writeFile(target, (await readFile(target, "utf8")).replace(search, replace));
    const before = sent.length;
    watcher.emit("change", target);
    await waitFor(() => sent.length > before);
    return sent.at(-1);
  };

  await load();
  const broken = await change("enemies/drone.yaml", "hp: 5", "hp: fast") as unknown[];
  assert.equal(broken[0], "sample-title:content-update");
  assert.equal((broken[1] as { kind: string }).kind, "error");
  // 壊れた content のまま page を読み込み直すと module の読み込みが失敗し、直した変更は page の読み込み直しになる。
  await assert.rejects(load());
  assert.deepEqual(await change("enemies/drone.yaml", "hp: fast", "hp: 5"), { type: "full-reload" });
  await load();
  const fixed = await change("enemies/drone.yaml", "score: 50", "score: 70") as unknown[];
  assert.equal((fixed[1] as { kind: string }).kind, "validated");
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(condition(), "the content plugin did not send an update");
}
