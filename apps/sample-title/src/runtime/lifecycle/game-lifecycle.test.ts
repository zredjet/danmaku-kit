import assert from "node:assert/strict";
import test from "node:test";

import { INITIAL_GAME_LIFECYCLE, transitionLifecycle } from "./game-lifecycle.ts";
import type { GameLifecycle, GameLifecycleState, LifecycleEvent } from "./game-lifecycle.ts";

function run(events: readonly LifecycleEvent[], from: GameLifecycle = INITIAL_GAME_LIFECYCLE): GameLifecycle {
  return events.reduce((lifecycle, event) => transitionLifecycle(lifecycle, event).lifecycle, from);
}

const at = (state: GameLifecycleState, pausedFrom: GameLifecycle["pausedFrom"] = null): GameLifecycle => ({ state, pausedFrom });

test("walks from booting through a stage and back to the title", () => {
  const states: GameLifecycleState[] = [];
  let lifecycle = INITIAL_GAME_LIFECYCLE;
  for (const event of [
    { type: "loadingStarted" },
    { type: "loadingFinished" },
    { type: "startRequested" },
    { type: "stageStartFinished" },
    { type: "stageEnded", outcome: "gameOver" },
    { type: "returnToTitle" },
    { type: "startRequested" },
    { type: "stageStartFinished" },
    { type: "stageEnded", outcome: "stageCleared" },
  ] as const satisfies readonly LifecycleEvent[]) {
    lifecycle = transitionLifecycle(lifecycle, event).lifecycle;
    states.push(lifecycle.state);
  }

  assert.deepEqual(states, [
    "loading",
    "title",
    "stageStarting",
    "playing",
    "gameOver",
    "title",
    "stageStarting",
    "playing",
    "stageCleared",
  ]);
});

test("pauses playing with pausedFrom and resumes only on pause, discarding input both ways", () => {
  const paused = transitionLifecycle(at("playing"), { type: "pauseToggled" });
  const stillPaused = transitionLifecycle(paused.lifecycle, { type: "focusLost" });
  const resumed = transitionLifecycle(stillPaused.lifecycle, { type: "pauseToggled" });

  assert.deepEqual(paused, { lifecycle: at("paused", "playing"), discardInput: true, suspendStartTimer: false });
  assert.deepEqual(stillPaused, { lifecycle: at("paused", "playing"), discardInput: true, suspendStartTimer: false });
  assert.deepEqual(resumed, { lifecycle: at("playing"), discardInput: true, suspendStartTimer: false });
  assert.deepEqual(transitionLifecycle(at("replayPlayback"), { type: "pauseToggled" }).lifecycle, at("paused", "replayPlayback"));
  assert.deepEqual(transitionLifecycle(at("paused", "replayPlayback"), { type: "pauseToggled" }).lifecycle, at("replayPlayback"));
});

test("pauses on focus lost only while playing and keeps the other states with their input discarded", () => {
  assert.deepEqual(transitionLifecycle(at("playing"), { type: "focusLost" }), {
    lifecycle: at("paused", "playing"),
    discardInput: true,
    suspendStartTimer: false,
  });
  assert.deepEqual(transitionLifecycle(at("stageStarting"), { type: "focusLost" }), {
    lifecycle: at("stageStarting"),
    discardInput: true,
    suspendStartTimer: true,
  });
  for (const state of ["loading", "title", "stageCleared", "gameOver", "result"] as const) {
    assert.deepEqual(transitionLifecycle(at(state), { type: "focusLost" }), {
      lifecycle: at(state),
      discardInput: true,
      suspendStartTimer: false,
    }, state);
  }
});

test("ignores events that do not apply to the current state", () => {
  const cases: readonly (readonly [GameLifecycleState, LifecycleEvent])[] = [
    ["title", { type: "pauseToggled" }],
    ["stageStarting", { type: "pauseToggled" }],
    ["gameOver", { type: "pauseToggled" }],
    ["playing", { type: "startRequested" }],
    ["paused", { type: "stageEnded", outcome: "gameOver" }],
    ["playing", { type: "returnToTitle" }],
    ["loading", { type: "startRequested" }],
    ["title", { type: "loadingFinished" }],
  ];
  for (const [state, event] of cases) {
    assert.deepEqual(transitionLifecycle(at(state), event), {
      lifecycle: at(state),
      discardInput: false,
      suspendStartTimer: false,
    }, `${state} ${event.type}`);
  }
  assert.deepEqual(run([{ type: "loadingFinished" }]), INITIAL_GAME_LIFECYCLE);
});
