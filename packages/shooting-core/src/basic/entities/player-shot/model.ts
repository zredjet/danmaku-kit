import type { PlayerShotDefinition, PlayerShotId } from "../../content/types.ts";
import { okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { EntityAllocator } from "../../simulation/entity.ts";
import type { EntityId } from "../../simulation/entity.ts";
import type { Vector2 } from "../model-common.ts";

/** 自機ショットの runtime component。projectile movement と lifetime cleanup に必要な値を保持する。 */
export type PlayerShotRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "playerShot";
  definitionId: PlayerShotId;
  position: Vector2;
  velocity: Vector2;
  collisionRadius: number;
  damage: number;
  remainingLifetimeTicks: number;
}>;

/** 検証済み snapshot から player shot runtime entity を復元するための入力。 */
export type RestoredPlayerShotRuntimeEntityInput = Readonly<{
  id: EntityId;
  definitionId: PlayerShotId;
  position: Vector2;
  velocity: Vector2;
  collisionRadius: number;
  damage: number;
  remainingLifetimeTicks: number;
}>;

/** PlayerShotDefinition から player shot runtime entity を作る。 */
export function createPlayerShotRuntimeEntity(
  allocator: EntityAllocator,
  playerShot: PlayerShotDefinition,
  position: Vector2,
): CoreResult<PlayerShotRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(createRestoredPlayerShotRuntimeEntity({
    id: entity.value.id,
    definitionId: playerShot.id,
    position: Object.freeze({ x: position.x, y: position.y }),
    velocity: Object.freeze({
      x: playerShot.projectile.velocity.x,
      y: playerShot.projectile.velocity.y,
    }),
    collisionRadius: playerShot.collision.radius,
    damage: playerShot.damage,
    remainingLifetimeTicks: playerShot.projectile.lifetimeTicks,
  }));
}

/** restore 済み player shot component を runtime が使う immutable entity に戻す。 */
export function createRestoredPlayerShotRuntimeEntity(
  input: RestoredPlayerShotRuntimeEntityInput,
): PlayerShotRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "playerShot",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    velocity: Object.freeze({ x: input.velocity.x, y: input.velocity.y }),
    collisionRadius: input.collisionRadius,
    damage: input.damage,
    remainingLifetimeTicks: input.remainingLifetimeTicks,
  });
}
