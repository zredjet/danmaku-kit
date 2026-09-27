import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { createShootingCore } from "../../basic/core.ts";
import type { GameDefinition } from "../../basic/content/types.ts";
import { pickupFeature } from "./index.ts";

const scoreSmall = Object.freeze({
  id: "pickup.score_small",
  version: 1,
  asset: "enemy.scout",
  score: 100,
  collectRadius: 10,
  magnetRadius: 80,
  velocity: { x: 0, y: 1.5 },
});

/** pickup を有効にした最小の定義に、pickup と enemy の drops を足す。 */
function pickupDefinition(pickups: unknown, drops?: unknown): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    enabledFeatures: ["pickup"],
    content: {
      ...definition.content,
      enemies: definition.content.enemies.map((enemy) => ({ ...enemy, ...(drops === undefined ? {} : { drops }) })),
      features: { pickups },
    },
  } as unknown as GameDefinition;
}

/** `key` を持たない copy。`undefined` の field は JSON 互換でないため、省略した定義はこれで作る。 */
function without(record: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

function load(definition: GameDefinition) {
  return createShootingCore({ features: [pickupFeature] }).load(definition);
}

function errorsOf(definition: GameDefinition) {
  const loaded = load(definition);
  assert.equal(loaded.ok, false);
  return loaded.ok ? [] : loaded.errors.map((error) => [error.code, error.schemaPath, error.message]);
}

test("loads pickups and enemy drops within their budgets", () => {
  const loaded = load(pickupDefinition(
    [scoreSmall, { ...without(scoreSmall, "magnetRadius"), id: "pickup.score_large", velocity: { x: -8, y: 8 } }],
    [{ pickup: "pickup.score_small", count: 12, spread: 128 }, { pickup: "pickup.score_large", count: 4 }],
  ));

  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.errors));
  assert.deepEqual(loaded.ok && loaded.warnings, []);
  assert.equal(load(pickupDefinition([])).ok, true);
});

test("rejects malformed pickups with their schema paths", () => {
  assert.deepEqual(errorsOf(pickupDefinition([
    { ...scoreSmall, score: -1, collectRadius: 0, magnetRadius: 257, extra: true },
    { ...scoreSmall, id: "pickup.fast", collectRadius: 65, velocity: { x: 8.5, y: "1" } },
    { ...without(scoreSmall, "velocity"), id: "pickup.still", version: 0, asset: "" },
    "pickup.none",
  ])), [
    // 配列の要素の形は、各 pickup の検証より先に報告する（basic の collection と同じ）。
    ["definition.invalidShape", "content.features.pickups[3]", "content.features.pickups must contain objects"],
    ["definition.unknownField", "content.features.pickups[0].extra", "Unknown field at pickup.extra"],
    ["definition.invalidShape", "content.features.pickups[0].score", "pickup.score must be a non-negative integer"],
    ["definition.invalidShape", "content.features.pickups[0].collectRadius", "pickup.collectRadius must be a positive number"],
    ["definition.invalidShape", "content.features.pickups[0].magnetRadius", "pickup.magnetRadius must be less than or equal to 256"],
    ["definition.invalidShape", "content.features.pickups[1].collectRadius", "pickup.collectRadius must be less than or equal to 64"],
    ["definition.invalidShape", "content.features.pickups[1].velocity.x", "pickup.velocity.x must be between -8 and 8"],
    ["definition.invalidShape", "content.features.pickups[1].velocity.y", "pickup.velocity.y must be a finite number"],
    ["definition.invalidShape", "content.features.pickups[2].version", "pickup.version must be a positive integer"],
    ["definition.invalidShape", "content.features.pickups[2].asset", "pickup.asset must be a string"],
    ["definition.invalidShape", "content.features.pickups[2].velocity", "pickup.velocity must be an object"],
  ]);
  assert.deepEqual(errorsOf(pickupDefinition({})), [
    ["definition.invalidShape", "content.features.pickups", "content.features.pickups must be an array"],
  ]);
});

test("rejects malformed enemy drops and drops over the per-enemy budget", () => {
  assert.deepEqual(errorsOf(pickupDefinition([scoreSmall], [
    { pickup: "pickup.score_small", count: 0, spread: -1, offset: 2 },
    { pickup: "", count: 17 },
  ])), [
    ["definition.unknownField", "content.enemies[0].drops[0].offset", "Unknown field at enemy.drops[0].offset"],
    ["definition.invalidShape", "content.enemies[0].drops[0].count", "enemy.drops[0].count must be a positive integer"],
    ["definition.invalidShape", "content.enemies[0].drops[0].spread", "enemy.drops[0].spread must be a non-negative number"],
    ["definition.invalidShape", "content.enemies[0].drops[1].pickup", "enemy.drops[1].pickup must be a string"],
    ["definition.invalidShape", "content.enemies[0].drops[1].count", "enemy.drops[1].count must be at most 16"],
    ["definition.invalidConstraint", "content.enemies[0].drops", "enemy.drops must drop at most 16 pickups in total"],
  ]);
  assert.deepEqual(errorsOf(pickupDefinition([scoreSmall], [])).map(([, schemaPath, message]) => [schemaPath, message]), [
    ["content.enemies[0].drops", "enemy.drops must contain at least 1 drop"],
  ]);
  assert.deepEqual(errorsOf(pickupDefinition([scoreSmall], [
    { pickup: "pickup.score_small", count: 9 },
    { pickup: "pickup.score_small", count: 8 },
  ])).map(([code]) => code), ["definition.invalidConstraint"]);
});

test("resolves pickup ids, assets and drop references", () => {
  assert.deepEqual(errorsOf(pickupDefinition(
    [
      { ...scoreSmall, id: "enemy.score_small" },
      scoreSmall,
      { ...scoreSmall, asset: "pickup.missing" },
    ],
    [{ pickup: "pickup.score_large", count: 1 }, { pickup: "bullet.red_small", count: 1 }],
  )), [
    ["id.invalidNamespace", "content.features.pickups[0].id", "Expected pickup. prefix for id: enemy.score_small"],
    ["id.duplicate", "content.features.pickups[2].id", "Duplicate id: pickup.score_small"],
    ["asset.notFound", "content.features.pickups[2].asset", "Asset not found: pickup.missing"],
    ["pickup.notFound", "content.enemies[0].drops[0].pickup", "Pickup not found: pickup.score_large"],
    [
      "id.invalidNamespace",
      "content.enemies[0].drops[1].pickup",
      "enemy.drops[].pickup must reference a pickup.* id: bullet.red_small",
    ],
  ]);
});
