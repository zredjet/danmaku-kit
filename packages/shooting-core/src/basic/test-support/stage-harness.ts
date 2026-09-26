import assert from "node:assert/strict";

import { createMinimumDefinition } from "../../../../../tests/fixtures/minimum-game-definition.ts";
import type { LoadedGame, ShootingCore, StageSession } from "../api-types.ts";
import type { GameDefinition } from "../content/types.ts";
import { createShootingCore } from "../core.ts";
import type { InputFrame } from "../input/input-frame.ts";
import type { SerializedGameState } from "../serialization/types.ts";

export function startMinimumStage() {
  return startStageFromDefinition(createMinimumDefinition());
}

export function loadMinimumGame(coreVersion = "0.0.0") {
  const loaded = createShootingCore(coreVersion).load(createMinimumDefinition());
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  return loaded.value;
}

export function serializeInitialStageState(coreVersion = "0.0.0"): SerializedGameState {
  const started = startStageFromLoadedGame(loadMinimumGame(coreVersion));
  const serialized = started.serialize();
  assert.equal(serialized.ok, true);
  if (!serialized.ok) {
    assert.fail("expected serialized state");
  }

  return serialized.value;
}

export function startStageFromDefinition(definition: GameDefinition) {
  return startStageFromCoreAndDefinition(createShootingCore("0.0.0"), definition);
}

export function startStageFromCoreAndDefinition(core: ShootingCore, definition: GameDefinition) {
  const loaded = core.load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }

  return startStageFromLoadedGame(loaded.value);
}

export function startStageFromLoadedGame(loaded: LoadedGame) {
  const started = loaded.startStage({
    stageId: "stage.stage_01",
    difficulty: "normal",
    seed: "seed-1",
  });
  assert.equal(started.ok, true);
  if (!started.ok) {
    assert.fail("expected stage session");
  }

  return started.value;
}

export function assertTickOk(frame: ReturnType<StageSession["tick"]>, label: string) {
  if (!frame.ok) {
    assert.fail(`${label} failed: ${JSON.stringify(frame)}`);
  }

  return frame.value;
}

export function assertSerializeOk(snapshot: ReturnType<StageSession["serialize"]>, label: string) {
  if (!snapshot.ok) {
    assert.fail(`${label} failed: ${JSON.stringify(snapshot)}`);
  }

  return snapshot.value;
}

export function loadUnknown(definition: unknown) {
  return createShootingCore().load(definition as GameDefinition);
}

export function tickUnknown(session: StageSession, input: unknown) {
  return session.tick(input as InputFrame);
}
