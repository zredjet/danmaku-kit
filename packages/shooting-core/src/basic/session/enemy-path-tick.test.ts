import assert from "node:assert/strict";
import test from "node:test";

import type { GameFrame } from "../api-types.ts";
import { createShootingCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { createEnemyPathDefinition } from "../test-support/definitions.ts";
import { assertSerializeOk, assertTickOk, startStageFromDefinition, startStageFromLoadedGame } from "../test-support/stage-harness.ts";

function enemyPosition(frame: GameFrame, id: number): readonly [number, number] | null {
  const enemy = frame.state.entities.find((entity) => entity.kind === "enemy" && entity.id === id);
  return enemy ? [enemy.position.x, enemy.position.y] : null;
}

function runEmptyTicks(ticks: number): GameFrame[] {
  const session = startStageFromDefinition(createEnemyPathDefinition());
  return Array.from({ length: ticks }, (_, tick) => assertTickOk(session.tick(createEmptyInputFrame(tick)), `tick ${tick}`));
}

test("moves spawned enemies along their path from the spawn tick and fires from the spawn position", () => {
  const frames = runEmptyTicks(7);

  const spawnTickEvents = frames[0]!.events;
  assert.deepEqual(
    spawnTickEvents.flatMap((event) => event.type === "entitySpawned" ? [event.position] : []),
    [{ x: 100, y: -16 }],
  );
  assert.deepEqual(
    spawnTickEvents.flatMap((event) => event.type === "enemyBulletsSpawnedBatch" ? event.bullets.map((bullet) => bullet.position) : []),
    [{ x: 100, y: -8 }],
  );
  assert.deepEqual(frames.map((frame) => enemyPosition(frame, 2)), [
    [100, -14],
    [100, -12],
    [100, -10],
    [101.5, -10],
    [103, -10],
    [103, -10],
    [103, -10],
  ]);
});

test("removes an enemy that finished its path beyond the cleanup margin without an event", () => {
  const frames = runEmptyTicks(13);

  assert.deepEqual(frames.slice(2).map((frame) => enemyPosition(frame, 4)), [
    [40, 24],
    [40, 8],
    [40, -8],
    [40, -24],
    [40, -40],
    [40, -56],
    [40, -72],
    [40, -88],
    [40, -104],
    null,
    null,
  ]);
  assert.deepEqual(frames[11]!.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(enemyPosition(frames[12]!, 2), [103, -10]);
});

test("restores enemies mid-path, after finishing and after cleanup and continues identically", () => {
  const loaded = createShootingCore("0.0.0").load(createEnemyPathDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  for (const restoreTick of [1, 3, 4, 6, 11, 12]) {
    const source = startStageFromLoadedGame(loaded.value);
    for (let tick = 0; tick < restoreTick; tick += 1) {
      assertTickOk(source.tick(createEmptyInputFrame(tick)), `source tick ${tick}`);
    }
    const snapshot = assertSerializeOk(source.serialize(), `serialize at ${restoreTick}`);
    const restored = loaded.value.restore(snapshot);
    assert.equal(restored.ok, true, `restore at ${restoreTick}: ${JSON.stringify(restored.ok ? null : restored.errors)}`);
    if (!restored.ok) {
      return;
    }

    for (let tick = restoreTick; tick < 14; tick += 1) {
      assert.deepEqual(
        assertTickOk(restored.value.tick(createEmptyInputFrame(tick)), `restored tick ${tick}`),
        assertTickOk(source.tick(createEmptyInputFrame(tick)), `source tick ${tick}`),
        `frame ${tick} after restore at ${restoreTick}`,
      );
    }
    assert.deepEqual(
      assertSerializeOk(restored.value.serialize(), "restored final serialize"),
      assertSerializeOk(source.serialize(), "source final serialize"),
    );
  }
});

test("moves an enemy along a sine offset path and restores it mid-wave", () => {
  const definition = createEnemyPathDefinition();
  const waveDefinition = {
    ...definition,
    content: {
      ...definition.content,
      paths: definition.content.paths.map((path) => path.id === "path.descend"
        ? {
          ...path,
          segments: [{
            type: "velocity" as const,
            duration: 90,
            velocity: { x: 0, y: 2 },
            offset: { type: "sine" as const, axis: "x" as const, amplitude: 24, periodTicks: 60 },
          }],
        }
        : path),
    },
  };
  const loaded = createShootingCore("0.0.0").load(waveDefinition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const source = startStageFromLoadedGame(loaded.value);
  const frames = Array.from({ length: 30 }, (_, tick) => assertTickOk(source.tick(createEmptyInputFrame(tick)), `tick ${tick}`));
  // spawn tick から 15 tick 動いた tick 14 は位相 360 step（sin 1）で、x が振幅ぶん右にずれる。
  assert.deepEqual(enemyPosition(frames[14]!, 2), [124, 14]);
  assert.deepEqual(enemyPosition(frames[29]!, 2), [100, 44]);

  const restored = loaded.value.restore(assertSerializeOk(source.serialize(), "serialize mid-wave"));
  assert.equal(restored.ok, true, JSON.stringify(restored.ok ? null : restored.errors));
  if (!restored.ok) {
    return;
  }
  for (let tick = 30; tick < 100; tick += 1) {
    assert.deepEqual(
      assertTickOk(restored.value.tick(createEmptyInputFrame(tick)), `restored tick ${tick}`),
      assertTickOk(source.tick(createEmptyInputFrame(tick)), `source tick ${tick}`),
    );
  }
});
