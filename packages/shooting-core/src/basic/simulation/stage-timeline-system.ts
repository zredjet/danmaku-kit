import type { EnemyDefinition, StageTimelineStep } from "../content/types.ts";
import { createEnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { GameEvent } from "../events/game-event.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { EntityAllocator } from "./entity.ts";

/** stage timeline system が tick へ返す差分。 */
export type StageTimelineAdvanceResult = Readonly<{
  entities: readonly EnemyRuntimeEntity[];
  events: readonly GameEvent[];
  timelineCursor: number;
}>;

/**
 * 現在 tick に到達した stage timeline step を timeline 順に実行する。
 *
 * system order の `updateStageTimeline` にあたる。`spawnEnemy` step ごとに entity id を採番して enemy runtime entity と
 * `entitySpawned` event を作り、実行した step の分だけ cursor を進める。敵定義を解決できない場合や採番できない場合は
 * error を返し、呼び出し側で fatal として扱う。
 */
export function advanceStageTimeline(
  allocator: EntityAllocator,
  tick: number,
  timeline: readonly StageTimelineStep[],
  timelineCursor: number,
  enemiesById: ReadonlyMap<string, EnemyDefinition>,
): CoreResult<StageTimelineAdvanceResult> {
  const entities: EnemyRuntimeEntity[] = [];
  const events: GameEvent[] = [];
  let cursor = timelineCursor;

  while (cursor < timeline.length && timeline[cursor]!.tick === tick) {
    const step = timeline[cursor]!;
    if (step.action.type === "spawnEnemy") {
      const enemyDefinition = enemiesById.get(step.action.enemy);
      if (!enemyDefinition) {
        return coreError("enemy.notFound", `Enemy not found: ${step.action.enemy}`);
      }
      const entity = createEnemyRuntimeEntity(allocator, enemyDefinition, step.action);
      if (!entity.ok) {
        return entity;
      }
      entities.push(entity.value);
      events.push(Object.freeze({
        type: "entitySpawned",
        tick,
        entityId: entity.value.id,
        entityKind: "enemy",
        definitionId: step.action.enemy,
        path: step.action.path,
        pattern: step.action.pattern,
        position: step.action.position,
      }));
    }
    cursor += 1;
  }

  return okResult(Object.freeze({
    entities: Object.freeze(entities),
    events: Object.freeze(events),
    timelineCursor: cursor,
  }));
}
