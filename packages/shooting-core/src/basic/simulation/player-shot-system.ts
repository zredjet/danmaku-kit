import type { PlayerShotDefinition } from "../content/types.ts";
import { createPlayerShotRuntimeEntity } from "../entities/player-shot/model.ts";
import type { PlayerShotRuntimeEntity } from "../entities/player-shot/model.ts";
import type { PlayerRuntimeEntity } from "../entities/player/model.ts";
import type { GameEvent } from "../events/game-event.ts";
import type { InputFrame } from "../input/input-frame.ts";
import { okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { EntityAllocator } from "./entity.ts";

type PlayerShotSpawnEventItem = Readonly<{
  entityId: PlayerShotRuntimeEntity["id"];
  definitionId: PlayerShotDefinition["id"];
  position: PlayerShotRuntimeEntity["position"];
}>;

/** 自機ショット生成 system が tick へ返す差分。 */
export type PlayerShotSpawnResult = Readonly<{
  entities: readonly [PlayerShotRuntimeEntity, ...PlayerShotRuntimeEntity[]];
  player: PlayerRuntimeEntity;
  spawnedShots: readonly [PlayerShotSpawnEventItem, ...PlayerShotSpawnEventItem[]];
  event: GameEvent;
}>;

/**
 * 入力に応じて自機ショットを 1 batch 生成する。
 *
 * `pressed` は初弾を落とさないための edge、`held` は interval に従う連射 intent として扱う。
 * 生成後は player の `nextShotAllowedTick` を進め、将来の replay / restore 対象になる cooldown を残す。
 */
export function spawnPlayerShotFromInput(
  allocator: EntityAllocator,
  input: InputFrame,
  player: PlayerRuntimeEntity,
  shot: PlayerShotDefinition,
): CoreResult<PlayerShotSpawnResult | null> {
  if (!isShotRequested(input) || input.tick < player.nextShotAllowedTick) {
    return okResult(null);
  }

  const entity = createPlayerShotRuntimeEntity(allocator, shot, player.position);
  if (!entity.ok) {
    return entity;
  }

  const entities = Object.freeze([entity.value]) as readonly [PlayerShotRuntimeEntity];
  const updatedPlayer = Object.freeze({
    ...player,
    movement: Object.freeze({
      speed: player.movement.speed,
      focusSpeed: player.movement.focusSpeed,
    }),
    position: Object.freeze({
      x: player.position.x,
      y: player.position.y,
    }),
    nextShotAllowedTick: input.tick + shot.fire.intervalTicks,
  });
  const spawnedShots = Object.freeze([Object.freeze({
    entityId: entity.value.id,
    definitionId: shot.id,
    position: entity.value.position,
  })]) as readonly [PlayerShotSpawnEventItem];

  return okResult(Object.freeze({
    entities,
    player: updatedPlayer,
    spawnedShots,
    event: buildPlayerShotsSpawnedBatchEvent(input.tick, spawnedShots),
  }));
}

/** 自機ショット生成差分から public gameplay event を作る。 */
function buildPlayerShotsSpawnedBatchEvent(
  tick: number,
  shots: readonly [PlayerShotSpawnEventItem, ...PlayerShotSpawnEventItem[]],
): GameEvent {
  return Object.freeze({
    type: "playerShotsSpawnedBatch",
    tick,
    shots: Object.freeze([...shots]) as typeof shots,
  });
}

/** 入力 frame がこの tick で通常ショット生成を要求しているか判定する。 */
function isShotRequested(input: InputFrame): boolean {
  return input.pressed.includes("shot") || input.held.includes("shot");
}
