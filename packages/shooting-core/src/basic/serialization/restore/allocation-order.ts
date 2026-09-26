import type { LoadedContentIndex } from "../../content/content-index.ts";
import type { PathSegmentDefinition, StageDefinition } from "../../content/types.ts";
import type { EnemyBulletRuntimeEntity } from "../../entities/enemy-bullet/model.ts";
import type { EnemyRuntimeEntity } from "../../entities/enemy/model.ts";
import { isSameRestorePosition } from "../../entities/restore-common.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import {
  isOutsideEnemyBulletCleanupBounds,
  resolveEnemyBulletPositionAt,
} from "../../simulation/enemy-bullet-movement-system.ts";
import { resolveEnemyBulletSpawnPosition, resolveEnemyBulletSpawnVelocity } from "../../simulation/enemy-bullet-system.ts";
import { isOutsideEnemyCleanupBounds } from "../../simulation/enemy-path-system.ts";
import { resolvePathRunnerAt } from "../../simulation/path-runner.ts";
import {
  countRestorePatternBullets,
  createRestorePatternFireSource,
  takeRestorePatternBullet,
} from "./pattern-fires.ts";
import type { RestorePatternFireSource } from "./pattern-fires.ts";
import type { RestoreTopLevelState } from "./top-level-state.ts";

export type RestoreSpawnBudget = Readonly<{
  enemySpawnCandidates: RestoreEnemySpawnCandidate[];
  enemyBulletCandidates: RestoreEnemyBulletCandidate[];
  /** `steps` を持つ pattern で spawn した step の発射 source。spawn index の昇順。 */
  patternFireSources: readonly RestorePatternFireSource[];
  /** 消費済みの pattern 発射弾（spawn index、経過 tick、命令順、fan 順）。 */
  consumedPatternBullets: Set<string>;
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
  velocity: Readonly<{ x: number; y: number }>;
}>;

/**
 * active entity と一致した生成元。`allocationOrder` は同じ tick・同じ kind の中の採番順を辞書順で比べる数列で、enemy は
 * spawn index、fireOnSpawn の敵弾は `[0, 候補 index]`、pattern の敵弾は `[1, spawn index, 命令順, fan 順]` になる。
 */
export type RestoreMatchedSpawn = Readonly<{
  id: number;
  tick: number;
  allocationOrder: readonly number[];
}>;

/** 処理済み timeline step と一致した enemy。`spawnIndex` は timeline の spawnEnemy step の順番。 */
export type RestoreMatchedEnemySpawn = RestoreMatchedSpawn & Readonly<{
  spawnIndex: number;
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
  expectedTick: number,
): CoreResult<RestoreSpawnBudget> {
  const enemySpawnCandidates: RestoreEnemySpawnCandidate[] = [];
  const enemyBulletCandidates: RestoreEnemyBulletCandidate[] = [];
  const patternFireSources: RestorePatternFireSource[] = [];
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
    const program = content.patternProgramsById.get(pattern.id);
    if (program) {
      patternFireSources.push(createRestorePatternFireSource(
        { spawnIndex: enemySpawnCandidates.length - 1, spawnTick: step.tick, spawnPosition: step.action.position },
        program,
        content.pathsById.get(step.action.path)?.segments ?? [],
        expectedTick,
      ));
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
        velocity: resolveEnemyBulletSpawnVelocity(pattern.fireOnSpawn),
      });
    }
  }

  return okResult(Object.freeze({
    enemySpawnCandidates,
    enemyBulletCandidates,
    patternFireSources: Object.freeze(patternFireSources),
    consumedPatternBullets: new Set<string>(),
  }));
}

/**
 * nextEntityId が processed timeline、pattern の発射と入力由来 shot の最大生成数から到達可能な範囲か検証する。
 *
 * pattern の発射数は、enemy が撃破されずに path を終えるまで（または `expectedTick` まで）撃ち続けた場合の上限を使う。
 */
export function validateRestoreAllocationEnvelope(
  state: RestoreTopLevelState,
  spawnBudget: RestoreSpawnBudget,
): CoreResult<null> {
  const maxPlayerShotAllocations = state.expectedTick;
  const maxPatternBulletAllocations = spawnBudget.patternFireSources.reduce(
    (total, source) => total + countRestorePatternBullets(source),
    0,
  );
  const maxReachableNextEntityId = 2
    + spawnBudget.enemySpawnCandidates.length
    + spawnBudget.enemyBulletCandidates.length
    + maxPatternBulletAllocations
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
): CoreResult<RestoreMatchedEnemySpawn> {
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
    allocationOrder: Object.freeze([candidate.allocationOrder]),
    spawnIndex: candidate.allocationOrder,
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

/**
 * active enemyBullet が処理済み fireOnSpawn か pattern の発射と同じ弾・速度から生成され、その生成 tick から動いた状態にあることを
 * 検証する。
 *
 * 生成位置と速度が生成元と一致し、`ageTicks` が生成 tick から `expectedTick` までの tick 数と、`position` が
 * `spawnPosition + velocity * ageTicks` と完全一致する生成元を選ぶ。等速直線運動の各座標は tick に対して単調なので、1 tick 目と
 * 現在の位置がどちらも cleanup 境界の内側なら途中でも内側にあり、cleanup されずに残る敵弾だけを受け付けられる。
 */
export function consumeRestoreEnemyBulletBudget(
  budget: RestoreSpawnBudget,
  bullet: EnemyBulletRuntimeEntity,
  expectedTick: number,
): CoreResult<RestoreMatchedSpawn> {
  const match = isEnemyBulletAtAge(bullet)
    ? takeFireOnSpawnBullet(budget.enemyBulletCandidates, bullet, expectedTick)
      ?? takePatternBullet(budget, bullet, expectedTick)
    : null;
  if (!match) {
    return coreError(
      "state.invalidShape",
      "enemy bullet runtime entity must move from a processed timeline spawn or pattern fire",
    );
  }
  return okResult(match);
}

/** 処理済み spawn の pattern が撃った弾から一致する敵弾を 1 つ取り出す。 */
function takePatternBullet(
  budget: RestoreSpawnBudget,
  bullet: EnemyBulletRuntimeEntity,
  expectedTick: number,
): RestoreMatchedSpawn | null {
  const match = takeRestorePatternBullet(budget.patternFireSources, budget.consumedPatternBullets, bullet, expectedTick);
  return match ? Object.freeze({ id: bullet.id, tick: match.fireTick, allocationOrder: match.allocationOrder }) : null;
}

/** 処理済み fireOnSpawn の候補から一致する敵弾を 1 つ取り出す。 */
function takeFireOnSpawnBullet(
  candidates: RestoreEnemyBulletCandidate[],
  bullet: EnemyBulletRuntimeEntity,
  expectedTick: number,
): RestoreMatchedSpawn | null {
  const index = candidates.findIndex((candidate) => (
    candidate.definitionId === bullet.definitionId
    && isSameRestorePosition(candidate.position, bullet.spawnPosition)
    && isSameRestorePosition(candidate.velocity, bullet.velocity)
    && bullet.ageTicks === expectedTick - candidate.tick
  ));
  const [candidate] = index === -1 ? [] : candidates.splice(index, 1);
  if (!candidate) {
    return null;
  }
  return Object.freeze({
    id: bullet.id,
    tick: candidate.tick,
    allocationOrder: Object.freeze([0, candidate.allocationOrder]),
  });
}

/** 敵弾の位置が生成位置から `ageTicks` 動いた位置と一致し、1 tick 目から現在まで cleanup 境界の内側にあるかを返す。 */
function isEnemyBulletAtAge(bullet: EnemyBulletRuntimeEntity): boolean {
  const expectedPosition = resolveEnemyBulletPositionAt(bullet.spawnPosition, bullet.velocity, bullet.ageTicks);
  return isSameRestorePosition(expectedPosition, bullet.position)
    && !isOutsideEnemyBulletCleanupBounds(resolveEnemyBulletPositionAt(bullet.spawnPosition, bullet.velocity, 1))
    && !isOutsideEnemyBulletCleanupBounds(expectedPosition);
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
  const latestOrderByTick = new Map<number, readonly number[]>();
  for (const match of matches) {
    const latestOrder = latestOrderByTick.get(match.tick);
    if (latestOrder !== undefined && compareAllocationOrderSequence(match.allocationOrder, latestOrder) <= 0) {
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
      allocationOrder: Object.freeze([0]),
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
  left: Readonly<{ tick: number; phase: number; allocationOrder: readonly number[] }>,
  right: Readonly<{ tick: number; phase: number; allocationOrder: readonly number[] }>,
): number {
  return left.tick - right.tick
    || left.phase - right.phase
    || compareAllocationOrderSequence(left.allocationOrder, right.allocationOrder);
}

/** 同 phase 内の採番順の数列を辞書順で比べる。 */
function compareAllocationOrderSequence(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}
