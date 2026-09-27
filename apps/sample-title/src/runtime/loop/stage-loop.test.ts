import assert from "node:assert/strict";
import test from "node:test";

import { createFakeSession } from "../../test-support/game-frames.ts";
import { startSampleTitleStage } from "../../test-support/sample-title-game.ts";
import { KeyboardInputAdapter } from "../input/keyboard-input.ts";
import { StageLoop } from "./stage-loop.ts";

const TICK_MS = 1000 / 60;

test("runs the clock's ticks in order and returns the latest frame with every event", async () => {
  const loop = new StageLoop(await startSampleTitleStage("stage-loop"), new KeyboardInputAdapter());

  const idle = loop.advance(TICK_MS / 2);
  assert.deepEqual(idle, { ok: true, latestFrame: null, latestInput: null, events: [], ticks: 0, droppedTicks: 0 });

  const step = loop.advance(TICK_MS * 3);
  assert.equal(step.ok, true);
  if (!step.ok) {
    return;
  }
  assert.equal(step.ticks, 3);
  assert.equal(step.latestFrame?.tick, 2);
  assert.equal(step.latestInput?.tick, 2);
  assert.deepEqual(step.events.map((event) => `${event.type}@${event.tick}`), [
    "stageStarted@0",
    "tickAdvanced@0",
    "tickAdvanced@1",
    "tickAdvanced@2",
  ]);

  const quiet = loop.advance(TICK_MS / 4);
  assert.equal(quiet.ok && quiet.ticks, 0);
  assert.equal(quiet.ok && quiet.latestFrame, step.latestFrame);
});

test("keeps tick numbers contiguous when a long frame drops ticks", async () => {
  const loop = new StageLoop(await startSampleTitleStage("stage-loop"), new KeyboardInputAdapter());

  const longFrame = loop.advance(1000);
  const next = loop.advance(TICK_MS);

  assert.equal(longFrame.ok && longFrame.ticks, 5);
  assert.equal(longFrame.ok && longFrame.droppedTicks, 55);
  assert.equal(next.ok && next.latestFrame?.tick, 5);
  assert.equal(loop.droppedTicksTotal, 55);
});

test("gives latched key edges to the first tick of a catch-up frame", async () => {
  const input = new KeyboardInputAdapter();
  const loop = new StageLoop(await startSampleTitleStage("stage-loop"), input);

  input.handleKeyEvent({ type: "keydown", code: "KeyZ", repeat: false, metaKey: false });
  const step = loop.advance(TICK_MS * 2);

  assert.equal(step.ok, true);
  if (!step.ok) {
    return;
  }
  assert.deepEqual(
    step.events.filter((event) => event.type === "playerShotsSpawnedBatch").map((event) => event.tick),
    [0],
  );
  assert.deepEqual(step.latestInput?.pressed, []);
  assert.deepEqual(step.latestInput?.held, ["shot"]);
});

test("discards paused time and input latches on reset", async () => {
  const input = new KeyboardInputAdapter();
  const loop = new StageLoop(await startSampleTitleStage("stage-loop"), input);

  assert.equal(loop.advance(TICK_MS * 0.9).ok, true);
  input.handleKeyEvent({ type: "keydown", code: "KeyZ", repeat: false, metaKey: false });
  loop.reset();
  const afterReset = loop.advance(TICK_MS * 0.2);
  const nextTick = loop.advance(TICK_MS);

  assert.equal(afterReset.ok && afterReset.ticks, 0);
  assert.equal(nextTick.ok && nextTick.ticks, 1);
  assert.deepEqual(nextTick.ok && nextTick.latestInput?.pressed, []);
  assert.deepEqual(nextTick.ok && nextTick.latestInput?.held, []);
});

test("stops ticking and keeps returning the error once a tick fails", () => {
  const ticked: number[] = [];
  const loop = new StageLoop(createFakeSession((tick) => (
    tick === 1 ? { ok: false, errors: [{ code: "stageSession.fatal", message: "broken" }] } : "playing"
  ), ticked), new KeyboardInputAdapter());

  const failed = loop.advance(TICK_MS * 3);
  const again = loop.advance(TICK_MS * 3);

  assert.deepEqual(failed, { ok: false, errors: [{ code: "stageSession.fatal", message: "broken" }] });
  assert.equal(again, failed);
  assert.deepEqual(ticked, [0, 1]);
});

test("stops at the tick that ends the stage and then stays idle on the last frame", () => {
  const ticked: number[] = [];
  const loop = new StageLoop(createFakeSession((tick) => tick === 2 ? "gameOver" : "playing", ticked), new KeyboardInputAdapter());

  assert.equal(loop.ended, false);
  const ending = loop.advance(TICK_MS * 5);
  const idle = loop.advance(TICK_MS * 5);

  assert.equal(ending.ok && ending.ticks, 3);
  assert.equal(ending.ok && ending.latestFrame?.state.status, "gameOver");
  assert.equal(loop.ended, true);
  assert.deepEqual(idle, {
    ok: true,
    latestFrame: ending.ok ? ending.latestFrame : null,
    latestInput: ending.ok ? ending.latestInput : null,
    events: [],
    ticks: 0,
    droppedTicks: 0,
  });
  assert.deepEqual(ticked, [0, 1, 2]);
});
