import { ENEMY_CLEANUP_PLAYFIELD_MARGIN, PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from "../content/runtime-budgets.ts";
import type { PathDefinition } from "../content/types.ts";
import type { Vector2 } from "../entities/model-common.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { advancePathRunner } from "./path-runner.ts";

/**
 * enemy を path に沿って 1 tick 動かし、path を終えて playfield 外の余白より外にいる enemy を取り除く。
 *
 * system order の updateMovement / updateLifetime にあたる。spawn した tick から動かし、cleanup は player shot の lifetime 切れと
 * 同じく event を出さない。path を解決できない場合は error を返し、呼び出し側で fatal として扱う。
 */
export function advanceEnemyPaths(
  entities: readonly RuntimeEntityState[],
  pathsById: ReadonlyMap<string, PathDefinition>,
): CoreResult<readonly RuntimeEntityState[]> {
  const advancedEntities: RuntimeEntityState[] = [];
  for (const entity of entities) {
    if (entity.kind !== "enemy") {
      advancedEntities.push(entity);
      continue;
    }
    const path = pathsById.get(entity.pathId);
    if (!path) {
      return coreError("path.notFound", `Path not found: ${entity.pathId}`);
    }

    const advance = advancePathRunner(entity.pathRunnerState, entity.position, path.segments ?? []);
    if (advance.finished && isOutsideEnemyCleanupBounds(advance.position)) {
      continue;
    }
    if (advance.state === entity.pathRunnerState) {
      advancedEntities.push(entity);
      continue;
    }
    advancedEntities.push(Object.freeze({
      ...entity,
      position: advance.position,
      pathRunnerState: advance.state,
    }));
  }

  return okResult(Object.freeze(advancedEntities));
}

/** enemy の中心が playfield を cleanup 余白より外れているかを返す。restore も同じ境界で到達不能な state を拒否する。 */
export function isOutsideEnemyCleanupBounds(position: Vector2): boolean {
  return position.x < -ENEMY_CLEANUP_PLAYFIELD_MARGIN
    || position.x > PLAYFIELD_WIDTH + ENEMY_CLEANUP_PLAYFIELD_MARGIN
    || position.y < -ENEMY_CLEANUP_PLAYFIELD_MARGIN
    || position.y > PLAYFIELD_HEIGHT + ENEMY_CLEANUP_PLAYFIELD_MARGIN;
}
