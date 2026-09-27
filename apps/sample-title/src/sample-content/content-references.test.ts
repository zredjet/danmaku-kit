import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { PatternDefinition } from "@shooting-sample/shooting-core";
import { loadValidatedGameDefinition } from "@shooting-sample/validate-content";

import { loadSampleTitleDefinition } from "../test-support/sample-title-game.ts";

const sampleTitleRoot = fileURLToPath(new URL("../../", import.meta.url));

test("validates the sample content without diagnostics", async () => {
  const loaded = await loadValidatedGameDefinition({
    gameDefinitionPath: path.join(sampleTitleRoot, "config/game-definition.yaml"),
    contentRoot: path.join(sampleTitleRoot, "content"),
  });

  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.runResult.output.diagnostics, []);
});

test("reaches every definition and asset from stage 1 and the default player", async () => {
  const { content, defaultPlayerId } = await loadSampleTitleDefinition();
  const timeline = content.stages.flatMap((stage) => stage.timeline.map((step) => step.action));
  const patterns = content.patterns.filter((pattern) => timeline.some((action) => action.pattern === pattern.id));
  const player = content.players.find((candidate) => candidate.id === defaultPlayerId)!;
  const used = {
    stages: ["stage.stage_01"],
    enemies: timeline.map((action) => action.enemy),
    paths: timeline.map((action) => action.path),
    patterns: patterns.map((pattern) => pattern.id),
    bullets: patterns.flatMap((pattern) => [
      ...firedBullets(pattern.steps ?? []),
      ...(pattern.fireOnSpawn ? [pattern.fireOnSpawn.bullet] : []),
    ]),
    players: [defaultPlayerId],
    playerShots: [player.shot.definition],
  };
  const unused = Object.fromEntries(Object.entries(used).map(([collection, ids]) => [
    collection,
    content[collection as keyof typeof used].map((definition) => definition.id).filter((id) => !(ids as readonly string[]).includes(id)),
  ]));
  const enemies = content.enemies.filter((enemy) => used.enemies.includes(enemy.id));
  const droppedPickups = enemies.flatMap((enemy) => (enemy.drops ?? []).map((drop) => drop.pickup));
  const pickups = content.features?.pickups ?? [];
  const definitions = [...content.players, ...content.enemies, ...content.bullets, ...content.playerShots, ...pickups];

  assert.deepEqual(unused, { stages: [], enemies: [], paths: [], patterns: [], bullets: [], players: [], playerShots: [] });
  assert.deepEqual(pickups.map((pickup) => pickup.id).filter((id) => !droppedPickups.includes(id)), []);
  assert.deepEqual(
    content.assetKeys.keys.filter((key) => !definitions.some((definition) => definition.asset === key)),
    [],
  );
});

/** pattern の `fire` が撃つ bullet の id。`repeat` と `if` の中の step までたどる。 */
function firedBullets(steps: NonNullable<PatternDefinition["steps"]>): string[] {
  return steps.flatMap((step) => {
    if ("fire" in step) {
      return [step.fire.bullet];
    }
    if ("repeat" in step) {
      return firedBullets(step.repeat.steps);
    }
    return "if" in step ? [...firedBullets(step.if.then), ...firedBullets(step.if.else ?? [])] : [];
  });
}

/** content の 1 file の最初の `search` を `replace` に置き換えた copy を検証し、diagnostic の要点を返す。 */
async function validateWithEdit(file: string, search: string, replace: string) {
  const root = await mkdtemp(path.join(tmpdir(), "sample-title-content-"));
  try {
    await cp(path.join(sampleTitleRoot, "config"), path.join(root, "config"), { recursive: true });
    await cp(path.join(sampleTitleRoot, "content"), path.join(root, "content"), { recursive: true });
    const target = path.join(root, "content", file);
    const source = await readFile(target, "utf8");
    assert.ok(source.includes(search), `${file} must contain ${search}`);
    await writeFile(target, source.replace(search, replace));
    const loaded = await loadValidatedGameDefinition({
      gameDefinitionPath: path.join(root, "config/game-definition.yaml"),
      contentRoot: path.join(root, "content"),
    });
    assert.equal(loaded.ok, false);
    return loaded.runResult.output.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      path: "path" in diagnostic ? path.relative(path.join(root, "content"), diagnostic.path) : undefined,
      target: "targetId" in diagnostic ? diagnostic.targetId : undefined,
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("reports each broken reference of the sample stage at the referring file", async () => {
  const cases = [
    ["stages/stage_01.yaml", "enemy: enemy.drone", "enemy: enemy.missing", "enemy.notFound", "enemy.missing"],
    ["stages/stage_01.yaml", "path: path.drone_dive", "path: path.missing", "path.notFound", "path.missing"],
    ["stages/stage_01.yaml", "pattern: pattern.drone_aimed_shot", "pattern: pattern.missing", "pattern.notFound", "pattern.missing"],
    ["patterns/drone_aimed_shot.yaml", "bullet: bullet.red_small", "bullet: bullet.missing", "bullet.notFound", "bullet.missing"],
    ["enemies/drone.yaml", "asset: enemy.drone", "asset: enemy.missing_sprite", "asset.notFound", "enemy.missing_sprite"],
    ["players/default.yaml", "definition: playerShot.basic", "definition: playerShot.missing", "playerShot.notFound", "playerShot.missing"],
  ] as const;

  for (const [file, search, replace, code, target] of cases) {
    assert.deepEqual(await validateWithEdit(file, search, replace), [{ code, path: file, target }], `${file}: ${replace}`);
  }
});
