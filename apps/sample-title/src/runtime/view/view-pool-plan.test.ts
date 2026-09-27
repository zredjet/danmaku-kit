import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "@danmaku-kit/core";

import { loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import { collectDefinitionAssets, resolveDefinitionTextures, retargetReloadedTextures } from "./definition-assets.ts";
import { collectCollisionRadii } from "./collision-radii.ts";
import { VIEW_POOL_BUDGET, planPreviewViewPoolCapacities, planViewPoolCapacities } from "./view-pool-plan.ts";

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
    // pickup は drone 18 体が 2 個ずつ落とす 36 個。
    capacities: { player: 1, enemy: 26, enemyBullet: 2_000, playerShot: 21, pickup: 36 },
  });
  // pickup feature が有効でない content の pickup は、定義が残っていても view を作らず texture も要らない。
  const disabled = { ...definition, enabledFeatures: [] };
  const withoutPickups = planViewPoolCapacities(disabled, "stage.stage_01", "player.default");
  assert.equal(withoutPickups.ok && withoutPickups.capacities.pickup, 0);
  assert.equal(collectDefinitionAssets(disabled).has("pickup.score_small"), false);
  assert.equal(collectCollisionRadii(disabled).has("pickup.score_small"), false);
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
    capacities: { player: 1, enemy: 26, enemyBullet: 26, playerShot: 21, pickup: 36 },
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
    ["pickup.score_small", "pickup.score_small"],
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
        ["pickup.score_small", "pickup.score_small"],
      ]),
    },
  );
  assert.deepEqual(resolveDefinitionTextures(assets, new Map([["player.default", "player.default"]])), {
    ok: false,
    missingAssets: [
      "bullet.blue_large",
      "bullet.red_small",
      "enemy.drone",
      "enemy.gunship",
      "enemy.scout",
      "pickup.score_small",
      "shot.player_basic",
    ],
  });
});

test("sizes the preview pools to the runtime budget so that any target fits", async () => {
  const definition = await loadSampleTitleDefinition();
  const stagePlan = planViewPoolCapacities(definition, "stage.stage_01", "player.default");
  assert.ok(stagePlan.ok);

  assert.deepEqual(planPreviewViewPoolCapacities(definition, "stage.stage_01", "player.default"), {
    ok: true,
    capacities: { ...stagePlan.capacities, enemy: VIEW_POOL_BUDGET.enemy, enemyBullet: VIEW_POOL_BUDGET.enemyBullet, pickup: VIEW_POOL_BUDGET.pickup },
  });
  const withoutPickups = { ...definition, enabledFeatures: [] };
  const plan = planPreviewViewPoolCapacities(withoutPickups, "stage.stage_01", "player.default");
  assert.equal(plan.ok && plan.capacities.pickup, 0);
  assert.equal(planPreviewViewPoolCapacities(definition, "stage.missing", "player.default").ok, false);
});

test("points the definitions of a reloaded asset back at its own texture instead of the boot fallback", () => {
  const definitionAssets = new Map([["enemy.scout", "enemy.scout"], ["enemy.drone", "enemy.drone"], ["player.default", "player.default"]]);
  // 起動時に enemy.scout の sprite が読めず、fallback の enemy.drone の texture を使っている。
  const booted = new Map([["enemy.scout", "enemy.drone"], ["enemy.drone", "enemy.drone"], ["player.default", "player.default"]]);

  assert.deepEqual(
    retargetReloadedTextures(booted, definitionAssets, ["enemy.scout"]),
    new Map([["enemy.scout", "enemy.scout"], ["enemy.drone", "enemy.drone"], ["player.default", "player.default"]]),
  );
  // 読み直していない asset を使う definition は、fallback を含めてそのまま。
  assert.deepEqual(retargetReloadedTextures(booted, definitionAssets, ["player.default"]), booted);
});
