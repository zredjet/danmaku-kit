import assert from "node:assert/strict";
import test from "node:test";

import type { PlayerShotDefinition } from "../content/types.ts";
import type { PlayerRuntimeEntity } from "../entities/player/model.ts";
import type { InputFrame } from "../input/input-frame.ts";
import { EntityAllocator } from "./entity.ts";
import { spawnPlayerShotFromInput } from "./player-shot-system.ts";

test("skips held shot while player fire cooldown is active", () => {
  const allocator = new EntityAllocator();
  const result = spawnPlayerShotFromInput(
    allocator,
    createInputFrame(4, ["shot"], []),
    createPlayer({ nextShotAllowedTick: 5 }),
    createPlayerShot({ intervalTicks: 3 }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value, null);
  assert.equal(allocator.snapshot(), 1);
});

test("spawns from pressed shot input and updates cooldown", () => {
  const result = spawnPlayerShotFromInput(
    new EntityAllocator(),
    createInputFrame(0, [], ["shot"]),
    createPlayer({ nextShotAllowedTick: 0 }),
    createPlayerShot({ intervalTicks: 3 }),
  );

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) {
    assert.fail("expected player shot spawn");
  }

  assert.equal(result.value.player.nextShotAllowedTick, 3);
  assert.equal(result.value.entities.length, 1);
  assert.equal(result.value.spawnedShots.length, 1);
});

test("updates player fire cooldown from player shot content interval", () => {
  const result = spawnPlayerShotFromInput(
    new EntityAllocator(),
    createInputFrame(4, ["shot"], []),
    createPlayer({ nextShotAllowedTick: 4 }),
    createPlayerShot({ intervalTicks: 7 }),
  );

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) {
    assert.fail("expected player shot spawn");
  }

  assert.equal(result.value.player.nextShotAllowedTick, 11);
  assert.deepEqual(result.value.spawnedShots, [
    {
      entityId: 1,
      definitionId: "playerShot.basic",
      position: { x: 192, y: 400 },
    },
  ]);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.entities), true);
  assert.equal(Object.isFrozen(result.value.entities[0]), true);
  assert.equal(Object.isFrozen(result.value.entities[0]?.position), true);
  assert.equal(Object.isFrozen(result.value.entities[0]?.velocity), true);
  assert.equal(Object.isFrozen(result.value.player), true);
  assert.equal(Object.isFrozen(result.value.player.position), true);
  assert.equal(Object.isFrozen(result.value.player.movement), true);
  assert.equal(Object.isFrozen(result.value.spawnedShots), true);
  assert.equal(Object.isFrozen(result.value.spawnedShots[0]), true);
  assert.equal(Object.isFrozen(result.value.event), true);
  assert.equal(result.value.event.type, "playerShotsSpawnedBatch");
  if (result.value.event.type !== "playerShotsSpawnedBatch") {
    assert.fail("expected playerShotsSpawnedBatch event");
  }
  assert.equal(Object.isFrozen(result.value.event.shots), true);
  assert.equal(Object.isFrozen(result.value.event.shots[0]), true);
  assert.equal(Object.isFrozen(result.value.event.shots[0]?.position), true);
});

test("does not duplicate fire when shot is both held and pressed", () => {
  const result = spawnPlayerShotFromInput(
    new EntityAllocator(),
    createInputFrame(0, ["shot"], ["shot"]),
    createPlayer({ nextShotAllowedTick: 0 }),
    createPlayerShot({ intervalTicks: 3 }),
  );

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) {
    assert.fail("expected player shot spawn");
  }
  assert.equal(result.value.entities.length, 1);
  assert.equal(result.value.spawnedShots.length, 1);
});

function createInputFrame(
  tick: number,
  held: InputFrame["held"],
  pressed: InputFrame["pressed"],
): InputFrame {
  return Object.freeze({
    tick,
    axes: Object.freeze({ moveX: 0, moveY: 0 }),
    held: Object.freeze([...held]),
    pressed: Object.freeze([...pressed]),
    released: Object.freeze([] as const),
  });
}

function createPlayer(options: { nextShotAllowedTick: number }): PlayerRuntimeEntity {
  return Object.freeze({
    id: 10,
    kind: "player",
    definitionId: "player.default",
    position: Object.freeze({ x: 192, y: 400 }),
    movement: Object.freeze({ speed: 4, focusSpeed: 1.8 }),
    collisionRadius: 3,
    lives: 3,
    invincibleTicksRemaining: 0,
    shotDefinitionId: "playerShot.basic",
    nextShotAllowedTick: options.nextShotAllowedTick,
  });
}

function createPlayerShot(options: { intervalTicks: number }): PlayerShotDefinition {
  return Object.freeze({
    id: "playerShot.basic",
    version: 1,
    asset: "shot.player_basic",
    collision: Object.freeze({ radius: 5 }),
    damage: 5,
    fire: Object.freeze({ intervalTicks: options.intervalTicks }),
    projectile: Object.freeze({
      velocity: Object.freeze({ x: 0, y: -8 }),
      lifetimeTicks: 3,
    }),
  });
}
