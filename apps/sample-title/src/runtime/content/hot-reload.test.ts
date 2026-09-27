import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "@shooting-sample/shooting-core";

import { createSampleTitleCore, loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import type { AssetManifest } from "../assets/asset-manifest.ts";
import { decideHotReload, type HotReloadContext } from "./hot-reload.ts";

const manifest: AssetManifest = {
  version: 1,
  assets: {
    "enemy.scout": { type: "sprite", path: "assets/sprites/enemy-scout.svg", required: true, usage: "gameplay" },
    "sprite.placeholder": { type: "sprite", path: "assets/sprites/placeholder.svg", required: true, usage: "gameplay" },
  },
};

async function context(): Promise<HotReloadContext> {
  return { core: createSampleTitleCore(), definition: await loadSampleTitleDefinition(), assetManifest: manifest, requestedDifficulty: null };
}

/** sample content の一部を変えた definition。 */
function edit(definition: GameDefinition, change: (content: GameDefinition["content"]) => Partial<GameDefinition["content"]>): GameDefinition {
  return { ...definition, content: { ...definition.content, ...change(definition.content) } };
}

test("shows validation errors and clears them when the content is valid again but unchanged", async () => {
  const current = await context();

  assert.deepEqual(decideHotReload({ kind: "error", message: "schema error" }, current), { type: "showError", message: "schema error" });
  assert.deepEqual(decideHotReload({ kind: "unchanged" }, current), { type: "clearError" });
});

test("restarts the stage with a new loaded game when the gameplay content changes within the loaded views", async () => {
  const current = await context();
  const faster = edit(current.definition, (content) => ({
    enemies: content.enemies.map((enemy) => ({ ...enemy, hp: enemy.hp + 1, score: enemy.score * 2 })),
  }));
  const action = decideHotReload({ kind: "content", definition: faster, assetManifest: manifest }, current);

  assert.equal(action.type, "restartStage");
  if (action.type === "restartStage") {
    assert.equal(action.definition, faster);
    assert.deepEqual(action.content.stage, { stageId: "stage.stage_01", difficulty: "normal" });
    assert.equal(action.content.loadedGame.startStage({ stageId: "stage.stage_01", difficulty: "normal", seed: "s" }).ok, true);
  }
});

test("reloads the page when the content needs other sprites, radii, pools or assets than the loaded ones", async () => {
  const current = await context();
  const reasonOf = (definition: GameDefinition, assetManifest = manifest) => {
    const action = decideHotReload({ kind: "content", definition, assetManifest }, current);
    return action.type === "reloadPage" ? action.reason : action.type;
  };
  const [firstStep] = current.definition.content.stages[0]!.timeline;

  assert.match(reasonOf(edit(current.definition, (content) => ({
    enemies: content.enemies.map((enemy) => ({ ...enemy, asset: "enemy.scout" })),
  }))), /needs other sprites/);
  assert.match(reasonOf(edit(current.definition, (content) => ({
    bullets: content.bullets.map((bullet) => ({ ...bullet, collision: { radius: bullet.collision.radius + 1 } })),
  }))), /changed a collision radius/);
  assert.match(reasonOf(edit(current.definition, (content) => ({
    stages: content.stages.map((stage) => ({ ...stage, timeline: [...stage.timeline, { ...firstStep!, tick: 9_000 }] })),
  }))), /larger view pools for enemy, pickup/);
  assert.match(
    reasonOf(current.definition, { ...manifest, assets: { ...manifest.assets, "enemy.extra": manifest.assets["enemy.scout"]! } }),
    /also changed the asset manifest/,
  );
});

test("reloads changed sprite textures in place and reloads the page for other manifest changes", async () => {
  const current = await context();
  const withAsset = (key: string, change: Record<string, unknown>): AssetManifest => ({
    ...manifest,
    assets: { ...manifest.assets, [key]: { ...manifest.assets[key]!, ...change } as AssetManifest["assets"][string] },
  });

  assert.deepEqual(decideHotReload({ kind: "assets", assetManifest: withAsset("enemy.scout", { path: "assets/sprites/scout-2.svg" }) }, current), {
    type: "reloadTextures",
    assetManifest: withAsset("enemy.scout", { path: "assets/sprites/scout-2.svg" }),
    keys: ["enemy.scout"],
  });
  assert.equal(decideHotReload({ kind: "assets", assetManifest: manifest }, current).type, "clearError");
  assert.equal(decideHotReload({ kind: "assets", assetManifest: withAsset("enemy.scout", { required: false }) }, current).type, "reloadPage");
  const { "sprite.placeholder": _removed, ...withoutPlaceholder } = manifest.assets;
  assert.equal(decideHotReload({ kind: "assets", assetManifest: { ...manifest, assets: withoutPlaceholder } }, current).type, "reloadPage");
});
