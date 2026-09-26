import assert from "node:assert/strict";
import test from "node:test";

import type { CoreErrorCode } from "../../result.ts";
import { loadMinimumGame, serializeInitialStageState } from "../../test-support/stage-harness.ts";
import type { SerializedGameState } from "../types.ts";

test("restore rejects malformed top-level serialized state without throwing", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectInvalidShape = (state: unknown, detail: RegExp) => {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectInvalidShape(null, /plain data/);
  expectInvalidShape({ ...validState, extra: true }, /unknown top-level/);
  const nonEnumerableExtra = { ...validState } as Record<string, unknown>;
  Object.defineProperty(nonEnumerableExtra, "extra", { enumerable: false, value: true });
  expectInvalidShape(nonEnumerableExtra, /plain data/);
  expectInvalidShape({ ...validState, coreVersion: 1 }, /coreVersion/);
  expectInvalidShape({ ...validState, coreVersion: "x".repeat(8_193) }, /coreVersion/);
  expectInvalidShape({ ...validState, schemaVersion: 1 }, /schemaVersion/);
  expectInvalidShape({ ...validState, contentVersion: 1 }, /contentVersion/);
  expectInvalidShape({ ...validState, inputFormatVersion: 1 }, /inputFormatVersion/);
  expectInvalidShape({ ...validState, stateHashVersion: "1" }, /stateHashVersion/);
  expectInvalidShape({ ...validState, stateHashVersion: Number.NaN }, /stateHashVersion/);
  expectInvalidShape({ ...validState, stageId: "enemy.scout" }, /stageId/);
  expectInvalidShape({ ...validState, difficulty: "lunatic" }, /^difficulty must be normal or hard$/);
  expectInvalidShape({ ...validState, difficulty: 1 }, /^difficulty must be normal or hard$/);
  expectInvalidShape({ ...validState, playerId: "enemy.scout" }, /playerId/);
  expectInvalidShape({ ...validState, expectedTick: -1 }, /expectedTick/);
  expectInvalidShape({ ...validState, expectedTick: 1.5 }, /expectedTick/);
  expectInvalidShape({ ...validState, expectedTick: Number.MAX_SAFE_INTEGER + 1 }, /expectedTick/);
  expectInvalidShape({ ...validState, expectedTick: Infinity }, /expectedTick/);
  expectInvalidShape({ ...validState, nextEntityId: 0 }, /nextEntityId/);
  expectInvalidShape({ ...validState, nextEntityId: 1.5 }, /nextEntityId/);
  expectInvalidShape({ ...validState, nextEntityId: Number.MAX_SAFE_INTEGER + 1 }, /nextEntityId/);
  expectInvalidShape({ ...validState, nextEntityId: Number.NaN }, /nextEntityId/);
  expectInvalidShape({ ...validState, prngState: null }, /prngState/);
  expectInvalidShape({ ...validState, prngState: [] }, /prngState/);
  expectInvalidShape({ ...validState, state: null }, /state must be an object/);
  expectInvalidShape({ ...validState, state: [] }, /state must be an object/);

  for (const key of Object.keys(validState)) {
    const missingFieldState = { ...validState } as Record<string, unknown>;
    delete missingFieldState[key];
    expectInvalidShape(missingFieldState, /must be|must use|unknown top-level|must contain/);
  }
});

test("restore rejects malformed enabledFeatures metadata without throwing", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectInvalidShape = (state: unknown, detail: RegExp) => {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };

  expectInvalidShape({ ...validState, enabledFeatures: ["bomb", 1] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: ["bomb", "bomb"] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: ["unknownFeature", "unknownFeature"] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: ["graze", "bomb"] }, /enabledFeatures/);
  expectInvalidShape({ ...validState, enabledFeatures: Array.from({ length: 65 }, (_, index) => `unknownFeature${index}`) }, /enabledFeatures/);
  const sparseFeatures: unknown[] = [];
  sparseFeatures.length = 1;
  expectInvalidShape({ ...validState, enabledFeatures: sparseFeatures }, /enabledFeatures/);
  const invalidLengthFeatures = new Proxy([], {
    get(target, property, receiver) {
      if (property === "length") {
        return "not-a-length";
      }
      return Reflect.get(target, property, receiver);
    },
  });
  expectInvalidShape({ ...validState, enabledFeatures: invalidLengthFeatures }, /enabledFeatures/);
  const accessorFeatures = Object.defineProperty([], "0", {
    enumerable: true,
    get() {
      throw new Error("feature boom");
    },
  });
  Object.defineProperty(accessorFeatures, "length", { value: 1 });
  expectInvalidShape({ ...validState, enabledFeatures: accessorFeatures }, /enabledFeatures/);
  const customPropertyFeatures = Object.assign(["bomb"], { extra: true });
  expectInvalidShape({ ...validState, enabledFeatures: customPropertyFeatures }, /enabledFeatures/);
  const nonEnumerableFeatureProperty = ["bomb"];
  Object.defineProperty(nonEnumerableFeatureProperty, "extra", { enumerable: false, value: true });
  expectInvalidShape({ ...validState, enabledFeatures: nonEnumerableFeatureProperty }, /enabledFeatures/);
  const inheritedFeatureProperty = ["bomb"];
  Object.setPrototypeOf(inheritedFeatureProperty, { inherited: true });
  expectInvalidShape({ ...validState, enabledFeatures: inheritedFeatureProperty }, /enabledFeatures/);
  const symbolFeatures = ["bomb"] as unknown[];
  Object.defineProperty(symbolFeatures, Symbol("feature"), { enumerable: true, value: true });
  expectInvalidShape({ ...validState, enabledFeatures: symbolFeatures }, /enabledFeatures/);
  const revokedFeatures = Proxy.revocable([], {});
  revokedFeatures.revoke();
  expectInvalidShape({ ...validState, enabledFeatures: revokedFeatures.proxy }, /enabledFeatures/);
});

test("restore rejects hostile serialized state inputs without throwing", () => {
  const loaded = loadMinimumGame("core.test");

  const throwingGetter = Object.defineProperty({}, "coreVersion", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  const cyclicState: Record<string, unknown> = {};
  cyclicState.self = cyclicState;
  const throwingNestedProxy = {
    ...serializeInitialStageState("core.test"),
    state: new Proxy({}, {
      getPrototypeOf() {
        throw new Error("nested boom");
      },
    }),
  };

  for (const [state, detail] of [
    [throwingGetter, /plain data/],
    [cyclicState, /coreVersion/],
    [throwingNestedProxy, /state must be an object/],
  ] as const) {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  }
});

test("restore classifies top-level compatibility mismatches", () => {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");

  const expectRestoreError = (state: SerializedGameState, code: CoreErrorCode) => {
    const restored = loaded.restore(state);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, code);
  };

  expectRestoreError({ ...validState, coreVersion: "other.core" }, "state.coreVersionMismatch");
  expectRestoreError({ ...validState, schemaVersion: "2" }, "state.schemaVersionMismatch");
  expectRestoreError({ ...validState, inputFormatVersion: "2" }, "state.inputFormatVersionMismatch");
  expectRestoreError({ ...validState, stateHashVersion: 2 }, "state.stateHashVersionMismatch");
  expectRestoreError({ ...validState, contentVersion: "content.other" }, "state.contentMismatch");
  expectRestoreError({ ...validState, stageId: "stage.missing" }, "state.contentMismatch");
  expectRestoreError({ ...validState, difficulty: "hard" }, "state.contentMismatch");
  expectRestoreError({ ...validState, playerId: "player.missing" }, "state.contentMismatch");
  expectRestoreError({ ...validState, enabledFeatures: ["bomb"] }, "state.featureMismatch");
  expectRestoreError({ ...validState, enabledFeatures: ["unknownFeature"] } as unknown as SerializedGameState, "state.featureMismatch");
  for (const [state, code] of [
    [{ ...validState, coreVersion: "other.core", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.coreVersionMismatch"],
    [{ ...validState, coreVersion: "other.core", state: [] }, "state.coreVersionMismatch"],
    [{ ...validState, schemaVersion: "2", difficulty: "lunatic", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.schemaVersionMismatch"],
    [{ ...validState, schemaVersion: "2", futureTopLevelField: true }, "state.schemaVersionMismatch"],
    [{ ...validState, schemaVersion: "2", prngState: null }, "state.schemaVersionMismatch"],
    [{ ...validState, inputFormatVersion: "2", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.inputFormatVersionMismatch"],
    [{ ...validState, inputFormatVersion: "2", futureTopLevelField: true }, "state.inputFormatVersionMismatch"],
    [{ ...validState, stateHashVersion: 2, state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.stateHashVersionMismatch"],
    [{ ...validState, stateHashVersion: 2, futureTopLevelField: true }, "state.stateHashVersionMismatch"],
    [{ ...validState, contentVersion: "content.other", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.contentMismatch"],
    [{ ...validState, contentVersion: "content.other", futureTopLevelField: true }, "state.contentMismatch"],
    [{ ...validState, stageId: "stage.missing", state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.contentMismatch"],
    [{ ...validState, stageId: "stage.missing", state: [] }, "state.contentMismatch"],
    [{ ...validState, enabledFeatures: ["unknownFeature"], state: { invalidNestedFuturePayload: Number.POSITIVE_INFINITY } }, "state.featureMismatch"],
    [{ ...validState, enabledFeatures: ["unknownFeature"], prngState: null }, "state.featureMismatch"],
  ] as const) {
    expectRestoreError(state as unknown as SerializedGameState, code);
  }
});
