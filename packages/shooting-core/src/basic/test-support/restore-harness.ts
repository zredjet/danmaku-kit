import assert from "node:assert/strict";

import type { LoadedGame } from "../api-types.ts";
import type { GameDefinition } from "../content/types.ts";
import { createShootingCore } from "../core.ts";
import { createEmptyInputFrame } from "../input/input-frame.ts";
import type { InputFrame } from "../input/input-frame.ts";
import type { SerializedGameState, SerializedRuntimeEntityState } from "../serialization/types.ts";
import { assertSerializeOk, assertTickOk, startStageFromLoadedGame } from "./stage-harness.ts";

/** core version 0.0.0 で definition を load した game を返す。 */
export function loadGameFromDefinition(definition: GameDefinition): LoadedGame {
  const loaded = createShootingCore("0.0.0").load(definition);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    assert.fail("expected loaded game");
  }
  return loaded.value;
}

/** stage を始めて `inputs` の tick を順に進めた snapshot を返す。 */
export function serializeAfterInputs(game: LoadedGame, inputs: readonly InputFrame[]): SerializedGameState {
  const session = startStageFromLoadedGame(game);
  for (const input of inputs) {
    assertTickOk(session.tick(input), `tick ${input.tick}`);
  }
  return assertSerializeOk(session.serialize(), `serialize after ${inputs.length} ticks`);
}

/** stage を始めて空の入力で `ticks` tick 進めた snapshot を返す。 */
export function serializeAfterEmptyTicks(game: LoadedGame, ticks: number): SerializedGameState {
  return serializeAfterInputs(game, Array.from({ length: ticks }, (_, tick) => createEmptyInputFrame(tick)));
}

/** runtimeEntities の指定 kind / id の entity を差し替えた snapshot を作る。restore へ未検証の plain data として渡す。 */
export function withRuntimeEntity<Kind extends SerializedRuntimeEntityState["kind"]>(
  state: SerializedGameState,
  kind: Kind,
  id: number,
  change: (entity: Extract<SerializedRuntimeEntityState, { kind: Kind }>) => unknown,
): unknown {
  return {
    ...state,
    state: {
      ...state.state,
      runtimeEntities: state.state.runtimeEntities.map((entity) => (
        entity.kind === kind && entity.id === id
          ? change(entity as Extract<SerializedRuntimeEntityState, { kind: Kind }>)
          : entity
      )),
    },
  };
}

/** restore が `state.invalidShape` の error を返し、最初の error message が `message` に一致することを確かめる。 */
export function expectRestoreInvalidShape(game: LoadedGame, state: unknown, message: RegExp): void {
  const restored = game.restore(state as SerializedGameState);
  assert.equal(restored.ok, false);
  assert.equal(!restored.ok && restored.errors[0]?.code, "state.invalidShape");
  assert.match(!restored.ok ? restored.errors[0]?.message ?? "" : "", message);
}
