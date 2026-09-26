import assert from "node:assert/strict";
import test from "node:test";

import type { LoadedGame } from "../../api-types.ts";
import type { GameDefinition } from "../../content/types.ts";
import { createShootingCore } from "../../core.ts";
import { createEmptyInputFrame } from "../../input/input-frame.ts";
import {
  createClearedByExitDefinition,
  createEnemyBulletHitDefinition,
  createLastLifeHitDefinition,
} from "../../test-support/definitions.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "../../test-support/stage-harness.ts";
import type { SerializedGameState } from "../types.ts";

function loadGame(definition: GameDefinition): LoadedGame {
  const loaded = createShootingCore("0.0.0").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  return loaded.value;
}

function serializeAfter(game: LoadedGame, ticks: number): SerializedGameState {
  const session = startStageFromLoadedGame(game);
  for (let tick = 0; tick < ticks; tick += 1) {
    assertTickOk(session.tick(createEmptyInputFrame(tick)), `tick ${tick}`);
  }
  return assertSerializeOk(session.serialize(), `serialize after ${ticks} ticks`);
}

function withStageStatus(state: SerializedGameState, stageStatus: unknown): SerializedGameState {
  return { ...state, state: { ...state.state, stageStatus } } as SerializedGameState;
}

function expectInvalidShape(game: LoadedGame, state: SerializedGameState, message: RegExp): void {
  const restored = game.restore(state);
  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
  assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", message);
}

test("restores ended stages that keep rejecting ticks", () => {
  for (const [definition, ticks, status] of [
    [createLastLifeHitDefinition(), 1, "gameOver"],
    [createClearedByExitDefinition(), 6, "stageCleared"],
  ] as const) {
    const game = loadGame(definition);
    const snapshot = serializeAfter(game, ticks);
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
  const gameOverGame = loadGame(createLastLifeHitDefinition());
  const gameOver = serializeAfter(gameOverGame, 1);
  const clearedGame = loadGame(createClearedByExitDefinition());
  const cleared = serializeAfter(clearedGame, 6);
  const beforeClear = serializeAfter(clearedGame, 5);
  const playingGame = loadGame(createEnemyBulletHitDefinition());
  const playing = serializeAfter(playingGame, 1);

  expectInvalidShape(gameOverGame, withStageStatus(gameOver, "playing"), mismatch);
  expectInvalidShape(gameOverGame, withStageStatus(gameOver, "stageCleared"), mismatch);
  expectInvalidShape(clearedGame, withStageStatus(cleared, "playing"), mismatch);
  expectInvalidShape(clearedGame, withStageStatus(beforeClear, "stageCleared"), mismatch);
  expectInvalidShape(playingGame, withStageStatus(playing, "gameOver"), mismatch);
  // tick を 1 つも進めていない snapshot は、timeline が空でも playing に限る。
  const emptyTimelineGame = loadGame({
    ...createClearedByExitDefinition(),
    content: {
      ...createClearedByExitDefinition().content,
      stages: [{ ...createClearedByExitDefinition().content.stages[0]!, timeline: [] }],
    },
  });
  expectInvalidShape(emptyTimelineGame, withStageStatus(serializeAfter(emptyTimelineGame, 0), "stageCleared"), mismatch);
  assert.equal(serializeAfter(emptyTimelineGame, 1).state.stageStatus, "stageCleared");
});

test("rejects missing or unknown stage statuses", () => {
  const game = loadGame(createEnemyBulletHitDefinition());
  const playing = serializeAfter(game, 1);
  const withoutStatus = { ...playing, state: { ...playing.state } } as Record<string, unknown> & SerializedGameState;
  delete (withoutStatus.state as Record<string, unknown>).stageStatus;

  for (const stageStatus of [undefined, "paused", "Playing", 0, null]) {
    expectInvalidShape(game, withStageStatus(playing, stageStatus), /stageStatus must be playing, stageCleared or gameOver/);
  }
  expectInvalidShape(game, withoutStatus, /stageStatus must be playing, stageCleared or gameOver/);
});
