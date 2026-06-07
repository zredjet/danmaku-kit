import assert from "node:assert/strict";
import test from "node:test";

import type { InputFrame } from "../input/input-frame.ts";
import { advancePlayerMovement } from "./player-movement-system.ts";
import type { RuntimeEntityState } from "./runtime-entity.ts";

test("moves player by content speed from input axes", () => {
  const entities = [createPlayer()] as const;

  const advanced = advancePlayerMovement(entities, createInputFrame(0, 1, -1, []));

  assert.deepEqual(advanced, [{
    ...entities[0],
    position: { x: 192 + 4 * Math.SQRT1_2, y: 400 - 4 * Math.SQRT1_2 },
    movement: { speed: 4, focusSpeed: 1.8 },
  }]);
  assert.deepEqual(entities[0].position, { x: 192, y: 400 });
  assert.equal(Object.isFrozen(advanced), true);
  assert.equal(Object.isFrozen(advanced[0]), true);
  assert.equal(advanced[0]?.kind === "player" && Object.isFrozen(advanced[0].position), true);
  assert.equal(advanced[0]?.kind === "player" && Object.isFrozen(advanced[0].movement), true);
});

test("uses focus speed when focus is held", () => {
  const entities = [createPlayer()] as const;

  const advanced = advancePlayerMovement(entities, createInputFrame(0, -1, 1, ["focus"]));

  assert.equal(advanced[0]?.kind, "player");
  assert.deepEqual(advanced[0]?.position, {
    x: 192 - 1.8 * Math.SQRT1_2,
    y: 400 + 1.8 * Math.SQRT1_2,
  });
});

test("clamps player center inside the playfield", () => {
  const entities: RuntimeEntityState[] = [
    {
      ...createPlayer(),
      position: { x: 382, y: 446 },
    },
  ];

  const advanced = advancePlayerMovement(entities, createInputFrame(0, 1, 1, []));

  assert.equal(advanced[0]?.kind, "player");
  assert.deepEqual(advanced[0]?.position, { x: 384, y: 448 });
});

test("clamps player center at the playfield origin", () => {
  const entities: RuntimeEntityState[] = [
    {
      ...createPlayer(),
      position: { x: 2, y: 2 },
    },
  ];

  const advanced = advancePlayerMovement(entities, createInputFrame(0, -1, -1, []));

  assert.equal(advanced[0]?.kind, "player");
  assert.deepEqual(advanced[0]?.position, { x: 0, y: 0 });
});

test("leaves non-player entities untouched", () => {
  const enemy: RuntimeEntityState = {
    id: 2,
    kind: "enemy",
    definitionId: "enemy.scout",
    position: { x: 192, y: -16 },
    pathId: "path.none",
    patternId: "pattern.none",
    collisionRadius: 12,
    hp: 10,
    scoreOnKill: 100,
  };

  const advanced = advancePlayerMovement([enemy], createInputFrame(0, 1, 0, []));

  assert.deepEqual(advanced, [enemy]);
});

function createPlayer(): RuntimeEntityState {
  return {
    id: 1,
    kind: "player",
    definitionId: "player.default",
    position: { x: 192, y: 400 },
    movement: { speed: 4, focusSpeed: 1.8 },
    collisionRadius: 3,
    lives: 3,
    invincibleTicksRemaining: 0,
    shotDefinitionId: "playerShot.basic",
  };
}

function createInputFrame(
  tick: number,
  moveX: -1 | 0 | 1,
  moveY: -1 | 0 | 1,
  held: InputFrame["held"],
): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX, moveY }),
    held: Object.freeze([...held]),
    pressed: Object.freeze([]),
    released: Object.freeze([]),
  });
}
