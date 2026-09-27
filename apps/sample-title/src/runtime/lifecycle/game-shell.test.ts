import assert from "node:assert/strict";
import test from "node:test";

import type { CoreError, CoreResult, LoadedGame, StageSession, StartStageOptions } from "@shooting-sample/shooting-core";

import { createFakeSession } from "../../test-support/game-frames.ts";
import { digestSerializedState, runHeadlessReplay, serializedStateDigest } from "../../test-support/headless-replay.ts";
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
      const session = createFakeSession((tick) => end !== null && tick >= end.tick ? end.status : "playing");
      return { ok: true, value: session, warnings: [] };
    },
  };
  return { loadedGame, seeds };
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

test("does not carry a confirm pressed during loading into the title when loading never advanced the shell", () => {
  const { loadedGame, seeds } = createScriptedGame();
  const { shell, input } = createShell(loadedGame);

  // stage scene は view pool を作り終えるまで shell を進めないため、loading 中の押下はラッチされたまま finishLoading() に届く。
  shell.beginLoading();
  press(input, "Enter");
  shell.finishLoading();
  const title = expectOk(shell.advance(TICK_MS));

  assert.equal(title.lifecycle.state, "title");
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
  // window が表示されたまま focus だけを失っても render frame は届くが、focus が戻るまで開始演出を進めない。
  const unfocused = [expectOk(starting.shell.advance(START_MS * 10)), expectOk(starting.shell.advance(START_MS * 10))];
  starting.shell.regainFocus();
  // focus が戻った最初の frame の経過時間（focus 外の時間を含む）は数えない。
  const afterFocus = expectOk(starting.shell.advance(START_MS * 10));
  const finished = expectOk(starting.shell.advance(START_MS / 2));

  assert.deepEqual(
    [...unfocused.map((step) => step.lifecycle.state), afterFocus.lifecycle.state, finished.lifecycle.state],
    ["stageStarting", "stageStarting", "stageStarting", "playing"],
  );

  // focus が戻っても paused からは再開しない。
  playing.shell.regainFocus();
  assert.equal(expectOk(playing.shell.advance(TICK_MS)).lifecycle.state, "paused");
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

test("toggles the debug overlay in any state without changing the lifecycle", () => {
  const { shell, input } = createShellAtTitle();
  assert.equal(shell.debugOverlay, false);

  press(input, "Backquote");
  const title = expectOk(shell.advance(TICK_MS));
  press(input, "Enter");
  press(input, "F3");
  const starting = expectOk(shell.advance(TICK_MS));

  assert.deepEqual([title.lifecycle.state, title.debugOverlay], ["title", true]);
  assert.deepEqual([starting.lifecycle.state, starting.debugOverlay], ["stageStarting", false]);

  const visible = new GameShell({
    loadedGame: createScriptedGame().loadedGame,
    stage: { stageId: "stage.stage_01", difficulty: "normal" },
    nextSeed: () => "seed",
    input: new KeyboardInputAdapter(),
    debugOverlay: true,
  });
  assert.equal(expectOk(visible.advance(0)).debugOverlay, true);
});

test("keeps returning the Core errors after a tick or a stage start fails", () => {
  const error: CoreError = { code: "stageSession.fatal", message: "broken" };
  const failingTick: Pick<LoadedGame, "startStage"> = {
    startStage: () => ({ ok: true, value: createFakeSession(() => ({ ok: false, errors: [error] })), warnings: [] }),
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

  const failingStart = createShell({ startStage: () => ({ ok: false, errors: [error] }) });
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

test("records the inputs the Core accepted so a headless replay reaches the same state", async () => {
  const game = await loadSampleTitleGame();
  const input = new KeyboardInputAdapter();
  const create = (recordInputs: boolean) => new GameShell({
    loadedGame: game,
    stage: { stageId: "stage.stage_01", difficulty: "normal" },
    nextSeed: () => "replay-record",
    input,
    startDurationMs: START_MS,
    recordInputs,
  });
  const key = (type: "keydown" | "keyup", code: string) => input.handleKeyEvent({ type, code, repeat: false, metaKey: false });
  const shell = create(true);
  shell.beginLoading();
  shell.finishLoading();
  assert.equal(shell.replayRecord(), null);

  press(input, "Enter");
  shell.advance(START_MS);
  shell.advance(0);
  key("keydown", "KeyZ");
  key("keydown", "ArrowLeft");
  shell.advance(TICK_MS * 30);
  key("keyup", "ArrowLeft");
  key("keydown", "ArrowRight");
  shell.advance(TICK_MS * 45);
  const record = shell.replayRecord();
  assert.ok(record !== null);

  const replay = runHeadlessReplay(game, record.stage, record.inputs);
  assert.deepEqual(record.stage, { stageId: "stage.stage_01", difficulty: "normal", seed: "replay-record" });
  assert.equal(record.inputs.length, shell.latestFrame!.tick + 1);
  assert.deepEqual(replay.frames.at(-1), shell.latestFrame);
  assert.equal(serializedStateDigest(replay.session), digestSerializedState(record.state));

  const unrecorded = create(false);
  unrecorded.beginLoading();
  unrecorded.finishLoading();
  press(input, "Enter");
  unrecorded.advance(START_MS);
  unrecorded.advance(TICK_MS);
  assert.equal(unrecorded.replayRecord(), null);
});
