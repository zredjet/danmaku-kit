import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../tests/fixtures/minimum-game-definition.ts";
import { createShootingCore } from "./core.ts";
import { createEmptyInputFrame } from "./input/input-frame.ts";
import { createCollisionScoreDefinition } from "./test-support/definitions.ts";
import { createShotInputFrame } from "./test-support/input-frames.ts";
import { startMinimumStage, startStageFromDefinition } from "./test-support/stage-harness.ts";

test("loads valid minimum content and advances deterministic ticks", () => {
  const loaded = createShootingCore("0.0.0").load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(loaded.ok && Object.isFrozen(loaded.warnings), true);

  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  assert.equal(Object.isFrozen(loaded.value), true);

  const started = loaded.value.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  assert.equal(Object.isFrozen(started), true);

  if (!started.ok) {
    assert.fail("expected stage session");
  }
  assert.equal(Object.isFrozen(started.value), true);

  const frame0 = started.value.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);
  assert.equal(Object.isFrozen(frame0), true);
  assert.equal(frame0.ok && frame0.value.tick, 0);
  assert.deepEqual(frame0.ok && frame0.value.events.map((event) => event.type), [
    "stageStarted",
    "tickAdvanced",
  ]);
  assert.deepEqual(frame0.ok && frame0.value.state.entities, [
    {
      id: 1,
      kind: "player",
      definitionId: "player.default",
      position: { x: 192, y: 400 },
    },
  ]);

  const frame1 = started.value.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.equal(frame1.ok && frame1.value.state.score, 0);
});

test("returns identical frames for identical seed and input sequence", () => {
  const first = startMinimumStage();
  const second = startMinimumStage();

  for (let tick = 0; tick <= 60; tick += 1) {
    const input = tick % 10 === 0 ? createShotInputFrame(tick) : createEmptyInputFrame(tick);
    const firstFrame = first.tick(input);
    const secondFrame = second.tick(input);

    assert.equal(firstFrame.ok, true);
    assert.equal(secondFrame.ok, true);
    assert.deepEqual(firstFrame.ok && firstFrame.value, secondFrame.ok && secondFrame.value);
  }
});

test("returns identical frames when collision and score occur", () => {
  const first = startStageFromDefinition(createCollisionScoreDefinition());
  const second = startStageFromDefinition(createCollisionScoreDefinition());

  for (const input of [createShotInputFrame(0), createEmptyInputFrame(1)]) {
    const firstFrame = first.tick(input);
    const secondFrame = second.tick(input);

    assert.equal(firstFrame.ok, true);
    assert.equal(secondFrame.ok, true);
    assert.deepEqual(firstFrame.ok && firstFrame.value, secondFrame.ok && secondFrame.value);
  }
});

test("returns immutable event frames and drains one-shot events", () => {
  const started = startMinimumStage();

  const frame0 = started.tick(createEmptyInputFrame(0));
  assert.equal(frame0.ok, true);
  if (!frame0.ok) {
    assert.fail("expected frame");
  }
  assert.equal(Object.isFrozen(frame0.value.events), true);
  assert.equal(Object.isFrozen(frame0.value.events[0]), true);

  const frame1 = started.tick(createEmptyInputFrame(1));
  assert.equal(frame1.ok, true);
  assert.deepEqual(frame1.ok && frame1.value.events.map((event) => event.type), ["tickAdvanced"]);
});
