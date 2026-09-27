import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "@shooting-sample/shooting-core";

import { loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import { collectDefinitionAssets, resolveDefinitionTextures } from "./definition-assets.ts";
import { planViewPoolCapacities } from "./view-pool-plan.ts";

function withPlayerShot(definition: GameDefinition, lifetimeTicks: number, intervalTicks: number): GameDefinition {
  return {
    ...definition,
    content: {
      ...definition.content,
      playerShots: definition.content.playerShots.map((shot) => ({
        ...shot,
        fire: { intervalTicks },
        projectile: { ...shot.projectile, lifetimeTicks },
      })),
    },
  };
}

test("sizes the sample stage pools from its content and the runtime budget", async () => {
  const definition = await loadSampleTitleDefinition();

  assert.deepEqual(planViewPoolCapacities(definition, "stage.stage_01", "player.default"), {
    ok: true,
    capacities: { player: 1, enemy: 26, enemyBullet: 2_000, playerShot: 21 },
  });
});

test("counts only fireOnSpawn bullets for stages without pattern steps", async () => {
  const definition = await loadSampleTitleDefinition();
  const fireOnSpawnOnly: GameDefinition = {
    ...definition,
    content: {
      ...definition.content,
      patterns: definition.content.patterns.map((pattern) => ({
        id: pattern.id,
        version: pattern.version,
        fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 8 } },
      })),
    },
  };

  assert.deepEqual(planViewPoolCapacities(fireOnSpawnOnly, "stage.stage_01", "player.default"), {
    ok: true,
    capacities: { player: 1, enemy: 26, enemyBullet: 26, playerShot: 21 },
  });
});

test("refuses to start when player shots can outnumber the view budget", async () => {
  const definition = await loadSampleTitleDefinition();

  assert.equal(planViewPoolCapacities(withPlayerShot(definition, 299, 1), "stage.stage_01", "player.default").ok, true);
  assert.deepEqual(planViewPoolCapacities(withPlayerShot(definition, 300, 1), "stage.stage_01", "player.default"), {
    ok: false,
    error: "player shots can reach 301 at once, over the view budget 300",
  });
  assert.equal(planViewPoolCapacities(definition, "stage.missing", "player.default").ok, false);
});

test("maps every entity definition to a loaded texture or names the missing assets", async () => {
  const definition = await loadSampleTitleDefinition();
  const assets = collectDefinitionAssets(definition);

  assert.deepEqual([...assets], [
    ["player.default", "player.default"],
    ["enemy.drone", "enemy.drone"],
    ["enemy.gunship", "enemy.gunship"],
    ["enemy.scout", "enemy.scout"],
    ["bullet.blue_large", "bullet.blue_large"],
    ["bullet.red_small", "bullet.red_small"],
    ["playerShot.basic", "shot.player_basic"],
  ]);
  assert.deepEqual(
    resolveDefinitionTextures(assets, new Map([...assets.values()].map((key) => [key, key === "enemy.scout" ? "sprite.placeholder" : key]))),
    {
      ok: true,
      textures: new Map([
        ["player.default", "player.default"],
        ["enemy.drone", "enemy.drone"],
        ["enemy.gunship", "enemy.gunship"],
        ["enemy.scout", "sprite.placeholder"],
        ["bullet.blue_large", "bullet.blue_large"],
        ["bullet.red_small", "bullet.red_small"],
        ["playerShot.basic", "shot.player_basic"],
      ]),
    },
  );
  assert.deepEqual(resolveDefinitionTextures(assets, new Map([["player.default", "player.default"]])), {
    ok: false,
    missingAssets: ["bullet.blue_large", "bullet.red_small", "enemy.drone", "enemy.gunship", "enemy.scout", "shot.player_basic"],
  });
});
