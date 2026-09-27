import assert from "node:assert/strict";
import test from "node:test";

import { toAssetManifest, validateAssetManifestSource } from "./asset-manifest.ts";
import { parseYamlSource } from "./yaml-source.ts";

function validate(yaml: string) {
  const parsed = parseYamlSource("/content/assets/manifest.yaml", yaml);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return assert.fail("expected parsed manifest");
  }
  return validateAssetManifestSource(parsed.source).map((diagnostic) => [
    diagnostic.code,
    diagnostic.line,
    diagnostic.schemaPath,
    diagnostic.message,
  ]);
}

test("accepts manifest entries with every field and fallbacks to the same type", () => {
  assert.deepEqual(validate(`version: 1
assets:
  sprite.placeholder:
    type: sprite
    path: assets/placeholders/sprite.svg
    required: true
    usage: gameplay
  pickup.score:
    type: sprite
    path: assets/pickups/score.svg
    required: false
    usage: decorative
    fallback: sprite.placeholder
    license: CC0-1.0
    author: sample
    source: https://example.invalid/pickup
  bgm.stage01:
    type: audio
    path: assets/audio/stage01.ogg
    required: false
    usage: audio
    fallback: runtime.audio.silence
`), []);
});

test("rejects malformed entries at the offending YAML node", () => {
  assert.deepEqual(validate(`version: 2
title: sample
assets:
  runtime.sprite.blank:
    type: sprite
    path: blank.svg
    required: true
    usage: gameplay
  player.default:
    type: image
    path: /assets/player.svg
    required: "yes"
    usage: hud
    note: draft
  enemy.scout:
    type: sprite
    path: ../enemy.svg
    required: true
    usage: audio
    license: 1
  bgm.stage01:
    type: audio
    path: https://cdn.invalid/stage01.ogg
    required: false
    usage: gameplay
  bullet.red: bullet.svg
`), [
    ["assetManifest.unknownField", 2, "assetManifest.title", "Unknown field at assetManifest.title"],
    ["assetManifest.invalidShape", 1, "assetManifest.version", "asset manifest version must be 1"],
    [
      "assetManifest.invalidShape",
      5,
      "assetManifest.assets[\"runtime.sprite.blank\"]",
      "asset keys starting with runtime. are reserved for runtime built-in assets",
    ],
    ["assetManifest.unknownField", 14, "assetManifest.assets[\"player.default\"].note", "Unknown field at assetManifest.assets[].note"],
    [
      "assetManifest.invalidShape",
      10,
      "assetManifest.assets[\"player.default\"].type",
      "asset type must be one of sprite, atlas, tilemap, audio, particle, effect",
    ],
    [
      "assetManifest.invalidShape",
      11,
      "assetManifest.assets[\"player.default\"].path",
      "asset path must be a base-relative path without a scheme, leading slash, backslash or . / .. segment",
    ],
    ["assetManifest.invalidShape", 12, "assetManifest.assets[\"player.default\"].required", "asset required must be a boolean"],
    [
      "assetManifest.invalidShape",
      13,
      "assetManifest.assets[\"player.default\"].usage",
      "asset usage must be one of gameplay, ui, decorative, audio",
    ],
    [
      "assetManifest.invalidShape",
      17,
      "assetManifest.assets[\"enemy.scout\"].path",
      "asset path must be a base-relative path without a scheme, leading slash, backslash or . / .. segment",
    ],
    [
      "assetManifest.invalidShape",
      19,
      "assetManifest.assets[\"enemy.scout\"].usage",
      "asset usage audio must be used exactly for audio assets",
    ],
    ["assetManifest.invalidShape", 20, "assetManifest.assets[\"enemy.scout\"].license", "asset license must be a string"],
    [
      "assetManifest.invalidShape",
      23,
      "assetManifest.assets[\"bgm.stage01\"].path",
      "asset path must be a base-relative path without a scheme, leading slash, backslash or . / .. segment",
    ],
    [
      "assetManifest.invalidShape",
      25,
      "assetManifest.assets[\"bgm.stage01\"].usage",
      "asset usage audio must be used exactly for audio assets",
    ],
    ["assetManifest.invalidShape", 26, "assetManifest.assets[\"bullet.red\"]", "asset manifest entry must be an object"],
  ]);
});

test("rejects percent-encoded dot segments and separators like their literal forms", () => {
  const paths = ["assets/%2e%2e/secret.svg", "assets/.%2E/secret.svg", "%2e/a.svg", "assets%2f..%2fsecret.svg", "a%5Cb.svg"];
  const yaml = `version: 1
assets:
${paths.map((path, index) => `  sprite.p${index}:
    type: sprite
    path: "${path}"
    required: true
    usage: gameplay
`).join("")}  sprite.ok:
    type: sprite
    path: assets/100%25.svg
    required: true
    usage: gameplay
`;

  assert.deepEqual(validate(yaml).map(([code, , schemaPath]) => [code, schemaPath]), paths.map((_, index) => [
    "assetManifest.invalidShape",
    `assetManifest.assets["sprite.p${index}"].path`,
  ]));
});

test("rejects fallbacks from required assets, to unknown or other-type assets, and in cycles", () => {
  const sprite = (key: string, fallback: string, required = false) => `  ${key}:
    type: sprite
    path: ${key}.svg
    required: ${required}
    usage: decorative
    fallback: ${fallback}
`;
  assert.deepEqual(validate(`version: 1
assets:
${sprite("sprite.a", "sprite.b")}${sprite("sprite.b", "sprite.a")}${sprite("sprite.c", "sprite.missing")}${sprite("sprite.d", "runtime.audio.silence")}${sprite("sprite.e", "sprite.a", true)}`), [
    ["assetManifest.invalidFallback", 20, "assetManifest.assets[\"sprite.c\"].fallback", "asset fallback references an unknown asset: sprite.missing"],
    [
      "assetManifest.invalidFallback",
      26,
      "assetManifest.assets[\"sprite.d\"].fallback",
      "asset fallback must have the same type sprite: runtime.audio.silence",
    ],
    [
      "assetManifest.invalidFallback",
      32,
      "assetManifest.assets[\"sprite.e\"].fallback",
      "asset fallback is only used by required: false assets",
    ],
    [
      "assetManifest.fallbackCycle",
      8,
      "assetManifest.assets[\"sprite.a\"].fallback",
      "asset fallback chain must not form a cycle: sprite.a -> sprite.b -> sprite.a",
    ],
    [
      "assetManifest.fallbackCycle",
      14,
      "assetManifest.assets[\"sprite.b\"].fallback",
      "asset fallback chain must not form a cycle: sprite.b -> sprite.a -> sprite.b",
    ],
  ]);
});

test("projects a validated manifest to frozen plain data with only the known fields", () => {
  const manifest = toAssetManifest({
    version: 1,
    assets: {
      "player.default": { type: "sprite", path: "assets/player.svg", required: true, usage: "gameplay" },
      "pickup.score": { type: "sprite", path: "assets/pickup.svg", required: false, usage: "ui", fallback: "player.default" },
    },
  });

  assert.deepEqual(manifest, {
    version: 1,
    assets: {
      "player.default": { type: "sprite", path: "assets/player.svg", required: true, usage: "gameplay" },
      "pickup.score": { type: "sprite", path: "assets/pickup.svg", required: false, usage: "ui", fallback: "player.default" },
    },
  });
  assert.equal(Object.isFrozen(manifest.assets["pickup.score"]), true);
});
