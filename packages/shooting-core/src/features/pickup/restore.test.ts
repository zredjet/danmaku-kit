import assert from "node:assert/strict";
import test from "node:test";

import type { LoadedGame } from "../../basic/api-types.ts";
import { createShootingCore } from "../../basic/core.ts";
import type { GameDefinition } from "../../basic/content/types.ts";
import { createEmptyInputFrame } from "../../basic/input/input-frame.ts";
import type { InputFrame } from "../../basic/input/input-frame.ts";
import type { SerializedGameState } from "../../basic/serialization/types.ts";
import { createShotInputFrame } from "../../basic/test-support/input-frames.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../../basic/test-support/stage-harness.ts";
import { pickupFeature } from "./index.ts";
import { createDroppingEnemyDefinition } from "./test-support/pickup-definitions.ts";

function loadGame(definition: GameDefinition): LoadedGame {
  const loaded = createShootingCore({ features: [pickupFeature] }).load(definition);
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? null : loaded.errors));
  return loaded.value;
}

const inputs: readonly InputFrame[] = Array.from({ length: 70 }, (_, tick) => (
  tick === 0 ? createShotInputFrame(0) : createEmptyInputFrame(tick)
));

function serializeAfter(game: LoadedGame, ticks: number): SerializedGameState {
  const session = startStageFromLoadedGame(game);
  for (const input of inputs.slice(0, ticks)) {
    assertTickOk(session.tick(input), `tick ${input.tick}`);
  }
  return assertSerializeOk(session.serialize(), `serialize after ${ticks}`);
}

/** restore した session と元の session が後続 tick と最後の serialize で一致することを確かめる。 */
function assertRestoresAndContinues(game: LoadedGame, restoreTicks: readonly number[], endTick: number): void {
  for (const restoreTick of restoreTicks) {
    const source = startStageFromLoadedGame(game);
    for (const input of inputs.slice(0, restoreTick)) {
      assertTickOk(source.tick(input), `source tick ${input.tick}`);
    }
    const snapshot = assertSerializeOk(source.serialize(), `serialize at ${restoreTick}`);
    const restored = game.restore(snapshot);
    assert.ok(restored.ok, `restore at ${restoreTick}: ${JSON.stringify(restored.ok ? null : restored.errors)}`);
    assert.deepEqual(assertSerializeOk(restored.value.serialize(), "restored serialize"), snapshot);
    for (const input of inputs.slice(restoreTick, endTick)) {
      assert.deepEqual(
        assertTickOk(restored.value.tick(input), `restored tick ${input.tick}`),
        assertTickOk(source.tick(input), `source tick ${input.tick}`),
        `frame ${input.tick} after restore at ${restoreTick}`,
      );
    }
  }
}

function withPickups(snapshot: SerializedGameState, change: (pickups: Record<string, unknown>[]) => unknown[]): SerializedGameState {
  const [state] = snapshot.state.enabledFeatureStates;
  const payload = state!.payload as { pickups: Record<string, unknown>[] };
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      enabledFeatureStates: [{ ...state!, payload: { pickups: change([...payload.pickups]) } as never }],
    },
  };
}

test("serializes active pickups as the pickup feature state", () => {
  const snapshot = serializeAfter(loadGame(createDroppingEnemyDefinition({ magnetRadius: 40 })), 3);

  assert.deepEqual(snapshot.state.enabledFeatureStates, [{
    feature: "pickup",
    stateVersion: 2,
    payload: {
      pickups: [182, 192, 202].map((x, index) => ({
        id: 4 + index,
        definitionId: "pickup.score_small",
        spawnTick: 0,
        spawnPosition: { x, y: 380 },
        attractedTick: 0,
      })),
    },
  }]);
});

test("restores falling, attracted and collected pickups at any tick and continues identically", () => {
  assertRestoresAndContinues(loadGame(createDroppingEnemyDefinition()), [1, 3, 7, 8, 30, 66, 67], 70);
  assertRestoresAndContinues(loadGame(createDroppingEnemyDefinition({ magnetRadius: 40 })), [1, 5, 12, 13], 16);
});

test("rejects pickups that the spawn and the tick schedule cannot reach", () => {
  const game = loadGame(createDroppingEnemyDefinition());
  const magnetGame = loadGame(createDroppingEnemyDefinition({ magnetRadius: 40 }));
  const snapshot = serializeAfter(game, 3);
  const magnetSnapshot = serializeAfter(magnetGame, 3);
  const errorOf = (target: LoadedGame, state: SerializedGameState) => {
    const restored = target.restore(state);
    return restored.ok ? null : `${restored.errors[0]!.code}: ${restored.errors[0]!.message}`;
  };
  const edit = (index: number, change: Record<string, unknown>) => withPickups(snapshot, (pickups) => (
    pickups.map((pickup, pickupIndex) => (pickupIndex === index ? { ...pickup, ...change } : pickup))
  ));

  const cases: readonly (readonly [string, LoadedGame, SerializedGameState, RegExp])[] = [
    ["id of the player", game, edit(0, { id: 1 }), /pickups\[0\]\.id must be ascending/],
    ["id at nextEntityId", game, edit(2, { id: snapshot.nextEntityId }), /pickups\[2\]\.id must be ascending/],
    ["ids out of order", game, withPickups(snapshot, (pickups) => pickups.reverse()), /pickups\[1\]\.id must be ascending/],
    ["future spawn", game, edit(0, { spawnTick: 3 }), /pickups\[0\]\.spawnTick must be before expectedTick/],
    ["unknown pickup", game, edit(0, { definitionId: "pickup.missing" }), /pickups\[0\] must be a pickup that an enemy/],
    ["attracted without a magnet", game, edit(0, { attractedTick: 1 }), /pickups\[0\]\.attractedTick/],
    ["attraction before spawn", magnetGame, withPickups(magnetSnapshot, (pickups) => [{ ...pickups[0]!, spawnTick: 1 }, ...pickups.slice(1)]), /pickups\[0\]\.attractedTick/],
    ["spawn outside the bounds", game, edit(0, { spawnPosition: { x: 182, y: 490 } }), /pickups\[0\] must stay inside the cleanup bounds/],
    ["extra key", game, edit(0, { velocity: { x: 0, y: 1 } }), /pickups\[0\] must have id, definitionId/],
  ];
  for (const [label, target, state, expected] of cases) {
    assert.match(errorOf(target, state) ?? "restored", expected, label);
  }
  const collected = serializeAfter(magnetGame, 13);
  assert.match(
    errorOf(magnetGame, withPickups(collected, () => (magnetSnapshot.state.enabledFeatureStates[0]!.payload as { pickups: unknown[] }).pickups)) ?? "",
    /attractedTick must be a tick of the attraction that has not been collected yet/,
  );
  const olderVersion = { ...snapshot, state: { ...snapshot.state, enabledFeatureStates: [{ ...snapshot.state.enabledFeatureStates[0]!, stateVersion: 1 }] } };
  assert.match(errorOf(game, olderVersion) ?? "", /^state\.featureMismatch: unsupported pickup feature stateVersion: 1$/);
});

test("widens the entity id envelope by the pickups the processed timeline can drop", () => {
  const game = loadGame(createDroppingEnemyDefinition());
  const snapshot = serializeAfter(game, 3);

  // tick 3 の basic の上限は player と enemy の 2 + 1 体 + shot 3 発で 6、processed timeline の scout が落とす 3 個を足して 9。
  assert.equal(snapshot.nextEntityId, 7);
  assert.equal(game.restore({ ...snapshot, nextEntityId: 9 }).ok, true);
  const over = game.restore({ ...snapshot, nextEntityId: 10 });
  assert.deepEqual(!over.ok && [over.errors[0]!.code, over.errors[0]!.message], [
    "state.invalidShape",
    "nextEntityId exceeds the deterministic allocation envelope",
  ]);
});
