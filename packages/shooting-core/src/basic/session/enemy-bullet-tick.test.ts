import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { GameFrame } from "../api-types.ts";
import type { GameDefinition, StageTimelineStep } from "../content/types.ts";
import { createShootingCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import { createMovingEnemyBulletDefinition } from "../test-support/definitions.ts";
import { assertSerializeOk, assertTickOk, startStageFromDefinition, startStageFromLoadedGame } from "../test-support/stage-harness.ts";

function bulletPosition(frame: GameFrame, id: number): readonly [number, number] | null {
  const bullet = frame.state.entities.find((entity) => entity.kind === "enemyBullet" && entity.id === id);
  return bullet ? [bullet.position.x, bullet.position.y] : null;
}

function runEmptyTicks(definition: GameDefinition, ticks: number): GameFrame[] {
  const session = startStageFromDefinition(definition);
  return Array.from({ length: ticks }, (_, tick) => assertTickOk(session.tick(createEmptyInputFrame(tick)), `tick ${tick}`));
}

test("moves enemy bullets from the spawn tick while the spawn event keeps the spawn position", () => {
  const frames = runEmptyTicks(createMovingEnemyBulletDefinition(), 3);

  assert.deepEqual(
    frames[0]!.events.flatMap((event) => event.type === "enemyBulletsSpawnedBatch" ? event.bullets.map((bullet) => bullet.position) : []),
    [{ x: 192, y: 108 }, { x: 50, y: 100 }],
  );
  assert.deepEqual(frames.map((frame) => [bulletPosition(frame, 4), bulletPosition(frame, 5)]), [
    [[192, 114], [50, 92]],
    [[192, 120], [50, 84]],
    [[192, 126], [50, 76]],
  ]);
});

test("removes an enemy bullet beyond the cleanup margin without an event", () => {
  const frames = runEmptyTicks(createMovingEnemyBulletDefinition(), 18);

  assert.deepEqual(bulletPosition(frames[15]!, 5), [50, -28]);
  assert.equal(bulletPosition(frames[16]!, 5), null);
  assert.deepEqual(frames[16]!.events.map((event) => event.type), ["tickAdvanced"]);
});

test("hits the player with the moved enemy bullet position", () => {
  const frames = runEmptyTicks(createMovingEnemyBulletDefinition(), 48);

  assert.deepEqual(frames[46]!.events.map((event) => event.type), ["tickAdvanced"]);
  assert.deepEqual(frames[47]!.events.map((event) => event.type), ["playerHit", "entityDestroyed", "tickAdvanced"]);
  assert.equal(frames[47]!.state.player.lives, 2);
  assert.equal(bulletPosition(frames[47]!, 4), null);
});

test("restores moving enemy bullets and continues identically", () => {
  const loaded = createShootingCore("0.0.0").load(createMovingEnemyBulletDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  for (const restoreTick of [1, 10, 17, 30]) {
    const source = startStageFromLoadedGame(loaded.value);
    for (let tick = 0; tick < restoreTick; tick += 1) {
      assertTickOk(source.tick(createEmptyInputFrame(tick)), `source tick ${tick}`);
    }
    const restored = loaded.value.restore(assertSerializeOk(source.serialize(), `serialize at ${restoreTick}`));
    assert.equal(restored.ok, true, `restore at ${restoreTick}: ${JSON.stringify(restored.ok ? null : restored.errors)}`);
    if (!restored.ok) {
      return;
    }

    for (let tick = restoreTick; tick < 50; tick += 1) {
      assert.deepEqual(
        assertTickOk(restored.value.tick(createEmptyInputFrame(tick)), `restored tick ${tick}`),
        assertTickOk(source.tick(createEmptyInputFrame(tick)), `source tick ${tick}`),
        `frame ${tick} after restore at ${restoreTick}`,
      );
    }
  }
});

test("latches a fatal error instead of dropping bullets when the active enemy bullet budget would be exceeded", () => {
  const definition = createMinimumDefinition();
  // 1 tick に 100 体（MAX_SPAWNS_PER_TICK）の enemy が静止した敵弾を 1 発ずつ撃つ。20 tick で 2,000 発になる。
  const timeline: StageTimelineStep[] = Array.from({ length: 2_100 }, (_, index) => ({
    tick: Math.floor(index / 100),
    action: {
      type: "spawnEnemy",
      enemy: "enemy.scout",
      path: "path.none",
      pattern: "pattern.spawn_bullet",
      position: { x: 10 + (index % 100) * 3, y: 40 + Math.floor(index / 100) * 8 },
    },
  }));
  const session = startStageFromDefinition({
    ...definition,
    content: {
      ...definition.content,
      stages: [{ ...definition.content.stages[0]!, timeline }],
      patterns: [
        ...definition.content.patterns,
        { id: "pattern.spawn_bullet", version: 1, fireOnSpawn: { bullet: "bullet.red_small", offset: { x: 0, y: 0 } } },
      ],
    },
  });

  let lastFrame: GameFrame | null = null;
  for (let tick = 0; tick < 20; tick += 1) {
    lastFrame = assertTickOk(session.tick(createEmptyInputFrame(tick)), `tick ${tick}`);
  }
  assert.equal(lastFrame?.state.entities.filter((entity) => entity.kind === "enemyBullet").length, 2_000);

  const exceeded = session.tick(createEmptyInputFrame(20));
  assert.equal(exceeded.ok, false);
  assert.equal(!exceeded.ok && exceeded.errors[0]?.code, "stageSession.fatal");
  assert.match(!exceeded.ok ? exceeded.errors[0]?.message ?? "" : "", /enemyBullet\.budgetExceeded: Active enemy bullets would exceed 2000: 2000 \+ 100/);
  assert.deepEqual(session.tick(createEmptyInputFrame(20)), exceeded);
});
