import type { PathSegmentDefinition } from "../../content/types.ts";
import type { EnemyBulletRuntimeEntity } from "../../entities/enemy-bullet/model.ts";
import type { EnemyRuntimeEntity } from "../../entities/enemy/model.ts";
import type { Vector2 } from "../../entities/model-common.ts";
import { isSameRestorePosition } from "../../entities/restore-common.ts";
import type { PatternFireBullet, PatternFireCommand, PatternProgram } from "../../patterns/pattern-program.ts";
import { patternRunnerIdOfEnemy } from "../../patterns/pattern-runner.ts";
import type { EnemyPatternRunner, PatternRunnerState } from "../../patterns/pattern-runner.ts";
import {
  countPatternBulletsThrough,
  createPatternSchedule,
  patternRunAt,
  patternRunnerStateAt,
} from "../../patterns/pattern-schedule.ts";
import type { PatternSchedule } from "../../patterns/pattern-schedule.ts";
import { coreError, okResult } from "../../result.ts";
import type { CoreResult } from "../../result.ts";
import { compareUtf8Lexicographic } from "../../shared/utf8-order.ts";
import { angleStepsOfVector } from "../../simulation/deterministic-trig.ts";
import { isOutsideEnemyCleanupBounds } from "../../simulation/enemy-path-system.ts";
import { resolvePatternBulletVelocity } from "../../simulation/enemy-pattern-system.ts";
import { resolvePathRunnerAt } from "../../simulation/path-runner.ts";

/**
 * `steps` を持つ pattern で enemy を spawn した処理済み timeline step。restore が pattern の発射を spawn から求め直すのに使う。
 *
 * `lastFireElapsedTicks` は enemy が生き残っていれば run を実行できる最後の経過 tick（spawn tick が 0）で、path を終えて cleanup
 * される enemy はその tick まで、残る enemy は `expectedTick - 1` までになる。撃破された tick は分からないため、撃破されなかった
 * 場合の上限として扱う。
 */
export type RestorePatternFireSource = Readonly<{
  spawnIndex: number;
  spawnTick: number;
  spawnPosition: Vector2;
  segments: readonly PathSegmentDefinition[];
  schedule: PatternSchedule;
  lastFireElapsedTicks: number;
}>;

/** pattern が撃った弾と一致した生成 tick と、同じ tick の敵弾の中での採番順（`[1, spawn index, 命令順, fan 順]`）。 */
export type RestorePatternBulletMatch = Readonly<{
  fireTick: number;
  allocationOrder: readonly number[];
}>;

/** 検証済みの shape を持つ `patternRunnerStates` の 1 件。 */
export type RestorePatternRunnerStateInput = Readonly<{
  runnerId: string;
  patternId: string;
  state: PatternRunnerState;
}>;

/** program ごとの時刻表。program は load した content が持つ不変の値なので、同じ program の spawn で共有する。 */
const schedulesByProgram = new WeakMap<PatternProgram, PatternSchedule>();

function scheduleOf(program: PatternProgram): PatternSchedule {
  let schedule = schedulesByProgram.get(program);
  if (!schedule) {
    schedule = createPatternSchedule(program);
    schedulesByProgram.set(program, schedule);
  }
  return schedule;
}

/** 処理済み timeline step の spawn から、pattern の発射を求め直す source を作る。 */
export function createRestorePatternFireSource(
  spawn: Readonly<{ spawnIndex: number; spawnTick: number; spawnPosition: Vector2 }>,
  program: PatternProgram,
  segments: readonly PathSegmentDefinition[],
  expectedTick: number,
): RestorePatternFireSource {
  return Object.freeze({
    ...spawn,
    segments,
    schedule: scheduleOf(program),
    lastFireElapsedTicks: Math.min(
      expectedTick - 1 - spawn.spawnTick,
      resolveLastAliveElapsedTicks(spawn.spawnPosition, segments),
    ),
  });
}

/** enemy が撃破されずにいた場合に、source の pattern が撃つ弾数の上限を返す。`nextEntityId` の到達可能性に使う。 */
export function countRestorePatternBullets(source: RestorePatternFireSource): number {
  return source.lastFireElapsedTicks < 0 ? 0 : countPatternBulletsThrough(source.schedule, source.lastFireElapsedTicks);
}

/**
 * active enemyBullet が、処理済み spawn の pattern がその生成 tick に撃った弾のどれかと一致すれば、その弾を消費して生成 tick と
 * 採番順を返す。
 *
 * 生成 tick は `expectedTick - ageTicks`、生成位置はその tick の移動前の enemy 位置（spawn 位置から path を進めた位置）で、fan の
 * 何発目かまで一致する弾を 1 度だけ消費する。同じ tick の採番は fireOnSpawn の後、enemy の spawn 順、命令順、fan 順になる。
 */
export function takeRestorePatternBullet(
  sources: readonly RestorePatternFireSource[],
  consumedBullets: Set<string>,
  bullet: EnemyBulletRuntimeEntity,
  expectedTick: number,
): RestorePatternBulletMatch | null {
  const fireTick = expectedTick - bullet.ageTicks;
  for (const source of sources) {
    const elapsedTicks = fireTick - source.spawnTick;
    if (elapsedTicks < 0 || elapsedTicks > source.lastFireElapsedTicks) {
      continue;
    }
    const run = patternRunAt(source.schedule, elapsedTicks);
    if (!run || run.bulletCount === 0) {
      continue;
    }
    const origin = resolvePathRunnerAt(source.spawnPosition, source.segments, elapsedTicks).position;
    if (!isSameRestorePosition(origin, bullet.spawnPosition)) {
      continue;
    }
    for (const [fireIndex, fire] of run.fires.entries()) {
      if (fire.bullet !== bullet.definitionId) {
        continue;
      }
      for (const [bulletIndex, planned] of fire.bullets.entries()) {
        const key = `${source.spawnIndex}:${elapsedTicks}:${fireIndex}:${bulletIndex}`;
        if (consumedBullets.has(key) || !isPatternBulletVelocity(fire, planned, bullet.velocity)) {
          continue;
        }
        consumedBullets.add(key);
        return Object.freeze({
          fireTick,
          allocationOrder: Object.freeze([1, source.spawnIndex, fireIndex, bulletIndex]),
        });
      }
    }
  }
  return null;
}

/**
 * `patternRunnerStates` が、`steps` を持つ pattern で動く active enemy ごとに 1 つずつあり、spawn tick から `expectedTick` まで
 * 進めた runner と一致することを検証して、enemy id 順の runner を返す。
 */
export function validateRestorePatternRunners(
  runnerStates: readonly RestorePatternRunnerStateInput[],
  enemies: readonly Readonly<{ enemy: EnemyRuntimeEntity; spawnIndex: number; spawnTick: number }>[],
  sourcesBySpawnIndex: ReadonlyMap<number, RestorePatternFireSource>,
  expectedTick: number,
): CoreResult<readonly EnemyPatternRunner[]> {
  const expected = enemies.flatMap(({ enemy, spawnIndex, spawnTick }) => {
    const source = sourcesBySpawnIndex.get(spawnIndex);
    return source
      ? [{
        runnerId: patternRunnerIdOfEnemy(enemy.id),
        runner: Object.freeze({
          enemyId: enemy.id,
          patternId: enemy.patternId,
          state: patternRunnerStateAt(source.schedule, expectedTick - spawnTick),
        }),
      }]
      : [];
  }).sort((left, right) => compareUtf8Lexicographic(left.runnerId, right.runnerId));
  if (expected.length !== runnerStates.length) {
    return coreError("state.invalidShape", "state.patternRunnerStates must contain one runner for each enemy running pattern steps");
  }
  for (const [index, { runnerId, runner }] of expected.entries()) {
    const actual = runnerStates[index]!;
    if (
      actual.runnerId !== runnerId
      || actual.patternId !== runner.patternId
      || actual.state.cursor !== runner.state.cursor
      || actual.state.waitRemaining !== runner.state.waitRemaining
    ) {
      return coreError("state.invalidShape", "pattern runner state must match its enemy's pattern progress from spawn");
    }
  }

  return okResult(Object.freeze(expected.map(({ runner }) => runner).sort((left, right) => left.enemyId - right.enemyId)));
}

/** path を終えて cleanup される enemy が生きている最後の経過 tick を返す。cleanup されない enemy は無限大。 */
function resolveLastAliveElapsedTicks(spawnPosition: Vector2, segments: readonly PathSegmentDefinition[]): number {
  const pathTicks = segments.reduce((total, segment) => total + segment.duration, 0);
  const end = resolvePathRunnerAt(spawnPosition, segments, pathTicks);
  // path を終えた tick の update lifetime で取り除かれる。segment のない path の enemy は spawn tick に取り除かれる。
  return isOutsideEnemyCleanupBounds(end.position) ? Math.max(pathTicks, 1) - 1 : Number.POSITIVE_INFINITY;
}

/**
 * 弾の速度が発射命令と fan の何発目かから作れる値かを返す。
 *
 * 固定角度の弾は速度が完全に決まる。`aim: player` の基準の向きは発射した tick の自機の位置で決まり、自機の位置は入力の履歴による
 * ため、表のどれかの向きに speed を掛けた速度であることだけを確かめる。
 */
function isPatternBulletVelocity(fire: PatternFireCommand, planned: PatternFireBullet, velocity: Vector2): boolean {
  if (fire.direction.kind === "angle") {
    return isSameRestorePosition(resolvePatternBulletVelocity(fire.direction.angleSteps + planned.offsetSteps, planned.speed), velocity);
  }
  const steps = angleStepsOfVector(velocity);
  return [steps - 1, steps, steps + 1].some((candidate) => (
    isSameRestorePosition(resolvePatternBulletVelocity(candidate, planned.speed), velocity)
  ));
}
