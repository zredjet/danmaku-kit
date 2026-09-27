import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { createShootingCore } from "../../basic/core.ts";
import type { EnabledFeature, GameDefinition } from "../../basic/content/types.ts";
import { createEmptyInputFrame } from "../../basic/input/input-frame.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../../basic/test-support/stage-harness.ts";
import { pickupFeature } from "./index.ts";

const scoreSmall = Object.freeze({
  id: "pickup.score_small",
  version: 1,
  asset: "enemy.scout",
  score: 100,
  collectRadius: 10,
  velocity: { x: 0, y: 1.5 },
});

type Case = Readonly<{
  registered: boolean;
  enabled: boolean;
  /** `content.features.pickups` に置く pickup（`undefined` なら collection を置かない）。 */
  pickups?: readonly unknown[];
  /** enemy の drops が参照する pickup（`undefined` なら drops を置かない）。 */
  dropsPickup?: string;
}>;

function definitionFor({ enabled, pickups, dropsPickup }: Case): GameDefinition {
  const definition = createMinimumDefinition();
  return {
    ...definition,
    enabledFeatures: enabled ? ["pickup"] as EnabledFeature[] : [],
    content: {
      ...definition.content,
      enemies: definition.content.enemies.map((enemy) => (
        dropsPickup === undefined ? enemy : { ...enemy, drops: [{ pickup: dropsPickup, count: 1 }] }
      )),
      ...(pickups === undefined ? {} : { features: { pickups } }),
    },
  } as unknown as GameDefinition;
}

function outcome(testCase: Case): readonly string[] {
  const core = createShootingCore({ features: testCase.registered ? [pickupFeature] : [] });
  const loaded = core.load(definitionFor(testCase));
  return loaded.ok
    ? ["ok", ...loaded.warnings.map((warning) => `warning ${warning.code} ${warning.schemaPath}`)]
    : loaded.errors.map((error) => `error ${error.code} ${error.schemaPath}`);
}

test("gates pickup content by whether the feature is enabled and registered (design 20)", () => {
  const cases: readonly (readonly [string, Case, readonly string[]])[] = [
    // 無効な feature の定義は読み込むだけで使わず warning、無効な feature を参照する field は error。
    ["disabled, unregistered, definitions only", { registered: false, enabled: false, pickups: [scoreSmall] }, [
      "ok",
      "warning feature.disabledContent content.features.pickups",
    ]],
    ["disabled, registered, definitions only", { registered: true, enabled: false, pickups: [scoreSmall] }, [
      "ok",
      "warning feature.disabledContent content.features.pickups",
    ]],
    ["disabled, invalid definitions are not validated", { registered: true, enabled: false, pickups: [{ id: 1 }] }, [
      "ok",
      "warning feature.disabledContent content.features.pickups",
    ]],
    ["disabled, drops referenced", { registered: true, enabled: false, pickups: [scoreSmall], dropsPickup: scoreSmall.id }, [
      "error feature.disabled content.enemies[0].drops",
    ]],
    ["disabled, unregistered, drops referenced", { registered: false, enabled: false, dropsPickup: scoreSmall.id }, [
      "error feature.disabled content.enemies[0].drops",
    ]],
    // 有効にした feature は Core に module が要る。
    ["enabled, unregistered", { registered: false, enabled: true, pickups: [scoreSmall], dropsPickup: scoreSmall.id }, [
      "error feature.unsupported enabledFeatures",
    ]],
    ["enabled, valid reference", { registered: true, enabled: true, pickups: [scoreSmall], dropsPickup: scoreSmall.id }, ["ok"]],
    ["enabled, no pickups", { registered: true, enabled: true }, ["ok"]],
    ["enabled, missing reference", { registered: true, enabled: true, pickups: [scoreSmall], dropsPickup: "pickup.missing" }, [
      "error pickup.notFound content.enemies[0].drops[0].pickup",
    ]],
    ["enabled, drops without the collection", { registered: true, enabled: true, dropsPickup: scoreSmall.id }, [
      "error pickup.notFound content.enemies[0].drops[0].pickup",
    ]],
    ["enabled, invalid definitions", { registered: true, enabled: true, pickups: [{ ...scoreSmall, score: -1 }] }, [
      "error definition.invalidShape content.features.pickups[0].score",
    ]],
  ];

  for (const [label, testCase, expected] of cases) {
    assert.deepEqual(outcome(testCase), expected, label);
  }
});

test("rejects unknown feature collections and a content.features that is not an object", () => {
  const definition = createMinimumDefinition();
  const withFeatures = (features: unknown) => createShootingCore({ features: [pickupFeature] }).load({
    ...definition,
    content: { ...definition.content, features },
  } as unknown as GameDefinition);
  const unknown = withFeatures({ bombs: [] });
  const notObject = withFeatures([]);

  assert.deepEqual(!unknown.ok && unknown.errors.map((error) => [error.code, error.message]), [
    ["definition.unknownField", "Unknown field at content.features.bombs"],
  ]);
  assert.deepEqual(!notObject.ok && notObject.errors.map((error) => [error.code, error.message]), [
    ["definition.invalidShape", "content.features must be an object"],
  ]);
});

test("keeps a null pickup feature state through serialize and restore until pickups run in the simulation", () => {
  const loaded = createShootingCore({ features: [pickupFeature] })
    .load(definitionFor({ registered: true, enabled: true, pickups: [scoreSmall], dropsPickup: scoreSmall.id }));
  assert.ok(loaded.ok);
  const session = startStageFromLoadedGame(loaded.value);
  assertTickOk(session.tick(createEmptyInputFrame(0)), "tick 0");
  const snapshot = assertSerializeOk(session.serialize(), "serialize");
  const restored = loaded.value.restore(snapshot);

  assert.deepEqual(snapshot.enabledFeatures, ["pickup"]);
  assert.deepEqual(snapshot.state.enabledFeatureStates, [{ feature: "pickup", stateVersion: 1, payload: null }]);
  assert.ok(restored.ok);
  const tampered = loaded.value.restore({
    ...snapshot,
    state: { ...snapshot.state, enabledFeatureStates: [{ feature: "pickup", stateVersion: 1, payload: 0 }] },
  });
  assert.deepEqual(!tampered.ok && tampered.errors.map((error) => error.code), ["state.invalidShape"]);
});
