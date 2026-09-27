import assert from "node:assert/strict";
import test from "node:test";

import type { GameDefinition } from "@danmaku-kit/core";

import { createSampleTitleCore, loadSampleTitleDefinition } from "../../test-support/sample-title-game.ts";
import type { AssetManifest } from "../assets/asset-manifest.ts";
import { planViewPoolCapacities } from "../view/view-pool-plan.ts";
import { decideHotReload, type HotReloadContext } from "./hot-reload.ts";

const manifest: AssetManifest = {
  version: 1,
  assets: {
    "enemy.scout": { type: "sprite", path: "assets/sprites/enemy-scout.svg", required: true, usage: "gameplay" },
    "sprite.placeholder": { type: "sprite", path: "assets/sprites/placeholder.svg", required: true, usage: "gameplay" },
  },
};

async function context(change: Partial<HotReloadContext> = {}): Promise<HotReloadContext> {
  const definition = await loadSampleTitleDefinition();
  const plan = planViewPoolCapacities(definition, "stage.stage_01", definition.defaultPlayerId);
  assert.ok(plan.ok);
  return {
    core: createSampleTitleCore(),
    definition,
    assetManifest: manifest,
    viewPoolCapacities: plan.capacities,
    requestedDifficulty: null,
    halted: false,
    ...change,
  };
}

/** sample content の一部を変えた definition。 */
function edit(definition: GameDefinition, change: (content: GameDefinition["content"]) => Partial<GameDefinition["content"]>): GameDefinition {
  return { ...definition, content: { ...definition.content, ...change(definition.content) } };
}

/** object の key の順を逆にした copy（JSON としては同じ content）。 */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reverseKeys) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys((value as Record<string, unknown>)[key])])) as T;
  }
  return value;
}

test("shows validation errors and treats content with only reordered keys as unchanged", async () => {
  const current = await context();

  assert.deepEqual(decideHotReload({ kind: "error", message: "schema error" }, current), { type: "showError", message: "schema error" });
  assert.deepEqual(decideHotReload({
    kind: "validated",
    definition: reverseKeys(current.definition),
    assetManifest: reverseKeys(manifest),
  }, current), { type: "clearError" });
});

test("restarts the stage with a new loaded game when the gameplay content changes within the loaded views", async () => {
  const current = await context();
  const harder = edit(current.definition, (content) => ({
    enemies: content.enemies.map((enemy) => ({ ...enemy, hp: enemy.hp + 1, score: enemy.score * 2 })),
  }));
  const action = decideHotReload({ kind: "validated", definition: harder, assetManifest: manifest }, current);

  assert.equal(action.type, "restartStage");
  if (action.type === "restartStage") {
    assert.equal(action.definition, harder);
    assert.deepEqual(action.content.stage, { stageId: "stage.stage_01", difficulty: "normal" });
    assert.equal(action.content.loadedGame.startStage({ stageId: "stage.stage_01", difficulty: "normal", seed: "s" }).ok, true);
  }
  // Core の error などで止まった stage は始め直せないので、page を読み込み直す。
  assert.equal(decideHotReload({ kind: "validated", definition: harder, assetManifest: manifest }, await context({ halted: true })).type, "reloadPage");
});

test("reloads the page when the content needs other sprites, radii, pools or assets than the loaded ones", async () => {
  const current = await context();
  const reasonOf = (definition: GameDefinition, assetManifest = manifest) => {
    const action = decideHotReload({ kind: "validated", definition, assetManifest }, current);
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
  const changedDefinition = edit(current.definition, (content) => ({ version: `${content.version}-edited` }));
  assert.match(
    reasonOf(changedDefinition, { ...manifest, assets: { ...manifest.assets, "enemy.extra": manifest.assets["enemy.scout"]! } }),
    /also changed the asset manifest/,
  );
});

test("compares the content with the view pools created at loading, not with the current content's plan", async () => {
  const current = await context();
  const shorter = edit(current.definition, (content) => ({
    stages: content.stages.map((stage) => ({ ...stage, timeline: stage.timeline.slice(1) })),
  }));
  // 一度 wave を減らしてから戻しても、読み込みで作った pool に収まるので page を読み込み直さない。
  assert.equal(decideHotReload({ kind: "validated", definition: current.definition, assetManifest: manifest }, {
    ...current,
    definition: shorter,
  }).type, "restartStage");
});

test("reloads changed sprite textures in place and reloads the page for other manifest changes", async () => {
  const current = await context();
  const withAsset = (key: string, change: Record<string, unknown>): AssetManifest => ({
    ...manifest,
    assets: { ...manifest.assets, [key]: { ...manifest.assets[key]!, ...change } as AssetManifest["assets"][string] },
  });
  const decide = (assetManifest: AssetManifest, change: Partial<HotReloadContext> = {}) => (
    decideHotReload({ kind: "validated", definition: current.definition, assetManifest }, { ...current, ...change })
  );

  assert.deepEqual(decide(withAsset("enemy.scout", { path: "assets/sprites/scout-2.svg" })), {
    type: "reloadTextures",
    assetManifest: withAsset("enemy.scout", { path: "assets/sprites/scout-2.svg" }),
    keys: ["enemy.scout"],
  });
  assert.match(
    (decide(withAsset("enemy.scout", { path: "assets/sprites/scout.png" })) as { reason: string }).reason,
    /changed the image format of enemy\.scout/,
  );
  assert.equal(decide(withAsset("enemy.scout", { required: false })).type, "reloadPage");
  assert.equal(decide(withAsset("enemy.scout", { path: "assets/sprites/scout-2.svg" }), { halted: true }).type, "reloadPage");
  const { "sprite.placeholder": _removed, ...withoutPlaceholder } = manifest.assets;
  assert.equal(decide({ ...manifest, assets: withoutPlaceholder }).type, "reloadPage");
});
