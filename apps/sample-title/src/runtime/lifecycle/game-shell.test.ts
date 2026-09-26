import assert from "node:assert/strict";
import test from "node:test";

import type { CoreResult, GameFrame, InputFrame, LoadedGame, StageSession, StartStageOptions } from "@shooting-sample/shooting-core";

import { loadSampleTitleGame } from "../../test-support/sample-title-game.ts";
import { KeyboardInputAdapter } from "../input/keyboard-input.ts";
import { GameShell, type GameShellStep } from "./game-shell.ts";

const TICK_MS = 1000 / 60;
const START_MS = 100;

type StageEnd = Readonly<{ tick: number; status: "stageCleared" | "gameOver" }>;

/** `end.tick` の tick で `end.status` になる session を返す `LoadedGame` と、始めた stage の seed の記録。 */
function createScriptedGame(end: StageEnd | null = null) {
  const seeds: string[] = [];
  const loadedGame: Pick<LoadedGame, "startStage"> = {
    startStage(options: StartStageOptions): CoreResult<StageSession> {
      seeds.push(options.seed);
      return {
        ok: true,
        value: {
          tick: (input: InputFrame) => ({ ok: true, value: scriptedFrame(input.tick, end), warnings: [] }),
          serialize: () => assert.fail("serialize is not used"),
        },
        warnings: [],
      };
    },
  };
  return { loadedGame, seeds };
}

function scriptedFrame(tick: number, end: StageEnd | null): GameFrame {
  const status = end !== null && tick >= end.tick ? end.status : "playing";
  return {
    tick,
    state: {
      tick,
      stageId: "stage.scripted",
      playerId: "player.scripted",
      status,
      player: { lives: 2, invincibleTicksRemaining: 0 },
      score: tick * 10,
      entities: [],
    },
    events: [{ type: "tickAdvanced", tick }],
  } as unknown as GameFrame;
}

function createShell(loadedGame: Pick<LoadedGame, "startStage">) {
  const input = new KeyboardInputAdapter();
  let started = 0;
  const shell = new GameShell({
    loadedGame,
    stage: { stageId: "stage.stage_01", difficulty: "normal" },
    nextSeed: () => `seed-${started += 1}`,
    input,
    startDurationMs: START_MS,
  });
  return { shell, input };
}

function press(input: KeyboardInputAdapter, code: string): void {
  input.handleKeyEvent({ type: "keydown", code, repeat: false, metaKey: false });
  input.handleKeyEvent({ type: "keyup", code, repeat: false, metaKey: false });
}

function expectOk(step: GameShellStep): Extract<GameShellStep, { ok: true }> {
  if (!step.ok) {
    return assert.fail(JSON.stringify(step.errors));
  }
  return step;
}

/** loading を終えて title にいる shell。 */
function createShellAtTitle(end: StageEnd | null = null) {
  const game = createScriptedGame(end);
  const created = createShell(game.loadedGame);
  created.shell.beginLoading();
  created.shell.finishLoading();
  return { ...created, seeds: game.seeds };
}

/** title で confirm を押し、開始演出を終えて playing にいる shell。 */
function createPlayingShell(end: StageEnd | null = null) {
  const created = createShellAtTitle(end);
  press(created.input, "Enter");
  created.shell.advance(0);
  created.shell.advance(START_MS);
  assert.equal(created.shell.lifecycle.state, "playing");
  return created;
}

test("loads into the title and ignores UI actions pressed while loading", () => {
  const { loadedGame, seeds } = createScriptedGame();
  const { shell, input } = createShell(loadedGame);
  assert.equal(shell.lifecycle.state, "booting");

  shell.beginLoading();
  press(input, "Enter");
  const loading = expectOk(shell.advance(TICK_MS));
  shell.finishLoading();
  const title = expectOk(shell.advance(TICK_MS));

  assert.equal(loading.lifecycle.state, "loading");
  assert.deepEqual(
    { state: title.lifecycle.state, seed: title.seed, frame: title.frame, ticks: title.ticks, stageChanged: title.stageChanged },
    { state: "title", seed: null, frame: null, ticks: 0, stageChanged: false },
  );
  assert.deepEqual(seeds, []);
});

test("starts a stage from the title, shows the start timer, then runs ticks", () => {
  const { shell, input, seeds } = createShellAtTitle();

  press(input, "Enter");
  const starting = expectOk(shell.advance(START_MS / 2));
  const stillStarting = expectOk(shell.advance(START_MS / 4));
  const started = expectOk(shell.advance(START_MS / 4));
  const playing = expectOk(shell.advance(TICK_MS * 2));

  assert.deepEqual(seeds, ["seed-1"]);
  assert.deepEqual(
    [starting, stillStarting, started].map((step) => [step.lifecycle.state, step.stageChanged, step.ticks, step.seed]),
    [["stageStarting", true, 0, "seed-1"], ["stageStarting", false, 0, "seed-1"], ["playing", false, 0, "seed-1"]],
  );
  assert.equal(playing.ticks, 2);
  assert.equal(playing.frame?.tick, 1);
  assert.deepEqual(playing.events.map((event) => event.tick), [0, 1]);
});

test("pauses with the pause action, runs no ticks while paused and drops the paused time", () => {
  const { shell, input } = createPlayingShell();
  expectOk(shell.advance(TICK_MS));

  press(input, "KeyP");
  const paused = expectOk(shell.advance(1000));
  press(input, "Escape");
  const resumed = expectOk(shell.advance(TICK_MS));

  assert.deepEqual([paused.lifecycle, paused.ticks, paused.frame?.tick], [{ state: "paused", pausedFrom: "playing" }, 0, 0]);
  assert.deepEqual([resumed.lifecycle.state, resumed.ticks, resumed.frame?.tick], ["playing", 1, 1]);
});

test("pauses on focus lost while playing and holds the start timer while starting", () => {
  const playing = createPlayingShell();
  playing.shell.loseFocus();
  assert.deepEqual(playing.shell.lifecycle, { state: "paused", pausedFrom: "playing" });
  press(playing.input, "Enter");
  assert.equal(expectOk(playing.shell.advance(TICK_MS)).lifecycle.state, "paused");

  const starting = createShellAtTitle();
  press(starting.input, "Enter");
  starting.shell.advance(START_MS / 2);
  starting.shell.loseFocus();
  // focus が戻った最初の frame の経過時間（focus 外の時間を含む）は数えない。
  const afterFocus = expectOk(starting.shell.advance(START_MS * 10));
  const finished = expectOk(starting.shell.advance(START_MS / 2));

  assert.deepEqual([afterFocus.lifecycle.state, finished.lifecycle.state], ["stageStarting", "playing"]);
});

test("ends the stage on the Core's final frame and returns to the title for a new seed", () => {
  const { shell, input, seeds } = createPlayingShell({ tick: 1, status: "gameOver" });

  const ended = expectOk(shell.advance(TICK_MS * 5));
  const afterEnd = expectOk(shell.advance(TICK_MS * 5));
  press(input, "Enter");
  const title = expectOk(shell.advance(TICK_MS));
  press(input, "Space");
  const restarted = expectOk(shell.advance(0));

  assert.deepEqual([ended.lifecycle.state, ended.ticks, ended.frame?.state.status], ["gameOver", 2, "gameOver"]);
  assert.deepEqual([afterEnd.lifecycle.state, afterEnd.ticks, afterEnd.frame?.tick], ["gameOver", 0, 1]);
  assert.deepEqual([title.lifecycle.state, title.stageChanged, title.frame, title.seed], ["title", true, null, null]);
  assert.deepEqual([restarted.lifecycle.state, restarted.stageChanged, restarted.frame], ["stageStarting", true, null]);
  assert.deepEqual(seeds, ["seed-1", "seed-2"]);
});

test("keeps returning the Core errors after a tick or a stage start fails", () => {
  const error = { code: "input.invalid", message: "broken", severity: "error" };
  const failingTick: Pick<LoadedGame, "startStage"> = {
    startStage: () => ({
      ok: true,
      value: { tick: () => ({ ok: false, errors: [error] }), serialize: () => assert.fail("unused") },
    } as unknown as CoreResult<StageSession>),
  };
  const ticking = createShell(failingTick);
  ticking.shell.beginLoading();
  ticking.shell.finishLoading();
  press(ticking.input, "Enter");
  ticking.shell.advance(START_MS);
  ticking.shell.advance(0);
  assert.equal(ticking.shell.lifecycle.state, "playing");
  assert.deepEqual(ticking.shell.advance(TICK_MS), { ok: false, errors: [error] });
  assert.deepEqual(ticking.shell.advance(TICK_MS), { ok: false, errors: [error] });

  const failingStart = createShell({ startStage: () => ({ ok: false, errors: [error] } as unknown as CoreResult<StageSession>) });
  failingStart.shell.beginLoading();
  failingStart.shell.finishLoading();
  press(failingStart.input, "Enter");
  assert.deepEqual(failingStart.shell.advance(0), { ok: false, errors: [error] });
});

test("runs the sample title stage from the title with the Core", async () => {
  const { shell, input } = createShell(await loadSampleTitleGame());
  shell.beginLoading();
  shell.finishLoading();

  press(input, "Enter");
  shell.advance(START_MS);
  shell.advance(0);
  const step = expectOk(shell.advance(TICK_MS * 3));

  assert.equal(step.frame?.tick, 2);
  assert.equal(step.frame?.state.player.lives, 3);
  assert.deepEqual(step.events.slice(0, 2).map((event) => event.type), ["stageStarted", "tickAdvanced"]);
});
