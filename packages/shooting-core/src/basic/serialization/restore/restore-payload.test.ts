import assert from "node:assert/strict";
import test from "node:test";

import type { CoreErrorCode } from "../../result.ts";
import { createMoveInputFrame } from "../../test-support/input-frames.ts";
import {
  loadMinimumGame,
  serializeInitialStageState,
  startStageFromLoadedGame,
} from "../../test-support/stage-harness.ts";
import type { SerializedGameState } from "../types.ts";

test("restore validates deterministic payload before accepting a session", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectRestoreError = (state: unknown, code: CoreErrorCode, detail: RegExp) => {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, code);
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectRestoreError({ ...validState, prngState: { state: 0 } }, "state.prngInvalid", /prngState/);
  expectRestoreError({ ...validState, prngState: { state: "not-a-prng-state" } }, "state.prngInvalid", /prngState/);
  expectRestoreError({ ...validState, prngState: { state: 1, extra: true } }, "state.invalidShape", /prngState/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, extra: true },
  }, "state.invalidShape", /state contains unknown fields/);
  const stateWithNonEnumerableExtra = { ...validState.state };
  Object.defineProperty(stateWithNonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectRestoreError({
    ...validState,
    state: stateWithNonEnumerableExtra,
  }, "state.invalidShape", /state contains unknown fields/);
  const missingRuntimeEntities = { ...validState.state } as Record<string, unknown>;
  delete missingRuntimeEntities.runtimeEntities;
  expectRestoreError({ ...validState, state: missingRuntimeEntities }, "state.invalidShape", /runtimeEntities/);
  for (const requiredField of [
    "pendingEvents",
    "score",
    "timelineCursor",
    "patternRunnerStates",
    "enabledFeatureStates",
  ] as const) {
    const missingRequiredField = { ...validState.state } as Record<string, unknown>;
    delete missingRequiredField[requiredField];
    expectRestoreError({ ...validState, state: missingRequiredField }, "state.invalidShape", new RegExp(requiredField));
  }
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: {} },
  }, "state.invalidShape", /runtimeEntities/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      runtimeEntities: Array.from({ length: 8_494 }, () => validState.state.runtimeEntities[0]!),
    },
  }, "state.invalidShape", /runtimeEntities/);
  const sparseRuntimeEntities: unknown[] = [];
  sparseRuntimeEntities.length = 1;
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: sparseRuntimeEntities },
  }, "state.invalidShape", /runtimeEntities/);
  const runtimeEntitiesWithNonEnumerableExtra = [...validState.state.runtimeEntities];
  Object.defineProperty(runtimeEntitiesWithNonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: runtimeEntitiesWithNonEnumerableExtra },
  }, "state.invalidShape", /runtimeEntities/);
  const throwingRuntimeEntitiesLength = new Proxy([...validState.state.runtimeEntities], {
    get(target, property, receiver) {
      if (property === "length") {
        throw new Error("runtimeEntities boom");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: throwingRuntimeEntitiesLength },
  }, "state.invalidShape", /runtimeEntities/);
  const serializedPlayer = validState.state.runtimeEntities[0];
  assert.equal(serializedPlayer?.kind, "player");
  if (serializedPlayer?.kind !== "player") {
    assert.fail("expected serialized player entity");
  }
  const playerWithNonEnumerableExtra = { ...serializedPlayer };
  Object.defineProperty(playerWithNonEnumerableExtra, "hp", { enumerable: false, value: 1 });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [playerWithNonEnumerableExtra] },
  }, "state.invalidShape", /enumerable data properties/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, id: 2 }] },
  }, "state.invalidShape", /below nextEntityId/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, id: 0 }] },
  }, "state.invalidShape", /below nextEntityId/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, kind: "boss" }] },
  }, "state.invalidShape", /kind is not supported/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, collisionRadius: 0 }] },
  }, "state.invalidShape", /collisionRadius/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, collisionRadius: Number.POSITIVE_INFINITY }] },
  }, "state.invalidShape", /collisionRadius/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [] },
  }, "state.invalidShape", /initial restore state/);
  expectRestoreError({
    ...validState,
    nextEntityId: 3,
    state: {
      ...validState.state,
      runtimeEntities: [
        serializedPlayer,
        { ...serializedPlayer, id: 2 },
      ],
    },
  }, "state.invalidShape", /initial restore state/);
  expectRestoreError({
    ...validState,
    nextEntityId: 3,
    state: {
      ...validState.state,
      runtimeEntities: [
        serializedPlayer,
        {
          id: 2,
          kind: "enemy",
          definitionId: "enemy.scout",
          position: { x: 192, y: -16 },
          collisionRadius: 12,
          hp: 10,
          scoreOnKill: 100,
          pathId: "path.none",
          patternId: "pattern.none",
        },
      ],
    },
  }, "state.invalidShape", /initial restore state/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    nextEntityId: 3,
    state: {
      ...validState.state,
      timelineCursor: 0,
      pendingEvents: [],
      runtimeEntities: [
        serializedPlayer,
        {
          id: 2,
          kind: "enemy",
          definitionId: "enemy.scout",
          position: { x: 192, y: -16 },
          collisionRadius: 12,
          hp: 10,
          scoreOnKill: 100,
          pathId: "path.none",
          patternId: "pattern.none",
        },
      ],
    },
  }, "state.invalidShape", /processed timeline/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, hp: 1 }] },
  }, "state.invalidShape", /player runtime entity/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, definitionId: "player.missing" }] },
  }, "state.registryInvalid", /player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, definitionId: "not-a-player-id" }] },
  }, "state.invalidShape", /player id/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, shotDefinitionId: "playerShot.missing" }] },
  }, "state.registryInvalid", /player shot/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, shotDefinitionId: "not-a-shot-id" }] },
  }, "state.invalidShape", /playerShot id/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, position: { x: Infinity, y: 400 } }] },
  }, "state.invalidShape", /position/);
  const throwingPlayerPosition = new Proxy({ x: 192, y: 400 }, {
    get() {
      throw new Error("position should not be read directly after validation");
    },
  });
  const restoredWithThrowingPlayerPosition = loaded.restore({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, position: throwingPlayerPosition }] },
  } as SerializedGameState);
  assert.equal(restoredWithThrowingPlayerPosition.ok, true);
  if (!restoredWithThrowingPlayerPosition.ok) {
    assert.fail("expected descriptor-cloned position proxy to restore");
  }
  assert.deepEqual(restoredWithThrowingPlayerPosition.value.serialize(), { ok: true, value: validState, warnings: [] });
  const movedSession = startStageFromLoadedGame(loaded);
  const movedFrame = movedSession.tick(createMoveInputFrame(0, 1, 0, []));
  assert.equal(movedFrame.ok, true);
  const movedState = movedSession.serialize();
  assert.equal(movedState.ok, true);
  if (!movedState.ok) {
    assert.fail("expected moved player state");
  }
  const movedPlayer = movedState.value.state.runtimeEntities.find((entity) => entity.kind === "player");
  assert.equal(movedPlayer?.kind, "player");
  if (movedPlayer?.kind !== "player") {
    assert.fail("expected moved player entity");
  }
  assert.notDeepEqual(movedPlayer.position, { x: 192, y: 400 });
  const throwingMovedPlayerPosition = new Proxy({ x: movedPlayer.position.x, y: movedPlayer.position.y }, {
    get() {
      throw new Error("moved player position should be descriptor-cloned");
    },
  });
  const restoredMovedPlayer = loaded.restore({
    ...movedState.value,
    state: {
      ...movedState.value.state,
      runtimeEntities: movedState.value.state.runtimeEntities.map((entity) => (
        entity.id === movedPlayer.id ? { ...movedPlayer, position: throwingMovedPlayerPosition } : entity
      )),
    },
  } as SerializedGameState);
  assert.equal(restoredMovedPlayer.ok, true);
  if (!restoredMovedPlayer.ok) {
    assert.fail("expected descriptor-cloned moved player position proxy to restore");
  }
  assert.deepEqual(restoredMovedPlayer.value.serialize(), movedState);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, movement: { speed: 17, focusSpeed: 1.8 } }] },
  }, "state.invalidShape", /movement/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, movement: { speed: 5, focusSpeed: 1.8 } }] },
  }, "state.invalidShape", /player definition fields/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, collisionRadius: 4 }] },
  }, "state.invalidShape", /player definition fields/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, lives: -1 }] },
  }, "state.invalidShape", /player runtime counters/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, invincibleTicksRemaining: 1.5 }] },
  }, "state.invalidShape", /player runtime counters/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, nextShotAllowedTick: -1 }] },
  }, "state.invalidShape", /player runtime counters/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, position: { x: 193, y: 400 } }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, lives: 2 }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, invincibleTicksRemaining: 1 }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, runtimeEntities: [{ ...serializedPlayer, nextShotAllowedTick: 1 }] },
  }, "state.invalidShape", /initial player/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, score: -1 },
  }, "state.invalidShape", /score/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, score: Number.POSITIVE_INFINITY },
  }, "state.invalidShape", /score/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    state: { ...validState.state, pendingEvents: [], score: 0.5 },
  }, "state.invalidShape", /score/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, score: 1 },
  }, "state.invalidShape", /score must be zero/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, timelineCursor: 999 },
  }, "state.invalidShape", /timelineCursor/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    state: { ...validState.state, timelineCursor: 1, pendingEvents: [] },
  }, "state.invalidShape", /timelineCursor/);
  expectRestoreError({
    ...validState,
    expectedTick: 61,
    state: { ...validState.state, timelineCursor: 0, pendingEvents: [] },
  }, "state.invalidShape", /timelineCursor/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, pendingEvents: [] },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      pendingEvents: [
        { type: "stageStarted", tick: 0, stageId: "stage.stage_01" },
        { type: "stageStarted", tick: 0, stageId: "stage.stage_01" },
      ],
    },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.missing" }],
    },
  }, "state.invalidShape", /pendingEvents/);
  const pendingEventsWithNonEnumerableExtra = [...validState.state.pendingEvents];
  Object.defineProperty(pendingEventsWithNonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectRestoreError({
    ...validState,
    state: { ...validState.state, pendingEvents: pendingEventsWithNonEnumerableExtra },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      pendingEvents: Array.from({ length: 8_193 }, () => ({ type: "stageStarted", tick: 0, stageId: "stage.stage_01" })),
    },
  }, "state.invalidShape", /pendingEvents/);
  expectRestoreError({
    ...validState,
    expectedTick: 1,
    state: {
      ...validState.state,
      pendingEvents: [{ type: "stageStarted", tick: 0, stageId: "stage.stage_01" }],
    },
  }, "state.invalidShape", /pendingEvents/);
  const validPatternRunnerState = {
    runnerId: "patternRunner.main",
    patternId: "pattern.none",
    stateVersion: 1,
    payload: { cursor: 0, flags: [true, "ready", null] },
  };
  const validEnabledFeatureState = {
    feature: "bomb",
    stateVersion: 1,
    payload: { charges: 1 },
  };
  expectRestoreError({
    ...validState,
    state: { ...validState.state, patternRunnerStates: [validPatternRunnerState] },
  }, "state.featureMismatch", /patternRunnerStates/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: Array.from({ length: 129 }, (_, index) => ({
        ...validPatternRunnerState,
        runnerId: `patternRunner.${String(index).padStart(3, "0")}`,
      })),
    },
  }, "state.invalidShape", /patternRunnerStates/);
  expectRestoreError({
    ...validState,
    state: { ...validState.state, enabledFeatureStates: [validEnabledFeatureState] },
  }, "state.featureMismatch", /enabled feature/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, runnerId: "patternRunner." }],
    },
  }, "state.invalidShape", /runnerId/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, runnerId: `patternRunner.${"x".repeat(8_193)}` }],
    },
  }, "state.invalidShape", /runnerId/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        { ...validPatternRunnerState, runnerId: "patternRunner.z" },
        { ...validPatternRunnerState, runnerId: "patternRunner.a" },
      ],
    },
  }, "state.invalidShape", /ordered/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        { ...validPatternRunnerState, runnerId: "patternRunner.😀" },
        { ...validPatternRunnerState, runnerId: "patternRunner.あ" },
      ],
    },
  }, "state.invalidShape", /ordered/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        validPatternRunnerState,
        validPatternRunnerState,
      ],
    },
  }, "state.invalidShape", /ordered/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, patternId: "path.none" }],
    },
  }, "state.invalidShape", /pattern id/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, patternId: "pattern.missing" }],
    },
  }, "state.featureMismatch", /patternRunnerStates/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, stateVersion: 0 }],
    },
  }, "state.invalidShape", /stateVersion/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: Number.POSITIVE_INFINITY }],
    },
  }, "state.invalidShape", /payload/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: "\ud800" }],
    },
  }, "state.invalidShape", /lone surrogate/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: "x".repeat(8_193) }],
    },
  }, "state.invalidShape", /string budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{
        ...validPatternRunnerState,
        payload: Array.from({ length: 65 }, () => "x".repeat(4_096)),
      }],
    },
  }, "state.invalidShape", /payload budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: { ["x".repeat(8_193)]: 1 } }],
    },
  }, "state.invalidShape", /string budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: () => 0 }],
    },
  }, "state.invalidShape", /JSON-compatible/);
  const sparsePayload: unknown[] = [];
  sparsePayload.length = 1;
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: sparsePayload }],
    },
  }, "state.invalidShape", /payload/);
  const tooWidePayload = Object.fromEntries(Array.from({ length: 8_192 }, (_, index) => [`k${index}`, index]));
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: tooWidePayload }],
    },
  }, "state.invalidShape", /payload budget/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [
        { ...validPatternRunnerState, runnerId: "patternRunner.a", payload: Array.from({ length: 8_190 }, () => null) },
        { ...validPatternRunnerState, runnerId: "patternRunner.b", payload: Array.from({ length: 2 }, () => null) },
      ],
    },
  }, "state.invalidShape", /payload budget/);
  const getterPayload = {};
  Object.defineProperty(getterPayload, "value", {
    enumerable: true,
    get() {
      throw new Error("payload getter must not run");
    },
  });
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: getterPayload }],
    },
  }, "state.invalidShape", /data properties/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, payload: Object.create({ inherited: true }) }],
    },
  }, "state.invalidShape", /plain JSON object/);
  const revokedPayload = Proxy.revocable({ value: 1 }, {});
  revokedPayload.revoke();
  for (const invalidPayload of [
    undefined,
    Symbol("payload"),
    1n,
    new Date(0),
    new Map([["value", 1]]),
    revokedPayload.proxy,
  ]) {
    expectRestoreError({
      ...validState,
      state: {
        ...validState.state,
        patternRunnerStates: [{ ...validPatternRunnerState, payload: invalidPayload }],
      },
    }, "state.invalidShape", /payload|JSON|plain/);
  }
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, payload: undefined }],
    },
  }, "state.invalidShape", /payload/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, feature: 1 }],
    },
  }, "state.invalidShape", /feature/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, feature: "x".repeat(8_193) }],
    },
  }, "state.invalidShape", /feature/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      enabledFeatureStates: [{ ...validEnabledFeatureState, stateVersion: 0 }],
    },
  }, "state.invalidShape", /stateVersion/);
});
