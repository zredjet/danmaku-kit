import type { BulletId, EnemyId, PlayerId, PlayerShotId } from "../content/types.ts";
import type { EntityId } from "../simulation/entity.ts";
import type { EnemyBulletRuntimeEntity } from "./enemy-bullet/model.ts";
import type { EnemyRuntimeEntity } from "./enemy/model.ts";
import type { Vector2 } from "./model-common.ts";
import type { PlayerShotRuntimeEntity } from "./player-shot/model.ts";
import type { PlayerRuntimeEntity } from "./player/model.ts";

/**
 * renderer / debug / replay が読む最小 entity snapshot。
 *
 * runtime 内部 component はこの型へ直接混ぜず、`toReadonlyEntityState()` で
 * 表示・検査に必要な値だけを投影する。
 */
export type ReadonlyEntityState =
  | Readonly<{
    id: EntityId;
    kind: "player";
    definitionId: PlayerId;
    position: Vector2;
  }>
  | Readonly<{
    id: EntityId;
    kind: "enemy";
    definitionId: EnemyId;
    position: Vector2;
  }>
  | Readonly<{
    id: EntityId;
    kind: "enemyBullet";
    definitionId: BulletId;
    position: Vector2;
  }>
  | Readonly<{
    id: EntityId;
    kind: "playerShot";
    definitionId: PlayerShotId;
    position: Vector2;
  }>;

/** Core basic が扱う runtime entity の union。 */
export type RuntimeEntityState =
  | PlayerRuntimeEntity
  | EnemyRuntimeEntity
  | EnemyBulletRuntimeEntity
  | PlayerShotRuntimeEntity;

/** runtime entity から公開 frame 用の immutable snapshot を作る。 */
export function toReadonlyEntityState(entity: RuntimeEntityState): ReadonlyEntityState {
  switch (entity.kind) {
    case "player":
      return freezeSnapshot({
        id: entity.id,
        kind: "player",
        definitionId: entity.definitionId,
        position: entity.position,
      });
    case "enemy":
      return freezeSnapshot({
        id: entity.id,
        kind: "enemy",
        definitionId: entity.definitionId,
        position: entity.position,
      });
    case "enemyBullet":
      return freezeSnapshot({
        id: entity.id,
        kind: "enemyBullet",
        definitionId: entity.definitionId,
        position: entity.position,
      });
    case "playerShot":
      return freezeSnapshot({
        id: entity.id,
        kind: "playerShot",
        definitionId: entity.definitionId,
        position: entity.position,
      });
  }
}

function freezeSnapshot<T extends { position: Vector2 }>(entity: T): Readonly<T> {
  return Object.freeze({
    ...entity,
    position: Object.freeze({ x: entity.position.x, y: entity.position.y }),
  });
}
