import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { LoadedGame, StartStageOptions } from "../api-types.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { loadUnknown, startMinimumStage, tickUnknown } from "../test-support/stage-harness.ts";

test("rejects out-of-order input ticks without advancing the session", () => {
  const started = startMinimumStage();

  const mismatch = started.tick(createEmptyInputFrame(1));
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.errors[0]?.code, "input.tickMismatch");

  const recovered = started.tick(createEmptyInputFrame(0));
  assert.equal(recovered.ok, true);
  assert.equal(recovered.ok && recovered.value.tick, 0);
});

test("rejects invalid startStage and tick inputs without throwing", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const invalidStart = startStageUnknown(loaded.value, null);
  assert.equal(invalidStart.ok, false);
  assert.equal(!invalidStart.ok && invalidStart.errors[0]?.code, "startStage.invalidShape");

  const started = startMinimumStage();
  const invalidInput = tickUnknown(started, { tick: 0, axes: { moveX: 2, moveY: 0 }, held: [], pressed: [], released: [] });
  assert.equal(invalidInput.ok, false);
  assert.equal(!invalidInput.ok && invalidInput.errors[0]?.code, "input.invalidShape");

  const recovered = started.tick(createEmptyInputFrame(0));
  assert.equal(recovered.ok, true);
});

test("rejects throwing runtime inputs without leaking exceptions", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const throwingStartOptions = Object.defineProperty({}, "stageId", {
    enumerable: true,
    get() {
      throw new Error("unexpected startStage getter access");
    },
  });
  const invalidStart = startStageUnknown(loaded.value, throwingStartOptions);
  assert.equal(invalidStart.ok, false);
  assert.equal(!invalidStart.ok && invalidStart.errors[0]?.code, "startStage.invalidShape");

  const started = startMinimumStage();
  const throwingInput = new Proxy(createEmptyInputFrame(0), {
    getOwnPropertyDescriptor() {
      throw new Error("unexpected input proxy access");
    },
  });
  const invalidInput = tickUnknown(started, throwingInput);
  assert.equal(invalidInput.ok, false);
  assert.equal(!invalidInput.ok && invalidInput.errors[0]?.code, "input.invalidShape");
});

test("validates startStage seed before creating a PRNG", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const blankSeed = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "   ",
  });
  assert.equal(blankSeed.ok, false);
  assert.equal(!blankSeed.ok && blankSeed.errors[0]?.code, "startStage.invalidShape");
});

test("rejects malformed startStage ids before content lookup", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const invalidStageId = loaded.value.startStage({
    stageId: "stage.",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(invalidStageId.ok, false);
  assert.equal(!invalidStageId.ok && invalidStageId.errors[0]?.code, "startStage.invalidShape");

  const invalidPlayerId = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player/unsafe" as never,
    seed: "seed-1",
  });
  assert.equal(invalidPlayerId.ok, false);
  assert.equal(!invalidPlayerId.ok && invalidPlayerId.errors[0]?.code, "startStage.invalidShape");
});

test("rejects valid startStage ids that are not available in loaded content", () => {
  const loaded = loadUnknown(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  const missingStage = loaded.value.startStage({
    stageId: "stage.missing",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(missingStage.ok, false);
  assert.equal(!missingStage.ok && missingStage.errors[0]?.code, "stage.notFound");

  const missingPlayer = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    playerId: "player.missing",
    seed: "seed-1",
  });
  assert.equal(missingPlayer.ok, false);
  assert.equal(!missingPlayer.ok && missingPlayer.errors[0]?.code, "player.notFound");

  const unsupportedDifficulty = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "hard",
    seed: "seed-1",
  });
  assert.equal(unsupportedDifficulty.ok, false);
  assert.equal(!unsupportedDifficulty.ok && unsupportedDifficulty.errors[0]?.code, "difficulty.notSupported");
});

test("canonicalizes input actions and accepts same-tick tap edges", () => {
  const sorted = startMinimumStage();
  const sortedFrame = sorted.tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["focus", "shot"],
    pressed: ["focus"],
    released: [],
  });
  assert.equal(sortedFrame.ok, true);

  const duplicated = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["shot", "shot"],
    pressed: [],
    released: [],
  });
  assert.equal(duplicated.ok, false);
  assert.equal(!duplicated.ok && duplicated.errors[0]?.code, "input.invalidShape");

  const crossed = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: [],
    pressed: ["shot"],
    released: ["shot"],
  });
  assert.equal(crossed.ok, true);
  if (!crossed.ok) {
    assert.fail("expected crossed tap edge frame");
  }
  assert.deepEqual(crossed.ok && crossed.value.events.map((event) => event.type), [
    "stageStarted",
    "playerShotsSpawnedBatch",
    "tickAdvanced",
  ]);
  assert.deepEqual(crossed.value.events[1], {
    type: "playerShotsSpawnedBatch",
    tick: 0,
    shots: [
      {
        entityId: 2,
        definitionId: "playerShot.basic",
        position: { x: 192, y: 400 },
      },
    ],
  });
  assert.deepEqual(crossed.value.state.entities.filter((entity) => entity.kind === "playerShot"), [
    {
      id: 2,
      kind: "playerShot",
      definitionId: "playerShot.basic",
      position: { x: 192, y: 392 },
    },
  ]);

  const heldReleased = startMinimumStage().tick({
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: ["shot"],
    pressed: ["shot"],
    released: ["shot"],
  });
  assert.equal(heldReleased.ok, false);
  assert.equal(!heldReleased.ok && heldReleased.errors[0]?.code, "input.invalidShape");
});

function startStageUnknown(session: LoadedGame, options: unknown) {
  return session.startStage(options as StartStageOptions);
}
