import assert from "node:assert/strict";
import test from "node:test";

import type { LoadedGame } from "../../api-types.ts";
import type { CoreErrorCode } from "../../result.ts";
import { createEmptyInputFrame } from "../../input/input-frame.ts";
import type { InputFrame } from "../../input/input-frame.ts";
import {
  createDestroyedPatternEnemyDefinition,
  createEnemyPatternDefinition,
  createExitingPatternEnemyDefinition,
  createExtendedPatternDefinition,
  createAimedStreamCleanupDefinition,
} from "../../test-support/definitions.ts";
import { tableVelocity } from "../../test-support/geometry.ts";
import { createMoveInputFrame, createShotInputFrame } from "../../test-support/input-frames.ts";
import {
  expectRestoreInvalidShape,
  loadGameFromDefinition,
  serializeAfterInputs,
  withRuntimeEntity,
} from "../../test-support/restore-harness.ts";
import {
  assertSerializeOk,
  assertTickOk,
  loadMinimumGame,
  serializeInitialStageState,
  startStageFromLoadedGame,
} from "../../test-support/stage-harness.ts";
import type { SerializedGameState, SerializedPatternRunnerState, SerializedRuntimeEntityState } from "../types.ts";

type SerializedEnemyBullet = Extract<SerializedRuntimeEntityState, { kind: "enemyBullet" }>;

const moveFromFire = /must move from a processed timeline spawn or pattern fire/;

const validPatternRunnerState = {
  runnerId: "patternRunner.enemy.2",
  patternId: "pattern.none",
  stateVersion: 1,
  payload: { cursor: 0, waitRemaining: 0 },
};

/** enemy のいない初期 snapshot と、error code / message を検証する helper を用意する。 */
function createInitialStateHarness() {
  const loaded = loadMinimumGame("core.test");
  const validState = serializeInitialStageState("core.test");
  const expectRestoreError = (state: unknown, code: CoreErrorCode, detail: RegExp) => {
    const restored = loaded.restore(state as SerializedGameState);
    assert.equal(restored.ok, false);
    assert.equal(!restored.ok && restored.errors[0]?.code, code);
    assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", detail);
  };
  return { validState, expectRestoreError };
}

/** 自機を左右上下に動かし、aim の向きが tick ごとに変わる入力列。 */
function wanderingInputs(ticks: number): InputFrame[] {
  return Array.from({ length: ticks }, (_, tick) => createMoveInputFrame(
    tick,
    tick % 7 < 3 ? 1 : tick % 7 < 5 ? -1 : 0,
    tick % 5 === 0 ? -1 : 0,
    [],
  ));
}

/** restore した session と元の session が後続 tick と最後の serialize で一致することを確かめる。 */
function assertRestoresAndContinues(game: LoadedGame, inputs: readonly InputFrame[], restoreTicks: readonly number[]): void {
  for (const restoreTick of restoreTicks) {
    const source = startStageFromLoadedGame(game);
    for (const input of inputs.slice(0, restoreTick)) {
      assertTickOk(source.tick(input), `source tick ${input.tick}`);
    }
    const snapshot = assertSerializeOk(source.serialize(), `serialize at ${restoreTick}`);
    const restored = game.restore(snapshot);
    assert.equal(restored.ok, true, `restore at ${restoreTick}: ${JSON.stringify(restored.ok ? null : restored.errors)}`);
    if (!restored.ok) {
      return;
    }
    assert.deepEqual(assertSerializeOk(restored.value.serialize(), "restored serialize"), snapshot);
    for (const input of inputs.slice(restoreTick)) {
      assert.deepEqual(
        assertTickOk(restored.value.tick(input), `restored tick ${input.tick}`),
        assertTickOk(source.tick(input), `source tick ${input.tick}`),
        `frame ${input.tick} after restore at ${restoreTick}`,
      );
    }
    assert.deepEqual(
      assertSerializeOk(restored.value.serialize(), "restored final serialize"),
      assertSerializeOk(source.serialize(), "source final serialize"),
    );
  }
}

/** 速度と経過 tick を差し替え、位置は生成位置からの等速直線運動と矛盾しないようにそろえる。 */
function movedBullet(
  bullet: SerializedEnemyBullet,
  change: Partial<Pick<SerializedEnemyBullet, "velocity" | "spawnPosition" | "ageTicks">>,
): SerializedEnemyBullet {
  const next = { ...bullet, ...change };
  return {
    ...next,
    position: {
      x: next.spawnPosition.x + next.velocity.x * next.ageTicks,
      y: next.spawnPosition.y + next.velocity.y * next.ageTicks,
    },
  };
}

function withRunners(
  state: SerializedGameState,
  change: (runners: readonly SerializedPatternRunnerState[]) => unknown[],
): unknown {
  return { ...state, state: { ...state.state, patternRunnerStates: change(state.state.patternRunnerStates) } };
}

test("restores pattern runners and aimed or fixed-angle pattern bullets at any tick and continues identically", () => {
  assertRestoresAndContinues(loadGameFromDefinition(createEnemyPatternDefinition()), wanderingInputs(24), [1, 2, 3, 4, 5, 6, 9, 13, 17]);
});

test("restores radial, stream and repeated pattern bullets and runners at any tick and continues identically", () => {
  assertRestoresAndContinues(loadGameFromDefinition(createExtendedPatternDefinition()), wanderingInputs(24), [1, 2, 3, 4, 5, 6, 8, 12, 13, 15, 20]);
});

test("restores aimed fan and stream bullets in allocation order after an earlier bullet of the same fire is gone", () => {
  const game = loadGameFromDefinition(createAimedStreamCleanupDefinition());
  const inputs = wanderingInputs(40);
  const source = startStageFromLoadedGame(game);
  const bulletCounts = inputs.map((input) => assertTickOk(source.tick(input), `tick ${input.tick}`).state.entities
    .filter((entity) => entity.kind === "enemyBullet").length);

  // 最初に撃った 4 発のうち、最初の方向の速い弾が他より先に消える tick を含めて restore する。
  assert.equal(bulletCounts[0], 4);
  assert.ok(bulletCounts.slice(1, 30).some((count) => count > 0 && count < 4));
  assertRestoresAndContinues(game, inputs, [1, 4, 8, 12, 16, 20, 24, 28, 31, 35]);
});

test("restores the bullets of enemies that were destroyed or left the playfield", () => {
  const destroyed = loadGameFromDefinition(createDestroyedPatternEnemyDefinition());
  const destroyedInputs = [createShotInputFrame(0), ...Array.from({ length: 5 }, (_, index) => createEmptyInputFrame(index + 1))];
  assert.deepEqual(serializeAfterInputs(destroyed, destroyedInputs.slice(0, 3)).state.patternRunnerStates, []);
  assertRestoresAndContinues(destroyed, destroyedInputs, [1, 2, 3]);

  const exiting = loadGameFromDefinition(createExitingPatternEnemyDefinition());
  assertRestoresAndContinues(exiting, Array.from({ length: 10 }, (_, tick) => createEmptyInputFrame(tick)), [1, 3, 5, 6, 7, 9]);
});

test("rejects pattern runner states that do not follow the enemy's pattern from spawn", () => {
  const game = loadGameFromDefinition(createEnemyPatternDefinition());
  const state = serializeAfterInputs(game, Array.from({ length: 6 }, (_, tick) => createEmptyInputFrame(tick)));
  const progress = /must match its enemy's pattern progress from spawn/;
  const oneRunnerEach = /one runner for each enemy running pattern steps/;
  const aimedRunner = (change: (runner: SerializedPatternRunnerState) => unknown) => withRunners(state, (runners) => (
    runners.map((runner) => runner.runnerId === "patternRunner.enemy.2" ? change(runner) : runner)
  ));

  assert.deepEqual(state.state.patternRunnerStates.map((runner) => runner.runnerId), [
    "patternRunner.enemy.12",
    "patternRunner.enemy.2",
    "patternRunner.enemy.3",
  ]);
  expectRestoreInvalidShape(game, aimedRunner((runner) => ({ ...runner, payload: { cursor: 3, waitRemaining: 2 } })), progress);
  expectRestoreInvalidShape(game, aimedRunner((runner) => ({ ...runner, payload: { cursor: 1, waitRemaining: 3 } })), progress);
  expectRestoreInvalidShape(game, aimedRunner((runner) => ({ ...runner, patternId: "pattern.ring" })), progress);
  expectRestoreInvalidShape(game, withRunners(state, (runners) => runners.map((runner) => (
    runner.runnerId === "patternRunner.enemy.3" ? { ...runner, runnerId: "patternRunner.enemy.4" } : runner
  ))), progress);
  expectRestoreInvalidShape(game, withRunners(state, (runners) => runners.slice(0, 2)), oneRunnerEach);
  expectRestoreInvalidShape(game, withRunners(state, (runners) => [
    { ...runners[0]!, runnerId: "patternRunner.enemy.11", patternId: "pattern.spawn_down" },
    ...runners,
  ]), oneRunnerEach);
});

test("rejects pattern bullets that the enemy's pattern could not have fired", () => {
  const game = loadGameFromDefinition(createEnemyPatternDefinition());
  const state = serializeAfterInputs(game, Array.from({ length: 6 }, (_, tick) => createEmptyInputFrame(tick)));
  const bullet9 = state.state.runtimeEntities.find((entity) => entity.id === 9);
  assert.equal(bullet9?.kind, "enemyBullet");

  // aim の弾は表の向きに speed を掛けた速度でなければならない。
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemyBullet", 8, (bullet) => movedBullet(bullet, {
    velocity: { x: 0.1, y: Math.sqrt(4 - 0.01) },
  })), moveFromFire);
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemyBullet", 8, (bullet) => movedBullet(bullet, { velocity: tableVelocity(312, 3) })), moveFromFire);
  // 固定角度の弾は fan の何発目かまで速度が決まる。
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemyBullet", 4, (bullet) => movedBullet(bullet, { velocity: tableVelocity(181, 1) })), moveFromFire);
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemyBullet", 4, (bullet) => movedBullet(bullet, { velocity: tableVelocity(300, 1) })), moveFromFire);
  // tick 3 は aimed_three_way が撃たない tick で、(193, 100) はその enemy の位置ではない。
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemyBullet", 9, (bullet) => movedBullet(bullet, { ageTicks: 3 })), moveFromFire);
  expectRestoreInvalidShape(game, withRuntimeEntity(state, "enemyBullet", 9, (bullet) => movedBullet(bullet, { spawnPosition: { x: 193, y: 100 } })), moveFromFire);
  // fan の 3 発を使い切った後の 4 発目は受け付けない。
  expectRestoreInvalidShape(game, {
    ...state,
    nextEntityId: state.nextEntityId + 1,
    state: {
      ...state.state,
      runtimeEntities: [...state.state.runtimeEntities, { ...bullet9!, id: state.nextEntityId }],
    },
  }, moveFromFire);
});

test("accepts any table direction for aimed bullets because the player's past positions are not in the snapshot", () => {
  const game = loadGameFromDefinition(createEnemyPatternDefinition());
  const state = serializeAfterInputs(game, Array.from({ length: 6 }, (_, tick) => createEmptyInputFrame(tick)));

  const restored = game.restore(withRuntimeEntity(state, "enemyBullet", 9, (bullet) => movedBullet(bullet, {
    velocity: tableVelocity(340, 2),
  })) as SerializedGameState);
  assert.equal(restored.ok, true, JSON.stringify(restored.ok ? null : restored.errors));
});

test("counts pattern fires in the reachable nextEntityId envelope", () => {
  const game = loadGameFromDefinition(createEnemyPatternDefinition());
  const state = serializeAfterInputs(game, Array.from({ length: 6 }, (_, tick) => createEmptyInputFrame(tick)));

  // 2 + enemy 4 体 + fireOnSpawn 1 発 + pattern 18 発（aim 3 発 × 2 回、ring 4 発 × 3 回）+ shot 6 tick = 31。
  assert.equal(state.nextEntityId, 25);
  assert.equal(game.restore({ ...state, nextEntityId: 31 }).ok, true);
  expectRestoreInvalidShape(game, { ...state, nextEntityId: 32 }, /allocation envelope/);
});

test("restore rejects malformed, unordered or unsupported pattern runner states", () => {
  const { validState, expectRestoreError } = createInitialStateHarness();
  expectRestoreError({
    ...validState,
    state: { ...validState.state, patternRunnerStates: [validPatternRunnerState] },
  }, "state.invalidShape", /one runner for each enemy/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: Array.from({ length: 4_097 }, (_, index) => ({
        ...validPatternRunnerState,
        runnerId: `patternRunner.${String(index).padStart(4, "0")}`,
      })),
    },
  }, "state.invalidShape", /patternRunnerStates/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, runnerId: "patternRunner." }],
    },
  }, "state.invalidShape", /runnerId/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, runnerId: `patternRunner.${"x".repeat(8_193)}` }],
    },
  }, "state.invalidShape", /runnerId/);
  for (const runnerIds of [
    ["patternRunner.z", "patternRunner.a"],
    ["patternRunner.😀", "patternRunner.あ"],
    ["patternRunner.enemy.2", "patternRunner.enemy.2"],
  ]) {
    expectRestoreError({
      ...validState,
      state: {
        ...validState.state,
        patternRunnerStates: runnerIds.map((runnerId) => ({ ...validPatternRunnerState, runnerId })),
      },
    }, "state.invalidShape", /ordered/);
  }
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, patternId: "path.none" }],
    },
  }, "state.invalidShape", /pattern id/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, stateVersion: 0 }],
    },
  }, "state.invalidShape", /stateVersion/);
  expectRestoreError({
    ...validState,
    state: {
      ...validState.state,
      patternRunnerStates: [{ ...validPatternRunnerState, stateVersion: 2 }],
    },
  }, "state.featureMismatch", /stateVersion/);
});

test("restore requires plain pattern runner payloads with cursor and waitRemaining counts", () => {
  const { validState, expectRestoreError } = createInitialStateHarness();
  const getterPayload = { cursor: 0 };
  Object.defineProperty(getterPayload, "waitRemaining", {
    enumerable: true,
    get() {
      throw new Error("payload getter must not run");
    },
  });
  const revokedPayload = Proxy.revocable({ cursor: 0, waitRemaining: 0 }, {});
  revokedPayload.revoke();
  const cases: ReadonlyArray<readonly [unknown, RegExp]> = [
    [Number.POSITIVE_INFINITY, /payload must be a plain object/],
    ["cursor", /payload must be a plain object/],
    [[0, 0], /payload must be a plain object/],
    [Object.create({ cursor: 0, waitRemaining: 0 }), /payload must be a plain object/],
    [revokedPayload.proxy, /payload must be a plain object/],
    [{ cursor: 0, waitRemaining: 0, flags: [] }, /payload contains unknown fields/],
    [getterPayload, /payload must contain only enumerable data properties/],
    [{ cursor: 0 }, /cursor and waitRemaining/],
    [{ cursor: -1, waitRemaining: 0 }, /cursor and waitRemaining/],
    [{ cursor: 0, waitRemaining: 0.5 }, /cursor and waitRemaining/],
    [{ cursor: "0", waitRemaining: 0 }, /cursor and waitRemaining/],
    [{ cursor: 0, waitRemaining: Number.MAX_SAFE_INTEGER + 1 }, /cursor and waitRemaining/],
  ];
  for (const [payload, detail] of cases) {
    expectRestoreError({
      ...validState,
      state: {
        ...validState.state,
        patternRunnerStates: [{ ...validPatternRunnerState, payload }],
      },
    }, "state.invalidShape", detail);
  }
});
