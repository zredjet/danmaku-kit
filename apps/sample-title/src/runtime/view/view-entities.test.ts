import assert from "node:assert/strict";
import test from "node:test";

import type { ReadonlyEntityState, ReadonlyGameState, ReadonlyPickupState } from "@danmaku-kit/core";

import { PICKUP_ATTRACTION_VIEW_TICKS, PickupAttraction, collectViewEntities } from "./view-entities.ts";

const player: ReadonlyEntityState = { id: 1, kind: "player", definitionId: "player.default", position: { x: 100, y: 400 } };
const pickup = (id: number, attracted: boolean, position = { x: 100, y: 280 }): ReadonlyPickupState => ({
  id,
  definitionId: "pickup.score_small",
  position,
  attracted,
});
const stateAt = (tick: number, pickups?: readonly ReadonlyPickupState[]) => ({
  tick,
  entities: [player],
  ...(pickups ? { features: { pickups } } : {}),
}) as unknown as ReadonlyGameState;

test("adds the frame pickups after the Core entities and keeps frames without pickups as they are", () => {
  const attraction = new PickupAttraction();
  const withoutPickups = stateAt(3);

  assert.equal(collectViewEntities(withoutPickups, attraction), withoutPickups.entities);
  assert.deepEqual(collectViewEntities(null, attraction), []);
  assert.deepEqual(collectViewEntities(stateAt(3, [pickup(7, false)]), attraction), [
    player,
    { id: 7, kind: "pickup", definitionId: "pickup.score_small", position: { x: 100, y: 280 } },
  ]);
});

test("moves attracted pickups toward the player tick by tick from where the attraction started", () => {
  const attraction = new PickupAttraction();
  const positionAt = (tick: number) => collectViewEntities(stateAt(tick, [pickup(7, true)]), attraction)[1]!.position;

  // 吸い寄せに入った tick（10）の 1/12 から寄せ始め、12 tick 目に自機の位置に着く。
  assert.deepEqual(positionAt(10), { x: 100, y: 280 + 120 / PICKUP_ATTRACTION_VIEW_TICKS });
  assert.deepEqual(positionAt(15), { x: 100, y: 280 + 120 * 6 / PICKUP_ATTRACTION_VIEW_TICKS });
  assert.deepEqual(positionAt(21), { x: 100, y: 400 });
  assert.deepEqual(positionAt(30), { x: 100, y: 400 });
});

test("keeps the Core positions of attracted pickups without an attraction", () => {
  assert.deepEqual(collectViewEntities(stateAt(15, [pickup(7, true)]), null)[1]!.position, { x: 100, y: 280 });
});

test("forgets the attraction of pickups that left the frame and on clear", () => {
  const attraction = new PickupAttraction();
  collectViewEntities(stateAt(10, [pickup(7, true)]), attraction);
  collectViewEntities(stateAt(11), attraction);

  // 同じ id が再び吸い寄せに入っても（別の stage など）、新しい tick から寄せ直す。
  assert.deepEqual(attraction.positions([pickup(7, true)], player.position, 40).get(7), { x: 100, y: 290 });
  attraction.clear();
  assert.deepEqual(attraction.positions([pickup(7, true)], player.position, 50).get(7), { x: 100, y: 290 });
});
