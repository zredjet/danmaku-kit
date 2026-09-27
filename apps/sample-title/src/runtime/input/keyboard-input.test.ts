import assert from "node:assert/strict";
import test from "node:test";

import type { GameEvent, InputFrame } from "@danmaku-kit/core";

import { startSampleTitleStage } from "../../test-support/sample-title-game.ts";
import { KeyboardInputAdapter } from "./keyboard-input.ts";

function press(adapter: KeyboardInputAdapter, code: string, repeat = false): void {
  adapter.handleKeyEvent({ type: "keydown", code, repeat, metaKey: false });
}

function release(adapter: KeyboardInputAdapter, code: string): void {
  adapter.handleKeyEvent({ type: "keyup", code, repeat: false, metaKey: false });
}

/** 1 tick 分の frame を取り出し、tick と axes を除いた action の組を比べやすい形にする。 */
function sampleActions(adapter: KeyboardInputAdapter, tick = 0): Pick<InputFrame, "held" | "pressed" | "released"> {
  const [frame] = adapter.sampleTicks(tick, 1);
  assert.ok(frame);
  return { held: frame.held, pressed: frame.pressed, released: frame.released };
}

test("reports a held key's press and release edges once and keeps it held in between", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "KeyZ");
  assert.deepEqual(sampleActions(adapter, 0), { held: ["shot"], pressed: ["shot"], released: [] });
  press(adapter, "KeyZ", true);
  assert.deepEqual(sampleActions(adapter, 1), { held: ["shot"], pressed: [], released: [] });
  release(adapter, "KeyZ");
  assert.deepEqual(sampleActions(adapter, 2), { held: [], pressed: [], released: ["shot"] });
  assert.deepEqual(sampleActions(adapter, 3), { held: [], pressed: [], released: [] });
});

test("keeps a tap finished between samples as pressed and released without held", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "KeyZ");
  release(adapter, "KeyZ");

  assert.deepEqual(sampleActions(adapter), { held: [], pressed: ["shot"], released: ["shot"] });
});

test("latches edges until a tick runs and gives them only to the first catch-up tick", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "KeyZ");
  press(adapter, "ArrowLeft");
  assert.deepEqual(adapter.sampleTicks(7, 0), []);
  const frames = adapter.sampleTicks(7, 3);

  assert.deepEqual(frames.map((frame) => frame.tick), [7, 8, 9]);
  assert.deepEqual(frames.map((frame) => frame.pressed), [["shot"], [], []]);
  assert.deepEqual(frames.map((frame) => frame.held), [["shot"], ["shot"], ["shot"]]);
  assert.deepEqual(frames.map((frame) => frame.axes), [
    { moveX: -1, moveY: 0 },
    { moveX: -1, moveY: 0 },
    { moveX: -1, moveY: 0 },
  ]);
  assert.equal(Object.isFrozen(frames), true);
  assert.equal(frames.every((frame) => Object.isFrozen(frame) && Object.isFrozen(frame.axes)), true);
});

test("derives axes from held directions and cancels opposite directions", () => {
  const adapter = new KeyboardInputAdapter();
  const axes = (): InputFrame["axes"] => adapter.sampleTicks(0, 1)[0]!.axes;

  press(adapter, "ArrowLeft");
  press(adapter, "ArrowUp");
  assert.deepEqual(axes(), { moveX: -1, moveY: -1 });
  press(adapter, "ArrowRight");
  press(adapter, "ArrowDown");
  assert.deepEqual(axes(), { moveX: 0, moveY: 0 });
  release(adapter, "ArrowLeft");
  release(adapter, "ArrowUp");
  assert.deepEqual(axes(), { moveX: 1, moveY: 1 });
});

test("treats every key bound to one action as the same held action", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "ShiftLeft");
  press(adapter, "ShiftRight");
  assert.deepEqual(sampleActions(adapter), { held: ["focus"], pressed: ["focus"], released: [] });
  release(adapter, "ShiftLeft");
  assert.deepEqual(sampleActions(adapter), { held: ["focus"], pressed: [], released: [] });
  release(adapter, "ShiftRight");
  assert.deepEqual(sampleActions(adapter), { held: [], pressed: [], released: ["focus"] });
});

test("drops the release edge when an action is pressed again before the next tick", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "KeyZ");
  sampleActions(adapter);
  release(adapter, "KeyZ");
  press(adapter, "KeyZ");

  assert.deepEqual(sampleActions(adapter), { held: ["shot"], pressed: ["shot"], released: [] });
});

test("discards latches and key state on reset and ignores the auto-repeat of keys held across it", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "KeyZ");
  press(adapter, "ArrowLeft");
  press(adapter, "Escape");
  adapter.reset();
  assert.deepEqual(adapter.sampleTicks(0, 1)[0], {
    tick: 0,
    axes: { moveX: 0, moveY: 0 },
    held: [],
    pressed: [],
    released: [],
  });
  assert.deepEqual(adapter.takeUiInput(), { pressed: [] });

  press(adapter, "KeyZ", true);
  press(adapter, "ArrowRight", true);
  assert.deepEqual(adapter.sampleTicks(1, 1)[0]?.axes, { moveX: 0, moveY: 0 });
  assert.deepEqual(sampleActions(adapter, 1), { held: [], pressed: [], released: [] });
  release(adapter, "KeyZ");
  release(adapter, "ArrowRight");
  assert.deepEqual(sampleActions(adapter, 2), { held: [], pressed: [], released: [] });
  press(adapter, "KeyZ");
  assert.deepEqual(sampleActions(adapter, 3), { held: ["shot"], pressed: ["shot"], released: [] });
});

test("accepts a new press after reset even when the key's release happened out of focus", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "KeyZ");
  adapter.reset();
  // KeyZ の keyup は focus 外で起き、page には届かない。
  press(adapter, "KeyZ");
  assert.deepEqual(sampleActions(adapter, 0), { held: ["shot"], pressed: ["shot"], released: [] });
  release(adapter, "KeyZ");
  assert.deepEqual(sampleActions(adapter, 1), { held: [], pressed: [], released: ["shot"] });
});

test("ignores keys pressed with Meta because macOS never sends their keyup", () => {
  const adapter = new KeyboardInputAdapter();
  const withMeta = (type: "keydown" | "keyup", code: string): boolean =>
    adapter.handleKeyEvent({ type, code, repeat: false, metaKey: true });

  press(adapter, "ArrowLeft");
  assert.deepEqual(adapter.sampleTicks(0, 1)[0]?.axes, { moveX: -1, moveY: 0 });
  assert.equal(withMeta("keydown", "MetaLeft"), false);
  assert.equal(withMeta("keydown", "KeyZ"), true);
  assert.deepEqual(adapter.sampleTicks(1, 1)[0]?.axes, { moveX: 0, moveY: 0 });
  assert.deepEqual(sampleActions(adapter, 1), { held: [], pressed: [], released: [] });

  // Meta を離した後も押され続けている ArrowLeft の auto-repeat は keyup まで無視し、keyup が来ない KeyZ は次の押下で戻る。
  release(adapter, "MetaLeft");
  press(adapter, "ArrowLeft", true);
  assert.deepEqual(adapter.sampleTicks(2, 1)[0]?.axes, { moveX: 0, moveY: 0 });
  release(adapter, "ArrowLeft");
  press(adapter, "KeyZ");
  assert.deepEqual(sampleActions(adapter, 3), { held: ["shot"], pressed: ["shot"], released: [] });
});

test("routes UI actions to the UI input frame and keeps them out of gameplay input", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "Escape");
  release(adapter, "Escape");
  press(adapter, "KeyP");
  assert.deepEqual(sampleActions(adapter), { held: [], pressed: [], released: [] });
  assert.deepEqual(adapter.takeUiInput(), { pressed: ["pause"] });
  release(adapter, "KeyP");
  press(adapter, "Escape");
  assert.deepEqual(adapter.takeUiInput(), { pressed: ["pause"] });
  assert.deepEqual(adapter.takeUiInput(), { pressed: [] });
});

test("ignores unbound keys and event types other than keydown and keyup", () => {
  const adapter = new KeyboardInputAdapter();

  press(adapter, "KeyQ");
  adapter.handleKeyEvent({ type: "keypress", code: "KeyZ", repeat: false, metaKey: false });

  assert.deepEqual(sampleActions(adapter), { held: [], pressed: [], released: [] });
});

test("rejects tick ranges that Core cannot accept", () => {
  const adapter = new KeyboardInputAdapter();

  assert.throws(() => adapter.sampleTicks(-1, 1), RangeError);
  assert.throws(() => adapter.sampleTicks(0.5, 1), RangeError);
  assert.throws(() => adapter.sampleTicks(0, -1), RangeError);
});

test("produces frames that the Core stage session accepts as player input", async () => {
  const session = await startSampleTitleStage("keyboard-input");
  const adapter = new KeyboardInputAdapter();
  const events: GameEvent["type"][] = [];
  const playerPositions: { x: number; y: number }[] = [];
  let nextTick = 0;
  const runTicks = (count: number): void => {
    for (const frame of adapter.sampleTicks(nextTick, count)) {
      const result = session.tick(frame);
      assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.errors));
      if (!result.ok) {
        return;
      }
      events.push(...result.value.events.map((event) => event.type));
      const player = result.value.state.entities.find((entity) => entity.kind === "player");
      assert.ok(player);
      playerPositions.push({ x: player.position.x, y: player.position.y });
      nextTick += 1;
    }
  };

  press(adapter, "KeyZ");
  press(adapter, "ArrowRight");
  runTicks(3);
  press(adapter, "ShiftLeft");
  release(adapter, "KeyZ");
  press(adapter, "KeyZ");
  runTicks(2);
  release(adapter, "KeyZ");
  press(adapter, "KeyZ");
  release(adapter, "KeyZ");
  runTicks(1);
  adapter.reset();
  runTicks(2);

  assert.equal(nextTick, 8);
  assert.equal(events.includes("playerShotsSpawnedBatch"), true);
  assert.ok(playerPositions[4]!.x > playerPositions[0]!.x);
  assert.deepEqual(playerPositions[7], playerPositions[6]);
});

test("counts latched edges until a tick or a render frame consumes them", () => {
  const input = new KeyboardInputAdapter();
  input.handleKeyEvent({ type: "keydown", code: "KeyZ", repeat: false, metaKey: false });
  input.handleKeyEvent({ type: "keyup", code: "KeyZ", repeat: false, metaKey: false });
  input.handleKeyEvent({ type: "keydown", code: "KeyP", repeat: false, metaKey: false });
  assert.equal(input.latchedEdgeCount, 3);

  input.sampleTicks(0, 1);
  assert.equal(input.latchedEdgeCount, 1);
  input.takeUiInput();
  assert.equal(input.latchedEdgeCount, 0);
});
