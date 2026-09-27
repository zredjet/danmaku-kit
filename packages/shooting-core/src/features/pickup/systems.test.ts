import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureTickContext } from "../../basic/extension/feature-module.ts";
import { okResult } from "../../basic/result.ts";
import { MAX_ACTIVE_PICKUPS } from "./budgets.ts";
import { loadPickupContent } from "./content.ts";
import type { PickupContent, PickupEntityState } from "./model.ts";
import { advancePickups } from "./systems.ts";
import { createDroppingEnemyDefinition } from "./test-support/pickup-definitions.ts";

/** pickup の system を直接呼ぶための 1 tick の文脈。採番した id と出した event を記録する。 */
function tickContext(defeated: number) {
  const definition = createDroppingEnemyDefinition();
  const content = loadPickupContent(definition);
  assert.ok(content.ok);
  const events: unknown[] = [];
  const allocated: number[] = [];
  const context: FeatureTickContext<PickupContent> = {
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
      position: { x: 40, y: 40 },
    })),
    allocateEntityIds: (count) => {
      const ids = Array.from({ length: count }, (_, index) => 1_000 + allocated.length + index);
      allocated.push(...ids);
      return okResult(ids);
    },
    addScore: () => 0,
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
