import type { EnemyDefinition, EnemyId, PathId, PatternId, StageTimelineAction } from "../../content/types.ts";
import { okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { EntityAllocator } from "../../simulation/entity.ts";
import type { EntityId } from "../../simulation/entity.ts";
import type { Vector2 } from "../model-common.ts";

type SpawnEnemyAction = Extract<StageTimelineAction, { type: "spawnEnemy" }>;

/** 敵の runtime component。今後の movement / pattern / score 解決に必要な参照を保持する。 */
export type EnemyRuntimeEntity = Readonly<{
  id: EntityId;
  kind: "enemy";
  definitionId: EnemyId;
  position: Vector2;
  pathId: PathId;
  patternId: PatternId;
  collisionRadius: number;
  hp: number;
  scoreOnKill: number;
}>;

/** 検証済み snapshot から enemy runtime entity を復元するための入力。 */
type RestoredEnemyRuntimeEntityInput = Omit<EnemyRuntimeEntity, "kind">;

/** Stage timeline の spawnEnemy action から enemy runtime entity を作る。 */
export function createEnemyRuntimeEntity(
  allocator: EntityAllocator,
  enemy: EnemyDefinition,
  action: SpawnEnemyAction,
): CoreResult<EnemyRuntimeEntity> {
  const entity = allocator.create();
  if (!entity.ok) {
    return entity;
  }

  return okResult(createRestoredEnemyRuntimeEntity({
    id: entity.value.id,
    definitionId: enemy.id,
    position: Object.freeze({
      x: action.position.x,
      y: action.position.y,
    }),
    pathId: action.path,
    patternId: action.pattern,
    collisionRadius: enemy.collision.radius,
    hp: enemy.hp,
    scoreOnKill: enemy.score,
  }));
}

/** restore 済み enemy component を runtime が使う immutable entity に戻す。 */
export function createRestoredEnemyRuntimeEntity(input: RestoredEnemyRuntimeEntityInput): EnemyRuntimeEntity {
  return Object.freeze({
    id: input.id,
    kind: "enemy",
    definitionId: input.definitionId,
    position: Object.freeze({ x: input.position.x, y: input.position.y }),
    pathId: input.pathId,
    patternId: input.patternId,
    collisionRadius: input.collisionRadius,
    hp: input.hp,
    scoreOnKill: input.scoreOnKill,
  });
}
