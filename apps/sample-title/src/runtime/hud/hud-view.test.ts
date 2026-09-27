import assert from "node:assert/strict";
import test from "node:test";

import { createTestFrame } from "../../test-support/game-frames.ts";
import { buildHudView, buildLoadingHudView, formatLives } from "./hud-view.ts";

const frame = createTestFrame(120, { lives: 2, score: 300 });

test("shows score and lives from the frame state only during a stage", () => {
  assert.deepEqual(buildHudView("playing", frame), { score: 300, lives: 2, banner: null });
  assert.deepEqual(buildHudView("stageStarting", null), {
    score: null,
    lives: null,
    banner: { title: "READY", detail: null, tone: "info" },
  });
  assert.deepEqual(buildHudView("title", frame), {
    score: null,
    lives: null,
    banner: { title: "DANMAKU KIT", detail: "Press Enter to start", tone: "info" },
  });
});

test("names each waiting state and the stage results", () => {
  assert.deepEqual(
    (["booting", "loading", "paused", "stageCleared", "gameOver", "result"] as const).map((state) => buildHudView(state, frame).banner),
    [
      { title: "LOADING", detail: null, tone: "info" },
      { title: "LOADING", detail: null, tone: "info" },
      { title: "PAUSED", detail: "Press P or Esc to resume", tone: "info" },
      { title: "STAGE CLEAR", detail: "Press Enter to return to the title", tone: "success" },
      { title: "GAME OVER", detail: "Press Enter to return to the title", tone: "danger" },
      null,
    ],
  );
  assert.deepEqual(buildHudView("gameOver", frame).score, 300);
});

test("shows the loading progress in the loading banner", () => {
  assert.deepEqual(buildLoadingHudView("assets 50%"), {
    score: null,
    lives: null,
    banner: { title: "LOADING", detail: "assets 50%", tone: "info" },
  });
});

test("marks each life and switches to a count for many lives", () => {
  assert.deepEqual([formatLives(0), formatLives(3), formatLives(5)], ["LIVES ", "LIVES ▲▲▲", "LIVES ▲▲▲▲▲"]);
  assert.equal(formatLives(60_000), "LIVES ▲×60000");
});
