import assert from "node:assert/strict";
import test from "node:test";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { GameFrame } from "../api-types.ts";
import type { GameDefinition } from "../content/types.ts";
import { createShootingCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { InputFrame } from "../input/input-frame.ts";
import { angleStepsOfVector } from "../simulation/deterministic-trig.ts";
import {
  createDestroyedPatternEnemyDefinition,
  createEnemyPatternDefinition,
  createExitingPatternEnemyDefinition,
} from "../test-support/definitions.ts";
import { tableVelocity } from "../test-support/geometry.ts";
import { createMoveInputFrame, createShotInputFrame } from "../test-support/input-frames.ts";
import { assertSerializeOk, assertTickOk, startStageFromDefinition } from "../test-support/stage-harness.ts";

function spawnedBatches(frames: readonly GameFrame[]) {
  return frames.map((frame) => frame.events.flatMap((event) => event.type === "enemyBulletsSpawnedBatch"
    ? event.bullets.map((bullet) => [bullet.entityId, bullet.position.x, bullet.position.y])
    : []));
}

function runTicks(definition: GameDefinition, inputs: readonly InputFrame[]) {
  const session = startStageFromDefinition(definition);
  const frames = inputs.map((input) => assertTickOk(session.tick(input), `tick ${input.tick}`));
  return { session, frames };
}

function emptyInputs(ticks: number): InputFrame[] {
  return Array.from({ length: ticks }, (_, tick) => createEmptyInputFrame(tick));
}

test("fires pattern bullets from the spawn tick after fireOnSpawn bullets and in enemy id order", () => {
  const { frames } = runTicks(createEnemyPatternDefinition(), emptyInputs(6));

  assert.deepEqual(spawnedBatches(frames), [
    [[4, 100, 50], [5, 100, 50], [6, 100, 50], [7, 100, 50]],
    [],
    [[8, 192, 100], [9, 192, 100], [10, 192, 100]],
    [],
    [
      [13, 300, 68],
      [14, 100, 50], [15, 100, 50], [16, 100, 50], [17, 100, 50],
      [18, 250, 80], [19, 250, 80], [20, 250, 80], [21, 250, 80],
    ],
    [[22, 192, 100], [23, 192, 100], [24, 192, 100]],
  ]);
  assert.deepEqual(frames[4]!.events.map((event) => event.type), [
    "entitySpawned",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "tickAdvanced",
  ]);
});

test("moves pattern bullets along table directions scaled by their speed from the fire tick", () => {
  const { session } = runTicks(createEnemyPatternDefinition(), emptyInputs(6));
  const bullets = new Map(assertSerializeOk(session.serialize(), "serialize").state.runtimeEntities.flatMap((entity) => (
    entity.kind === "enemyBullet" ? [[entity.id, entity] as const] : []
  )));

  // ring は 90° を中心に 90° の範囲へ 4 発（45°, 75°, 105°, 135°）、aim は真下の自機へ 24° の範囲に 3 発を並べる。
  assert.deepEqual([4, 5, 6, 7].map((id) => bullets.get(id)?.velocity), [180, 300, 420, 540].map((steps) => tableVelocity(steps, 1)));
  assert.deepEqual([8, 9, 10].map((id) => bullets.get(id)?.velocity), [312, 360, 408].map((steps) => tableVelocity(steps, 2)));
  assert.deepEqual(bullets.get(9), {
    id: 9,
    kind: "enemyBullet",
    definitionId: "bullet.red_small",
    position: { x: 192, y: 108 },
    collisionRadius: 4,
    velocity: { x: 0, y: 2 },
    spawnPosition: { x: 192, y: 100 },
    ageTicks: 4,
  });
  assert.deepEqual(bullets.get(4)?.position, { x: 100 + tableVelocity(180, 1).x * 6, y: 50 + tableVelocity(180, 1).y * 6 });
});

test("aims at the player position at the start of the fire tick", () => {
  const inputs = [
    createMoveInputFrame(0, 1, 0, []),
    createMoveInputFrame(1, 1, 0, []),
    createMoveInputFrame(2, -1, 0, []),
  ];
  const { session } = runTicks(createEnemyPatternDefinition(), inputs);
  const aimed = assertSerializeOk(session.serialize(), "serialize").state.runtimeEntities.flatMap((entity) => (
    entity.kind === "enemyBullet" && entity.id >= 8 ? [angleStepsOfVector(entity.velocity)] : []
  ));

  // tick 2 の移動前の自機は (200, 400)。(192, 100) からの向き atan2(300, 8) ≈ 88.47° は 354 step にそろう。
  assert.deepEqual(aimed, [306, 354, 402]);
});

test("keeps one runner per enemy with steps in UTF-8 runnerId order", () => {
  const { session } = runTicks(createEnemyPatternDefinition(), emptyInputs(6));

  assert.deepEqual(assertSerializeOk(session.serialize(), "serialize").state.patternRunnerStates, [
    { runnerId: "patternRunner.enemy.12", patternId: "pattern.ring", stateVersion: 1, payload: { cursor: 2, waitRemaining: 3 } },
    {
      runnerId: "patternRunner.enemy.2",
      patternId: "pattern.aimed_three_way",
      stateVersion: 1,
      payload: { cursor: 3, waitRemaining: 3 },
    },
    { runnerId: "patternRunner.enemy.3", patternId: "pattern.ring", stateVersion: 1, payload: { cursor: 2, waitRemaining: 3 } },
  ]);
});

test("drops the runner of an enemy destroyed on its spawn tick and keeps the bullets it fired", () => {
  const definition = createDestroyedPatternEnemyDefinition();
  const { session, frames } = runTicks(definition, [createShotInputFrame(0)]);
  const snapshot = assertSerializeOk(session.serialize(), "serialize");

  assert.deepEqual(frames[0]!.events.map((event) => event.type), [
    "stageStarted",
    "entitySpawned",
    "enemyBulletsSpawnedBatch",
    "playerShotsSpawnedBatch",
    "entityDestroyed",
    "entityDestroyed",
    "scoreChanged",
    "tickAdvanced",
  ]);
  assert.deepEqual(snapshot.state.patternRunnerStates, []);
  assert.deepEqual(snapshot.state.runtimeEntities.map((entity) => [entity.id, entity.kind]), [[1, "player"], [3, "enemyBullet"]]);
});

test("drops the runner when the enemy leaves the playfield at the end of its path", () => {
  const definition = createExitingPatternEnemyDefinition();
  const { frames, session } = runTicks(definition, emptyInputs(6));

  // path を終えた tick 5 に y = 24 - 96 = -72 で cleanup 余白（64 px）を越える。tick 5 の発射までは撃つ。
  assert.deepEqual(spawnedBatches(frames).map((batch) => batch.map(([id, , y]) => [id, y])), [
    [[3, 24]],
    [[4, 8]],
    [[5, -8]],
    [[6, -24]],
    [[7, -40]],
    [[8, -56]],
  ]);
  assert.deepEqual(frames[5]!.state.entities.map((entity) => entity.id), [1, 3, 4, 5, 6]);
  assert.deepEqual(assertSerializeOk(session.serialize(), "serialize").state.patternRunnerStates, []);
});

test("fails fatally when pattern runners would execute more than 2,000 commands in one tick", () => {
  const flood = (enemies: number) => {
    const base = createMinimumDefinition();
    const definition: GameDefinition = {
      ...base,
      content: {
        ...base.content,
        stages: [{
          ...base.content.stages[0]!,
          timeline: Array.from({ length: enemies }, () => ({
            tick: 0,
            action: {
              type: "spawnEnemy",
              enemy: "enemy.scout",
              path: "path.none",
              pattern: "pattern.flood",
              position: { x: 192, y: 100 },
            },
          } as const)),
        }],
        patterns: [...base.content.patterns, {
          id: "pattern.flood",
          version: 1,
          steps: [
            ...Array.from({ length: 63 }, () => ({ fire: { bullet: "bullet.red_small", angleDeg: 90, speed: 1 } } as const)),
            { wait: 1 },
          ],
        }],
      },
    };
    return startStageFromDefinition(definition).tick(createEmptyInputFrame(0));
  };

  // 1 体は 63 発と wait の 64 命令を実行する。31 体（1,984 命令、1,953 発）までは受け付ける。
  const atBudget = flood(31);
  assert.equal(atBudget.ok, true);
  assert.equal(atBudget.ok && atBudget.value.state.entities.filter((entity) => entity.kind === "enemyBullet").length, 1_953);
  const exceeded = flood(32);
  assert.equal(exceeded.ok, false);
  assert.equal(!exceeded.ok && exceeded.errors[0]?.code, "stageSession.fatal");
  assert.match(
    !exceeded.ok ? exceeded.errors[0]?.message ?? "" : "",
    /pattern\.budgetExceeded: Pattern commands in one tick would exceed 2000: pattern\.flood/,
  );
});

test("fixes the 3-way golden: bullet counts, aimed angle steps and seed reproducibility", () => {
  const run = (seed: string) => {
    const loaded = createShootingCore("0.0.0").load(createEnemyPatternDefinition());
    assert.equal(loaded.ok, true);
    if (!loaded.ok) {
      return assert.fail("expected loaded game");
    }
    const started = loaded.value.startStage({ stageId: "stage.stage_01", difficulty: "normal", seed });
    assert.equal(started.ok, true);
    if (!started.ok) {
      return assert.fail("expected stage session");
    }
    const frames = emptyInputs(12).map((input) => assertTickOk(started.value.tick(input), `tick ${input.tick}`));
    return { frames, snapshot: assertSerializeOk(started.value.serialize(), "serialize") };
  };
  const golden = run("golden-a");
  const velocities = new Map(golden.snapshot.state.runtimeEntities.flatMap((entity) => (
    entity.kind === "enemyBullet" ? [[entity.id, entity.velocity] as const] : []
  )));
  const aimedAngleSteps = [2, 5, 8, 11].map((tick) => spawnedBatches(golden.frames)[tick]!
    .filter(([, x, y]) => x === 192 && y === 100)
    .map(([id]) => angleStepsOfVector(velocities.get(id!)!)));

  assert.deepEqual(
    [0, 2, 4, 5, 8, 11].map((tick) => golden.frames[tick]!.state.entities.filter((entity) => entity.kind === "enemyBullet").length),
    [4, 7, 16, 19, 30, 33],
  );
  assert.deepEqual(aimedAngleSteps, [[312, 360, 408], [312, 360, 408], [312, 360, 408], [312, 360, 408]]);
  assert.deepEqual(run("golden-a"), golden);
  // pattern は乱数を使わないため、seed が違っても弾は同じで、PRNG の state だけが異なる。
  const otherSeed = run("golden-b");
  assert.deepEqual(otherSeed.frames, golden.frames);
  assert.notDeepEqual(otherSeed.snapshot.prngState, golden.snapshot.prngState);
});
