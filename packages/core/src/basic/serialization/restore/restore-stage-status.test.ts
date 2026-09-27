import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyInputFrame } from "../../input/input-frame.ts";
import {
  createClearedByExitDefinition,
  createEnemyBulletHitDefinition,
  createLastLifeHitDefinition,
} from "../../test-support/definitions.ts";
import {
  expectRestoreInvalidShape,
  loadGameFromDefinition,
  serializeAfterEmptyTicks,
} from "../../test-support/restore-harness.ts";
import { assertSerializeOk } from "../../test-support/stage-harness.ts";
import type { SerializedGameState } from "../types.ts";

function withStageStatus(state: SerializedGameState, stageStatus: unknown): SerializedGameState {
  return { ...state, state: { ...state.state, stageStatus } } as SerializedGameState;
}

test("restores ended stages that keep rejecting ticks", () => {
  for (const [definition, ticks, status] of [
    [createLastLifeHitDefinition(), 1, "gameOver"],
    [createClearedByExitDefinition(), 6, "stageCleared"],
  ] as const) {
    const game = loadGameFromDefinition(definition);
    const snapshot = serializeAfterEmptyTicks(game, ticks);
    assert.equal(snapshot.state.stageStatus, status);

    const restored = game.restore(snapshot);
    assert.equal(restored.ok, true, JSON.stringify(restored.ok ? null : restored.errors));
    if (!restored.ok) {
      return;
    }
    assert.deepEqual(assertSerializeOk(restored.value.serialize(), "restored serialize"), snapshot);
    assert.deepEqual(restored.value.tick(createEmptyInputFrame(ticks)), {
      ok: false,
      errors: [{ code: "stageSession.ended", message: `Stage session has ended: ${status}` }],
    });
  }
});

test("rejects stage statuses that do not follow from the player lives, timeline and enemies", () => {
  const mismatch = /stageStatus must match the player lives, timeline and enemies/;
  const gameOverGame = loadGameFromDefinition(createLastLifeHitDefinition());
  const gameOver = serializeAfterEmptyTicks(gameOverGame, 1);
  const clearedGame = loadGameFromDefinition(createClearedByExitDefinition());
  const cleared = serializeAfterEmptyTicks(clearedGame, 6);
  const beforeClear = serializeAfterEmptyTicks(clearedGame, 5);
  const playingGame = loadGameFromDefinition(createEnemyBulletHitDefinition());
  const playing = serializeAfterEmptyTicks(playingGame, 1);

  expectRestoreInvalidShape(gameOverGame, withStageStatus(gameOver, "playing"), mismatch);
  expectRestoreInvalidShape(gameOverGame, withStageStatus(gameOver, "stageCleared"), mismatch);
  expectRestoreInvalidShape(clearedGame, withStageStatus(cleared, "playing"), mismatch);
  expectRestoreInvalidShape(clearedGame, withStageStatus(beforeClear, "stageCleared"), mismatch);
  expectRestoreInvalidShape(playingGame, withStageStatus(playing, "gameOver"), mismatch);
  // tick を 1 つも進めていない snapshot は、timeline が空でも playing に限る。
  const emptyTimelineGame = loadGameFromDefinition({
    ...createClearedByExitDefinition(),
    content: {
      ...createClearedByExitDefinition().content,
      stages: [{ ...createClearedByExitDefinition().content.stages[0]!, timeline: [] }],
    },
  });
  expectRestoreInvalidShape(emptyTimelineGame, withStageStatus(serializeAfterEmptyTicks(emptyTimelineGame, 0), "stageCleared"), mismatch);
  assert.equal(serializeAfterEmptyTicks(emptyTimelineGame, 1).state.stageStatus, "stageCleared");
});

test("rejects missing or unknown stage statuses", () => {
  const game = loadGameFromDefinition(createEnemyBulletHitDefinition());
  const playing = serializeAfterEmptyTicks(game, 1);
  const withoutStatus = { ...playing, state: { ...playing.state } } as Record<string, unknown> & SerializedGameState;
  delete (withoutStatus.state as Record<string, unknown>).stageStatus;

  for (const stageStatus of [undefined, "paused", "Playing", 0, null]) {
    expectRestoreInvalidShape(game, withStageStatus(playing, stageStatus), /stageStatus must be playing, stageCleared or gameOver/);
  }
  expectRestoreInvalidShape(game, withoutStatus, /stageStatus must be playing, stageCleared or gameOver/);
});
