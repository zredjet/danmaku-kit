import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runValidateContentCli, type ValidateContentCliIo } from "./cli.ts";

test("validates a minimum split content tree through the real filesystem adapter", async (context) => {
  const fixture = await createTemporaryContent(context, "enemy.scout");
  const capture = createIoCapture();

  const exitCode = await runValidateContentCli([
    "--game-definition", fixture.gameDefinitionPath,
    "--content-root", fixture.contentRoot,
    "--format", "json",
  ], capture.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(capture.stdout()), {
    schemaVersion: "1",
    contentRoot: fixture.contentRoot,
    ok: true,
    diagnostics: [],
    summary: { errors: 0, warnings: 0, infos: 0 },
  });
  assert.equal(capture.stderr(), "");
});

test("maps a real cross-file reference failure back to its stage scalar", async (context) => {
  const fixture = await createTemporaryContent(context, "enemy.missing");
  const capture = createIoCapture();

  const exitCode = await runValidateContentCli([
    "--game-definition", fixture.gameDefinitionPath,
    "--content-root", fixture.contentRoot,
    "--format", "json",
  ], capture.io);

  assert.equal(exitCode, 1);
  const output = JSON.parse(capture.stdout());
  assert.equal(output.diagnostics.length, 1);
  assert.deepEqual(output.diagnostics[0], {
    kind: "reference",
    code: "enemy.notFound",
    severity: "error",
    message: "Enemy not found: enemy.missing",
    path: path.join(fixture.contentRoot, "stages", "stage_01.yaml"),
    line: 8,
    column: 14,
    endLine: 8,
    endColumn: 27,
    referrerId: "stage.stage_01",
    targetId: "enemy.missing",
    schemaPath: "content.stages[0].timeline[0].action.enemy",
  });
});

test("maps a path segment constraint failure back to the segment scalar", async (context) => {
  const fixture = await createTemporaryContent(context, "enemy.scout");
  await writeFile(path.join(fixture.contentRoot, "paths", "none.yaml"), [
    "id: path.none",
    "version: 1",
    "segments:",
    "  - type: velocity",
    "    duration: 30",
    "    velocity: { x: 0, y: 1 }",
    "  - type: velocity",
    "    duration: 0",
    "    velocity: { x: 0, y: 1 }",
    "",
  ].join("\n"), "utf8");
  const capture = createIoCapture();

  const exitCode = await runValidateContentCli([
    "--game-definition", fixture.gameDefinitionPath,
    "--content-root", fixture.contentRoot,
    "--format", "json",
  ], capture.io);

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(capture.stdout()).diagnostics, [{
    kind: "schema",
    code: "definition.invalidShape",
    severity: "error",
    message: "path.segments[].duration must be a positive integer",
    path: path.join(fixture.contentRoot, "paths", "none.yaml"),
    line: 8,
    column: 15,
    endLine: 8,
    endColumn: 16,
    schemaPath: "content.paths[0].segments[1].duration",
    sourceId: "path.none",
  }]);
});

async function createTemporaryContent(
  context: Readonly<{ after: (callback: () => Promise<void>) => void }>,
  stageEnemyId: string,
): Promise<Readonly<{ gameDefinitionPath: string; contentRoot: string }>> {
  const root = await mkdtemp(path.join(tmpdir(), "validate-content-cli-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const contentRoot = path.join(root, "content");
  const gameDefinitionPath = path.join(root, "game-definition.yaml");
  const directories = ["assets", "players", "stages", "enemies", "bullets", "player-shots", "patterns", "paths"];
  await Promise.all(directories.map((directory) => mkdir(path.join(contentRoot, directory), { recursive: true })));

  const files: Readonly<Record<string, string>> = {
    [gameDefinitionPath]: [
      'schemaVersion: "1"',
      "enabledFeatures: []",
      "defaultPlayerId: player.default",
      "contentVersion: shooting-sample@content.1",
      "",
    ].join("\n"),
    [path.join(contentRoot, "assets", "manifest.yaml")]: [
      "version: 1",
      "assets:",
      "  player.default: { type: sprite, path: player.png, required: true, usage: gameplay }",
      "  enemy.scout: { type: sprite, path: enemy.png, required: true, usage: gameplay }",
      "  bullet.red_small: { type: sprite, path: bullet.png, required: true, usage: gameplay }",
      "  shot.player_basic: { type: sprite, path: shot.png, required: true, usage: gameplay }",
      "",
    ].join("\n"),
    [path.join(contentRoot, "players", "default.yaml")]: [
      "id: player.default",
      "version: 1",
      "asset: player.default",
      "movement: { speed: 4, focusSpeed: 1.8 }",
      "collision: { radius: 3 }",
      "life: { initialLives: 3, invincibleTicksAfterHit: 120 }",
      "shot: { definition: playerShot.basic }",
      "",
    ].join("\n"),
    [path.join(contentRoot, "stages", "stage_01.yaml")]: [
      "id: stage.stage_01",
      "version: 1",
      "difficulties: [normal]",
      "timeline:",
      "  - tick: 60",
      "    action:",
      "      type: spawnEnemy",
      `      enemy: ${stageEnemyId}`,
      "      path: path.none",
      "      pattern: pattern.none",
      "      position: { x: 192, y: -16 }",
      "",
    ].join("\n"),
    [path.join(contentRoot, "enemies", "scout.yaml")]: [
      "id: enemy.scout",
      "version: 1",
      "asset: enemy.scout",
      "collision: { radius: 12 }",
      "hp: 10",
      "score: 100",
      "",
    ].join("\n"),
    [path.join(contentRoot, "bullets", "red_small.yaml")]: [
      "id: bullet.red_small",
      "version: 1",
      "asset: bullet.red_small",
      "collision: { radius: 4 }",
      "",
    ].join("\n"),
    [path.join(contentRoot, "player-shots", "basic.yaml")]: [
      "id: playerShot.basic",
      "version: 1",
      "asset: shot.player_basic",
      "collision: { radius: 5 }",
      "damage: 5",
      "fire: { intervalTicks: 3 }",
      "projectile:",
      "  velocity: { x: 0, y: -8 }",
      "  lifetimeTicks: 3",
      "",
    ].join("\n"),
    [path.join(contentRoot, "patterns", "none.yaml")]: "id: pattern.none\nversion: 1\n",
    [path.join(contentRoot, "paths", "none.yaml")]: "id: path.none\nversion: 1\n",
  };
  await Promise.all(Object.entries(files).map(([filePath, text]) => writeFile(filePath, text, "utf8")));
  return Object.freeze({ gameDefinitionPath, contentRoot });
}

function createIoCapture(): Readonly<{
  io: ValidateContentCliIo;
  stdout: () => string;
  stderr: () => string;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return Object.freeze({
    io: Object.freeze({
      writeStdout(text: string) { stdout.push(text); },
      writeStderr(text: string) { stderr.push(text); },
    }),
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  });
}
