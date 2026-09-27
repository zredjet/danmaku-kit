import { deepFreezeClone } from "../shared/immutable.ts";
import type { BulletId, EnemyId, PathId, PatternId, PickupId, PlayerId, PlayerShotId, StageId } from "../content/types.ts";
import type { EntityId } from "../simulation/entity.ts";

type EnemyBulletSpawnedEventItem = Readonly<{
  entityId: EntityId;
  definitionId: BulletId;
  position: Readonly<{
    x: number;
    y: number;
  }>;
}>;

type PlayerShotSpawnedEventItem = Readonly<{
  entityId: EntityId;
  definitionId: PlayerShotId;
  position: Readonly<{
    x: number;
    y: number;
  }>;
}>;

/** pickup feature が出した pickup。 */
type PickupSpawnedEventItem = Readonly<{
  entityId: EntityId;
  definitionId: PickupId;
  position: Readonly<{
    x: number;
    y: number;
  }>;
}>;

type EntityDestroyedEvent =
  | Readonly<{
    type: "entityDestroyed";
    tick: number;
    entityId: EntityId;
    entityKind: "enemy";
    reason: "defeated";
  }>
  | Readonly<{
    type: "entityDestroyed";
    tick: number;
    entityId: EntityId;
    entityKind: "enemyBullet" | "playerShot";
    reason: "collision";
  }>;

/**
 * Core が生成する gameplay event。
 *
 * event payload は各 system step で発生した時点の事実を表す。`GameFrame.state` は
 * tick 終了時点の snapshot なので、同じ entity の position が event と state で
 * 異なる場合がある。
 *
 * 描画・音声・DOM の都合で発生する runtime event はここに混ぜない。
 */
export type GameEvent =
  | Readonly<{
    type: "stageStarted";
    tick: number;
    stageId: StageId;
  }>
  | Readonly<{
    type: "tickAdvanced";
    tick: number;
  }>
  | Readonly<{
    type: "entitySpawned";
    tick: number;
    entityId: EntityId;
    entityKind: "enemy";
    definitionId: EnemyId;
    path: PathId;
    pattern: PatternId;
    position: Readonly<{
      x: number;
      y: number;
    }>;
  }>
  | EntityDestroyedEvent
  | Readonly<{
    type: "playerHit";
    tick: number;
    playerId: PlayerId;
    sourceEntityId: EntityId;
    sourceEntityKind: "enemy" | "enemyBullet";
    livesRemaining: number;
    invincibleTicksRemaining: number;
  }>
  | Readonly<{
    type: "playerShotsSpawnedBatch";
    tick: number;
    shots: readonly [PlayerShotSpawnedEventItem, ...PlayerShotSpawnedEventItem[]];
  }>
  | Readonly<{
    type: "enemyBulletsSpawnedBatch";
    tick: number;
    bullets: readonly [EnemyBulletSpawnedEventItem, ...EnemyBulletSpawnedEventItem[]];
  }>
  | Readonly<{
    /** timeline をすべて処理し、active な enemy がいなくなった tick に出る。以後の tick は受け付けない。 */
    type: "stageCleared";
    tick: number;
    stageId: StageId;
  }>
  | Readonly<{
    /** 自機の残機が 0 になった tick に出る。以後の tick は受け付けない。 */
    type: "gameOver";
    tick: number;
    stageId: StageId;
  }>
  | Readonly<{
    type: "scoreChanged";
    tick: number;
    delta: number;
    total: number;
    reason: "enemyDefeated";
    enemyId: EnemyId;
    entityId: EntityId;
  }>
  | Readonly<{
    /** pickup feature: 撃破された enemy の drops から、この tick に出た pickup（entity id の順）。 */
    type: "pickupsSpawnedBatch";
    tick: number;
    pickups: readonly [PickupSpawnedEventItem, ...PickupSpawnedEventItem[]];
  }>
  | Readonly<{
    /** pickup feature: 自機が回収した pickup。続けて同じ pickup の `scoreChanged`（reason `pickupCollected`）が出る。 */
    type: "pickupCollected";
    tick: number;
    entityId: EntityId;
    definitionId: PickupId;
  }>
  | Readonly<{
    type: "scoreChanged";
    tick: number;
    delta: number;
    total: number;
    reason: "pickupCollected";
    pickupId: PickupId;
    entityId: EntityId;
  }>;

/**
 * 1 frame 分の event を集める小さな buffer。
 *
 * replay/debug で過去 frame が汚染されないよう、push と drain の両方で immutable
 * snapshot を作る。
 */
export class EventLog {
  #events: GameEvent[] = [];

  /** 現在 tick で発生した gameplay event を追加する。 */
  push(event: GameEvent): void {
    this.#events.push(deepFreezeClone(event));
  }

  /** 蓄積済み event を immutable array として返し、buffer を空にする。 */
  drain(): ReadonlyArray<GameEvent> {
    const drained = deepFreezeClone(this.#events);
    this.#events = [];
    return drained;
  }
}
