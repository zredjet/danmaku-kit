import type { LoadedContentIndex } from "../../content/content-index.ts";
import type { PathSegmentDefinition, StageDefinition } from "../../content/types.ts";
import type { EnemyRuntimeEntity } from "../../entities/enemy/model.ts";
import { isSameRestorePosition } from "../../entities/restore-common.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { resolveEnemyBulletSpawnPosition } from "../../simulation/enemy-bullet-system.ts";
import { isOutsideEnemyCleanupBounds } from "../../simulation/enemy-path-system.ts";
import { resolvePathRunnerAt } from "../../simulation/path-runner.ts";
import type { RestoreTopLevelState } from "./top-level-state.ts";

export type RestoreSpawnBudget = Readonly<{
  enemySpawnCandidates: RestoreEnemySpawnCandidate[];
  enemyBulletCandidates: RestoreEnemyBulletCandidate[];
}>;

type RestoreEnemySpawnCandidate = Readonly<{
  tick: number;
  allocationOrder: number;
  definitionId: string;
  pathId: string;
  patternId: string;
  position: Readonly<{ x: number; y: number }>;
}>;

type RestoreEnemyBulletCandidate = Readonly<{
  tick: number;
  allocationOrder: number;
  definitionId: string;
  position: Readonly<{ x: number; y: number }>;
}>;

export type RestoreMatchedSpawn = Readonly<{
  id: number;
  tick: number;
  allocationOrder: number;
}>;

export type RestoreMatchedPlayerShot = Readonly<{
  id: number;
  spawnTick: number;
}>;

/** 処理済み timeline step から存在し得る enemy / enemyBullet の上限を作る。 */
export function createRestoreSpawnBudget(
  stage: StageDefinition,
  timelineCursor: number,
  content: LoadedContentIndex,
): CoreResult<RestoreSpawnBudget> {
  const enemySpawnCandidates: RestoreEnemySpawnCandidate[] = [];
  const enemyBulletCandidates: RestoreEnemyBulletCandidate[] = [];
  for (let index = 0; index < timelineCursor; index += 1) {
    const step = stage.timeline[index];
    if (!step || step.action.type !== "spawnEnemy") {
      continue;
    }
    enemySpawnCandidates.push({
      tick: step.tick,
      allocationOrder: enemySpawnCandidates.length,
      definitionId: step.action.enemy,
      pathId: step.action.path,
      patternId: step.action.pattern,
      position: Object.freeze({ x: step.action.position.x, y: step.action.position.y }),
    });

    const pattern = content.patternsById.get(step.action.pattern);
    if (!pattern) {
      return coreError("state.registryInvalid", "stage timeline references an unknown pattern");
    }
    if (pattern.fireOnSpawn) {
      const position = resolveEnemyBulletSpawnPosition(
        "restore",
        step.action.position,
        pattern.id,
        pattern.fireOnSpawn,
      );
      if (!position.ok) {
        return coreError("state.registryInvalid", "stage timeline contains an invalid enemy bullet spawn position");
      }
      enemyBulletCandidates.push({
        tick: step.tick,
        allocationOrder: enemyBulletCandidates.length,
        definitionId: pattern.fireOnSpawn.bullet,
        position: position.value,
      });
    }
  }

  return okResult(Object.freeze({ enemySpawnCandidates, enemyBulletCandidates }));
}

/** nextEntityId が processed timeline と入力由来 shot の最大生成数から到達可能な範囲か検証する。 */
export function validateRestoreAllocationEnvelope(
  state: RestoreTopLevelState,
  spawnBudget: RestoreSpawnBudget,
): CoreResult<null> {
  const maxPlayerShotAllocations = state.expectedTick;
  const maxReachableNextEntityId = 2
    + spawnBudget.enemySpawnCandidates.length
    + spawnBudget.enemyBulletCandidates.length
    + maxPlayerShotAllocations;
  if (state.nextEntityId > maxReachableNextEntityId) {
    return coreError("state.invalidShape", "nextEntityId exceeds the deterministic allocation envelope");
  }

  return okResult(null);
}

/**
 * active enemy が処理済み timeline の spawn と同じ参照から来て、その spawn から path を進めた状態にあることを検証する。
 *
 * spawn tick から `expectedTick` までの tick 数だけ spawn 位置から path を進めた runner と位置を求め、restore した値と完全一致する
 * spawn を選ぶ。現在座標から path を逆算しない。path を終えて cleanup 境界の外にいるはずの spawn は runtime に残らないため選ばない。
 */
export function consumeRestoreEnemySpawnBudget(
  candidates: RestoreEnemySpawnCandidate[],
  enemy: EnemyRuntimeEntity,
  segments: readonly PathSegmentDefinition[],
  expectedTick: number,
): CoreResult<RestoreMatchedSpawn> {
  const index = candidates.findIndex((candidate) => (
    candidate.definitionId === enemy.definitionId
    && candidate.pathId === enemy.pathId
    && candidate.patternId === enemy.patternId
    && isEnemyAtPathProgress(enemy, candidate.position, segments, expectedTick - candidate.tick)
  ));
  if (index === -1) {
    return coreError("state.invalidShape", "enemy runtime entity must follow its path from a processed timeline spawn");
  }
  const [candidate] = candidates.splice(index, 1);
  if (!candidate) {
    return coreError("state.invalidShape", "enemy runtime entity must follow its path from a processed timeline spawn");
  }

  return okResult(Object.freeze({
    id: enemy.id,
    tick: candidate.tick,
    allocationOrder: candidate.allocationOrder,
  }));
}

/** spawn 位置から `progressTicks` tick 進めた path runner と位置が enemy と一致し、cleanup されていないかを返す。 */
function isEnemyAtPathProgress(
  enemy: EnemyRuntimeEntity,
  spawnPosition: Readonly<{ x: number; y: number }>,
  segments: readonly PathSegmentDefinition[],
  progressTicks: number,
): boolean {
  const expected = resolvePathRunnerAt(spawnPosition, segments, progressTicks);
  if (expected.finished && isOutsideEnemyCleanupBounds(expected.position)) {
    return false;
  }
  return expected.state.segmentIndex === enemy.pathRunnerState.segmentIndex
    && expected.state.segmentElapsedTicks === enemy.pathRunnerState.segmentElapsedTicks
    && isSameRestorePosition(expected.state.segmentStart, enemy.pathRunnerState.segmentStart)
    && isSameRestorePosition(expected.position, enemy.position);
}

/** active enemyBullet が処理済み fireOnSpawn と同じ弾・位置から来ていることを検証する。 */
export function consumeRestoreEnemyBulletBudget(
  candidates: RestoreEnemyBulletCandidate[],
  entity: Record<string, unknown>,
  position: Readonly<{ x: number; y: number }>,
): CoreResult<RestoreMatchedSpawn> {
  const index = candidates.findIndex((candidate) => (
    candidate.definitionId === entity.definitionId
    && isSameRestorePosition(candidate.position, position)
  ));
  if (index === -1) {
    return coreError("state.invalidShape", "enemy bullet runtime entity must originate from a processed timeline spawn");
  }
  const [candidate] = candidates.splice(index, 1);
  if (!candidate) {
    return coreError("state.invalidShape", "enemy bullet runtime entity must originate from a processed timeline spawn");
  }

  return okResult(Object.freeze({
    id: Number(entity.id),
    tick: candidate.tick,
    allocationOrder: candidate.allocationOrder,
  }));
}

/** 同じ tick では enemy、enemyBullet、playerShot の順に採番されることを検証する。 */
export function validateRestoreSameTickAllocationOrder(
  enemies: readonly RestoreMatchedSpawn[],
  enemyBullets: readonly RestoreMatchedSpawn[],
  playerShots: readonly RestoreMatchedPlayerShot[],
): CoreResult<null> {
  const enemyOrder = validateRestoreSameKindAllocationOrder(enemies, "enemy");
  if (!enemyOrder.ok) {
    return enemyOrder;
  }
  const bulletOrder = validateRestoreSameKindAllocationOrder(enemyBullets, "enemy bullet");
  if (!bulletOrder.ok) {
    return bulletOrder;
  }

  for (const bullet of enemyBullets) {
    for (const enemy of enemies) {
      if (bullet.tick === enemy.tick && bullet.id < enemy.id) {
        return coreError("state.invalidShape", "enemy bullet id must follow same-tick enemy allocations");
      }
    }
  }
  for (const shot of playerShots) {
    for (const enemy of enemies) {
      if (shot.spawnTick === enemy.tick && shot.id < enemy.id) {
        return coreError("state.invalidShape", "player shot id must follow same-tick enemy allocations");
      }
    }
    for (const bullet of enemyBullets) {
      if (shot.spawnTick === bullet.tick && shot.id < bullet.id) {
        return coreError("state.invalidShape", "player shot id must follow same-tick enemy bullet allocations");
      }
    }
  }

  const crossTickOrder = validateRestoreCrossTickAllocationOrder(enemies, enemyBullets, playerShots);
  if (!crossTickOrder.ok) {
    return crossTickOrder;
  }

  return okResult(null);
}

/** 同 kind / 同 tick の entity id が runtime の allocation order と同じ順序か検証する。 */
function validateRestoreSameKindAllocationOrder(
  matches: readonly RestoreMatchedSpawn[],
  label: "enemy" | "enemy bullet",
): CoreResult<null> {
  const latestOrderByTick = new Map<number, number>();
  for (const match of matches) {
    const latestOrder = latestOrderByTick.get(match.tick);
    if (latestOrder !== undefined && match.allocationOrder <= latestOrder) {
      return coreError("state.invalidShape", `${label} runtime entity ids must follow same-tick allocation order`);
    }
    latestOrderByTick.set(match.tick, match.allocationOrder);
  }

  return okResult(null);
}

/** active entity id の昇順が tick をまたいだ allocator の生成順と一致することを検証する。 */
function validateRestoreCrossTickAllocationOrder(
  enemies: readonly RestoreMatchedSpawn[],
  enemyBullets: readonly RestoreMatchedSpawn[],
  playerShots: readonly RestoreMatchedPlayerShot[],
): CoreResult<null> {
  const allocations = [
    ...enemies.map((enemy) => ({
      id: enemy.id,
      tick: enemy.tick,
      phase: 0,
      allocationOrder: enemy.allocationOrder,
    })),
    ...enemyBullets.map((bullet) => ({
      id: bullet.id,
      tick: bullet.tick,
      phase: 1,
      allocationOrder: bullet.allocationOrder,
    })),
    ...playerShots.map((shot) => ({
      id: shot.id,
      tick: shot.spawnTick,
      phase: 2,
      allocationOrder: 0,
    })),
  ].sort((left, right) => left.id - right.id);

  let previous: (typeof allocations)[number] | null = null;
  for (const allocation of allocations) {
    if (previous && compareRestoreAllocationOrder(previous, allocation) >= 0) {
      return coreError("state.invalidShape", "runtime entity ids must follow deterministic allocation order across ticks");
    }
    previous = allocation;
  }

  return okResult(null);
}

/** tick、system phase、同 phase 内 order の順で allocator 順序を比較する。 */
function compareRestoreAllocationOrder(
  left: Readonly<{ tick: number; phase: number; allocationOrder: number }>,
  right: Readonly<{ tick: number; phase: number; allocationOrder: number }>,
): number {
  return left.tick - right.tick
    || left.phase - right.phase
    || left.allocationOrder - right.allocationOrder;
}
