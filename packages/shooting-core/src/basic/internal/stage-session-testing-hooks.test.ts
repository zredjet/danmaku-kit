import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import { createShootingCoreWithTestingHooksForInternalTest } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { enableInternalTestHooksForTestFile } from "../test-support/internal-test-hooks.ts";
import { startStageFromCoreAndDefinition, startStageFromLoadedGame } from "../test-support/stage-harness.ts";
import { createShootingCoreWithTestingHooksForTest } from "./testing-hooks.ts";

const testEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
enableInternalTestHooksForTestFile();

test("keeps testing hooks scoped to each created stage session", () => {
  const loaded = createShootingCoreWithTestingHooksForTest("0.0.0", {
    failAfterWorkingMutationTicks: [0],
  }).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game with testing hooks");
  }

  const first = startStageFromLoadedGame(loaded.value);
  const second = startStageFromLoadedGame(loaded.value);

  const firstFailure = first.tick(createEmptyInputFrame(0));
  const secondFailure = second.tick(createEmptyInputFrame(0));
  assert.equal(firstFailure.ok, false);
  assert.equal(secondFailure.ok, false);
  assert.equal(!firstFailure.ok && firstFailure.errors[0]?.code, "testHook.failure");
  assert.equal(!secondFailure.ok && secondFailure.errors[0]?.code, "testHook.failure");
});

test("rejects duplicate testing hook override ticks", () => {
  assert.throws(
    () => startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
      overrideCommittedPendingEventsTicks: [
        { tick: 0, pendingEvents: [] },
        { tick: 0, pendingEvents: [] },
      ],
    }), createMinimumDefinition()),
    /Duplicate testing hook override tick: 0/,
  );
  assert.throws(
    () => startStageFromCoreAndDefinition(createShootingCoreWithTestingHooksForTest("0.0.0", {
      overrideCommittedNextEntityIdTicks: [
        { tick: 0, nextEntityId: 1 },
        { tick: 0, nextEntityId: 2 },
      ],
    }), createMinimumDefinition()),
    /Duplicate testing hook override tick: 0/,
  );
});

test("rejects hook-enabled core creation without the internal test environment flag", () => {
  if (!testEnv) {
    assert.fail("expected node test environment");
  }

  const previousFlag = testEnv.SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS;
  delete testEnv.SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS;
  try {
    assert.throws(
      () => createShootingCoreWithTestingHooksForInternalTest("0.0.0", {
        failAfterWorkingMutationTicks: [0],
      }),
      /SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS=1/,
    );
  } finally {
    testEnv.SHOOTING_CORE_ENABLE_INTERNAL_TEST_HOOKS = previousFlag;
  }
});
