import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureScoringContext } from "../../basic/extension/feature-module.ts";
import { okResult } from "../../basic/result.ts";
import { MAX_ACTIVE_PICKUPS } from "./budgets.ts";
import { loadPickupContent } from "./content.ts";
import type { PickupContent, PickupEntityState } from "./model.ts";
import { advancePickups } from "./systems.ts";
import { createDroppingEnemyDefinition } from "./test-support/pickup-definitions.ts";

/** pickup の system を直接呼ぶための 1 tick の文脈。採番した id と出した event を記録する。 */
function tickContext(defeated: number, position: Readonly<{ x: number; y: number }> = { x: 40, y: 40 }) {
  const definition = createDroppingEnemyDefinition();
  const content = loadPickupContent(definition);
  assert.ok(content.ok);
  const events: unknown[] = [];
  const allocated: number[] = [];
  const context: FeatureScoringContext<PickupContent> = {
    definition,
    stage: definition.content.stages[0]!,
    player: definition.content.players[0]!,
    difficulty: "normal",
    content: content.value,
    tick: 5,
    entities: [{ id: 1, kind: "player", definitionId: "player.default", position: { x: 192, y: 400 } }],
    defeatedEnemies: Array.from({ length: defeated }, (_, index) => ({
      id: 100 + index,
      definitionId: "enemy.scout",
      position,
    })),
    allocateEntityIds: (count) => {
      const ids = Array.from({ length: count }, (_, index) => 1_000 + allocated.length + index);
      allocated.push(...ids);
      return okResult(ids);
    },
    addScore: (delta) => delta,
    emitEvent: (event) => events.push(event),
  };
  return { context, events, allocated };
}

const activePickups = (count: number): PickupEntityState[] => Array.from({ length: count }, (_, index) => ({
  id: 10 + index,
  definitionId: "pickup.score_small",
  spawnTick: 5,
  spawnPosition: { x: 40, y: 40 },
  attractedTick: null,
}));

test("drops nothing and latches a budget error when the drops would exceed the active pickup budget", () => {
  const { context, events, allocated } = tickContext(1);
  const result = advancePickups({ pickups: activePickups(MAX_ACTIVE_PICKUPS - 2) }, context);

  assert.deepEqual(!result.ok && result.errors.map((error) => [error.code, error.message]), [[
    "pickup.budgetExceeded",
    "active pickups would exceed 300: 298 active and 3 dropped",
  ]]);
  assert.deepEqual([events, allocated], [[], []]);
  assert.equal(advancePickups({ pickups: activePickups(MAX_ACTIVE_PICKUPS - 3) }, tickContext(1).context).ok, true);
});

test("numbers the drops of enemies defeated in one tick in collision order, then drop order", () => {
  const { context, events } = tickContext(2);
  const result = advancePickups({ pickups: [] }, context);

  assert.ok(result.ok);
  assert.deepEqual(result.value.pickups.map((pickup) => [pickup.id, pickup.spawnPosition.x]), [
    [1_000, 30], [1_001, 40], [1_002, 50],
    [1_003, 30], [1_004, 40], [1_005, 50],
  ]);
  assert.deepEqual(events.map((event) => (event as { type: string }).type), ["pickupsSpawnedBatch"]);
});

test("collects a pickup dropped inside the collect radius in the tick it spawns", () => {
  const { context, events } = tickContext(1, { x: 192, y: 400 });
  const result = advancePickups({ pickups: [] }, context);

  // 真ん中の pickup は自機の中心に出て回収され、両脇（±10 px）は collectRadius（10）ちょうどで回収される。
  assert.deepEqual(result.ok && result.value, { pickups: [] });
  assert.deepEqual(events.map((event) => (event as { type: string }).type), [
    "pickupsSpawnedBatch",
    "pickupCollected",
    "scoreChanged",
    "pickupCollected",
    "scoreChanged",
    "pickupCollected",
    "scoreChanged",
  ]);
});

test("keeps pickups dropped above or beside the playfield while they move into it", () => {
  const above = advancePickups({ pickups: [] }, tickContext(1, { x: 192, y: -60 }).context);
  const left = advancePickups({ pickups: [] }, tickContext(1, { x: -50, y: 100 }).context);

  assert.deepEqual(above.ok && above.value.pickups.map((pickup) => pickup.spawnPosition.y), [-60, -60, -60]);
  // 左の境界の外で横に動かない pickup は playfield に入らないので、出た tick に取り除く。
  assert.deepEqual(left.ok && left.value.pickups, []);
});
