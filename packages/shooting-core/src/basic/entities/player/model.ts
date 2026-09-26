import type { PlayerDefinition, PlayerId, PlayerShotId } from "../../content/types.ts";
import { okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { EntityAllocator } from "../../simulation/entity.ts";
import type { EntityId } from "../../simulation/entity.ts";
import type { Vector2 } from "../model-common.ts";

/** startStage 直後の player 初期位置。restore の初期 snapshot 検証でも同じ値を使う。 */
export const DEFAULT_PLAYER_START_POSITION = Object.freeze({ x: 192, y: 400 });

/** 自機の runtime component。移動、被弾、shot cooldown に必要な最小値を保持する。 */
export type PlayerRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "player";
  definitionId: PlayerId;
  position: Vector2;
  movement: Readonly<{
    speed: number;
    focusSpeed: number;
  }>;
  collisionRadius: number;
  lives: number;
  invincibleTicksRemaining: number;
  shotDefinitionId: PlayerShotId;
  nextShotAllowedTick: number;
}>;

/** 検証済み snapshot から player runtime entity を復元するための入力。 */
export type RestoredPlayerRuntimeEntityInput = Readonly<{
  id: EntityId;
  definitionId: PlayerId;
  position: Vector2;
  movement: PlayerRuntimeEntity["movement"];
  collisionRadius: number;
  lives: number;
  invincibleTicksRemaining: number;
  shotDefinitionId: PlayerShotId;
  nextShotAllowedTick: number;
}>;

/** PlayerDefinition から stage 開始時の player runtime entity を作る。 */
export function createPlayerRuntimeEntity(
  allocator: EntityAllocator,
  player: PlayerDefinition,
): CoreResult<PlayerRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(createRestoredPlayerRuntimeEntity({
    id: entity.value.id,
    definitionId: player.id,
    position: DEFAULT_PLAYER_START_POSITION,
    movement: Object.freeze({
      speed: player.movement.speed,
      focusSpeed: player.movement.focusSpeed,
    }),
    collisionRadius: player.collision.radius,
    lives: player.life.initialLives,
    invincibleTicksRemaining: 0,
    shotDefinitionId: player.shot.definition,
    nextShotAllowedTick: 0,
  }));
}

/** restore 済み player component を runtime が使う immutable entity に戻す。 */
export function createRestoredPlayerRuntimeEntity(input: RestoredPlayerRuntimeEntityInput): PlayerRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "player",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    movement: Object.freeze({
      speed: input.movement.speed,
      focusSpeed: input.movement.focusSpeed,
    }),
    collisionRadius: input.collisionRadius,
    lives: input.lives,
    invincibleTicksRemaining: input.invincibleTicksRemaining,
    shotDefinitionId: input.shotDefinitionId,
    nextShotAllowedTick: input.nextShotAllowedTick,
  });
}
