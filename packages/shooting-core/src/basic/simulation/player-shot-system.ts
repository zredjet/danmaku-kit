import type { PlayerShotDefinition } from "../content/types.ts";
import type { GameEvent } from "../events/game-event.ts";
import type { InputFrame } from "../input/input-frame.ts";
import { okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { EntityAllocator } from "./entity.ts";
import { createPlayerShotRuntimeEntity } from "./runtime-entity.ts";
import type { PlayerRuntimeEntity, PlayerShotRuntimeEntity } from "./runtime-entity.ts";

type PlayerShotSpawnEventItem = Readonly<{
  entityId: PlayerShotRuntimeEntity["id"];
  definitionId: PlayerShotDefinition["id"];
  position: PlayerShotRuntimeEntity["position"];
}>;

/** 自機ショット生成 system が tick へ返す差分。 */
export type PlayerShotSpawnResult = Readonly<{
  entities: readonly [PlayerShotRuntimeEntity, ...PlayerShotRuntimeEntity[]];
  spawnedShots: readonly [PlayerShotSpawnEventItem, ...PlayerShotSpawnEventItem[]];
  event: GameEvent;
}>;

/**
 * 入力に応じて自機ショットを 1 batch 生成する。
 *
 * Phase 1A では押下 edge ごとの単発だけを扱う。held 連射は shot movement /
 * lifetime / runtime budget を入れるスライスで有効化する。
 */
export function spawnPlayerShotFromInput(
  allocator: EntityAllocator,
  input: InputFrame,
  player: PlayerRuntimeEntity,
  shot: PlayerShotDefinition,
): CoreResult<PlayerShotSpawnResult | null> {
  if (!isShotRequested(input)) {
    return okResult(null);
  }

  const entity = createPlayerShotRuntimeEntity(allocator, shot, player.position);
  if (!entity.ok) {
    return entity;
  }

  const entities = Object.freeze([entity.value]) as readonly [PlayerShotRuntimeEntity];
  const spawnedShots = Object.freeze([Object.freeze({
    entityId: entity.value.id,
    definitionId: shot.id,
    position: entity.value.position,
  })]) as readonly [PlayerShotSpawnEventItem];

  return okResult(Object.freeze({
    entities,
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
  return input.pressed.includes("shot");
}
