import assert from "node:assert/strict";
import test from "node:test";

import { planAssetLoads, resolveAssetLoadResults } from "./asset-loading.ts";
import { resolveAssetUrl } from "./asset-manifest.ts";
import type { AssetManifest, AssetManifestEntry } from "./asset-manifest.ts";

function manifest(assets: Readonly<Record<string, AssetManifestEntry>>): AssetManifest {
  return { version: 1, assets };
}

const sprite = (path: string, extra: Partial<AssetManifestEntry> = {}): AssetManifestEntry => ({
  type: "sprite",
  path,
  required: true,
  usage: "gameplay",
  ...extra,
});

test("joins base-relative paths to the base URL", () => {
  assert.equal(resolveAssetUrl("/", "assets/sprites/player.svg"), "/assets/sprites/player.svg");
  assert.equal(resolveAssetUrl("/danmaku-kit/", "assets/a.svg"), "/danmaku-kit/assets/a.svg");
  assert.equal(resolveAssetUrl("./", "assets/a.png"), "./assets/a.png");
  assert.equal(resolveAssetUrl("/danmaku-kit", "assets/a.png"), "/danmaku-kit/assets/a.png");
});

test("loads sprites as images with SVGs rasterized at the given scale, leaves audio muted and other types unsupported", () => {
  const plan = planAssetLoads(manifest({
    "player.default": sprite("assets/sprites/player.svg"),
    "enemy.scout": sprite("assets/sprites/enemy.PNG"),
    "bgm.stage01": { type: "audio", path: "assets/audio/stage01.ogg", required: false, usage: "audio" },
    "atlas.effects": { type: "atlas", path: "assets/atlas/effects.json", required: false, usage: "decorative" },
  }), "/base/", 3);

  assert.deepEqual(plan.requests, [
    { key: "enemy.scout", url: "/base/assets/sprites/enemy.PNG", format: "image", rasterScale: 1 },
    { key: "player.default", url: "/base/assets/sprites/player.svg", format: "svg", rasterScale: 3 },
  ]);
  assert.deepEqual([...plan.notLoaded], [
    ["atlas.effects", "asset type atlas is not supported yet"],
    ["bgm.stage01", "audio is muted in Phase 2A"],
  ]);
});

test("uses every loaded asset under its own key and skips muted audio", () => {
  const outcome = resolveAssetLoadResults(manifest({
    "player.default": sprite("player.svg"),
    "bgm.stage01": { type: "audio", path: "stage01.ogg", required: true, usage: "audio" },
  }), new Map([["bgm.stage01", "audio is muted in Phase 2A"]]));

  assert.deepEqual(outcome, {
    ok: true,
    loadedKeys: new Map([["player.default", "player.default"]]),
    events: [{ type: "assetLoadSkipped", assetKey: "bgm.stage01", reason: "audio is muted in Phase 2A" }],
  });
});

test("stops the stage when a required or undroppable gameplay asset fails", () => {
  const required = resolveAssetLoadResults(manifest({ "player.default": sprite("player.svg") }), new Map([["player.default", "404"]]));
  const optionalGameplay = resolveAssetLoadResults(
    manifest({ "enemy.scout": sprite("enemy.svg", { required: false }) }),
    new Map([["enemy.scout", "decode error"]]),
  );

  assert.deepEqual(required, { ok: false, events: [{ type: "assetLoadFailed", assetKey: "player.default", reason: "404" }] });
  assert.deepEqual(optionalGameplay, { ok: false, events: [{ type: "assetLoadFailed", assetKey: "enemy.scout", reason: "decode error" }] });
});

test("follows fallback chains to a loaded asset and skips optional decorative sprites", () => {
  const outcome = resolveAssetLoadResults(manifest({
    "sprite.placeholder": sprite("placeholder.svg"),
    "enemy.alt": sprite("alt.svg", { required: false, fallback: "sprite.placeholder" }),
    "enemy.boss": sprite("boss.svg", { required: false, fallback: "enemy.alt" }),
    "sparkle.bg": sprite("sparkle.svg", { required: false, usage: "decorative" }),
    "burst.hit": { type: "effect", path: "burst.json", required: false, usage: "decorative" },
  }), new Map([
    ["enemy.alt", "404"],
    ["enemy.boss", "404"],
    ["sparkle.bg", "timeout"],
    ["burst.hit", "asset type effect is not supported yet"],
  ]));

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.ok && [...outcome.loadedKeys], [
    ["enemy.alt", "sprite.placeholder"],
    ["enemy.boss", "sprite.placeholder"],
    ["sprite.placeholder", "sprite.placeholder"],
  ]);
  assert.deepEqual(outcome.events, [
    { type: "assetLoadFailed", assetKey: "burst.hit", reason: "asset type effect is not supported yet" },
    { type: "assetLoadSkipped", assetKey: "burst.hit", reason: "asset type effect is not supported yet" },
    { type: "assetLoadFailed", assetKey: "enemy.alt", reason: "404" },
    { type: "assetFallbackUsed", assetKey: "enemy.alt", fallbackKey: "sprite.placeholder" },
    { type: "assetLoadFailed", assetKey: "enemy.boss", reason: "404" },
    { type: "assetFallbackUsed", assetKey: "enemy.boss", fallbackKey: "sprite.placeholder" },
    { type: "assetLoadFailed", assetKey: "sparkle.bg", reason: "timeout" },
    { type: "assetLoadSkipped", assetKey: "sparkle.bg", reason: "timeout" },
  ]);
});
