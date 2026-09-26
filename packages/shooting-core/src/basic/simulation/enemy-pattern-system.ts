import { MAX_PATTERN_COMMANDS_PER_TICK } from "../content/runtime-budgets.ts";
import type { BulletDefinition } from "../content/types.ts";
import type { EnemyRuntimeEntity } from "../entities/enemy/model.ts";
import type { Vector2 } from "../entities/model-common.ts";
import type { RuntimeEntityState } from "../entities/runtime-entity.ts";
import type { PatternFireCommand, PatternProgram } from "../patterns/pattern-program.ts";
import { advancePatternRunner } from "../patterns/pattern-runner.ts";
import type { EnemyPatternRunner } from "../patterns/pattern-runner.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { angleStepsOfVector, unitVectorAtAngleSteps } from "./deterministic-trig.ts";
import type { EnemyBulletSpawnPlan } from "./enemy-bullet-system.ts";

/** pattern runner を 1 tick 進めた結果。`bullets` は spawn substep で生成する敵弾の計画で、runner の enemy id 順に並ぶ。 */
export type EnemyPatternAdvance = Readonly<{
  runners: readonly EnemyPatternRunner[];
  bullets: readonly EnemyBulletSpawnPlan[];
}>;

/**
 * 全 enemy の pattern runner を enemy id 順に 1 tick 進め、撃つ敵弾の生成計画を返す（design 7.1 の update enemy behavior / pattern）。
 *
 * 発射元は enemy の現在位置（その tick の移動前）、`aim: player` は自機の現在位置へ向く。1 tick に実行した命令数が
 * `MAX_PATTERN_COMMANDS_PER_TICK` を超えたら error を返し、呼び出し側で fatal として扱う。
 */
export function advanceEnemyPatterns(
  runners: readonly EnemyPatternRunner[],
  entities: readonly RuntimeEntityState[],
  programsById: ReadonlyMap<string, PatternProgram>,
  bulletsById: ReadonlyMap<string, BulletDefinition>,
  playerPosition: Vector2,
): CoreResult<EnemyPatternAdvance> {
  const enemiesById = new Map<number, EnemyRuntimeEntity>();
  for (const entity of entities) {
    if (entity.kind === "enemy") {
      enemiesById.set(entity.id, entity);
    }
  }

  const advancedRunners: EnemyPatternRunner[] = [];
  const bullets: EnemyBulletSpawnPlan[] = [];
  let executedCommands = 0;
  for (const runner of runners) {
    const program = programsById.get(runner.patternId);
    if (!program) {
      return coreError("pattern.notFound", `Pattern program not found: ${runner.patternId}`);
    }
    const enemy = enemiesById.get(runner.enemyId);
    if (!enemy) {
      return coreError("enemy.notFound", `Pattern runner enemy not found: ${runner.enemyId}`);
    }
    const advance = advancePatternRunner(program, runner.state);
    advancedRunners.push(Object.freeze({ ...runner, state: advance.state }));
    if (!advance.run) {
      continue;
    }
    executedCommands += advance.run.executedCommands;
    if (executedCommands > MAX_PATTERN_COMMANDS_PER_TICK) {
      return coreError(
        "pattern.budgetExceeded",
        `Pattern commands in one tick would exceed ${MAX_PATTERN_COMMANDS_PER_TICK}: ${runner.patternId}`,
      );
    }
    for (const fire of advance.run.fires) {
      const planned = planPatternFire(fire, enemy, runner, bulletsById, playerPosition);
      if (!planned.ok) {
        return planned;
      }
      bullets.push(...planned.value);
    }
  }

  return okResult(Object.freeze({
    runners: Object.freeze(advancedRunners),
    bullets: Object.freeze(bullets),
  }));
}

/** 発射命令 1 つから、fan の各弾の生成計画を作る。 */
function planPatternFire(
  fire: PatternFireCommand,
  enemy: EnemyRuntimeEntity,
  runner: EnemyPatternRunner,
  bulletsById: ReadonlyMap<string, BulletDefinition>,
  playerPosition: Vector2,
): CoreResult<readonly EnemyBulletSpawnPlan[]> {
  const bullet = bulletsById.get(fire.bullet);
  if (!bullet) {
    return coreError("bullet.notFound", `Bullet not found: ${fire.bullet}`);
  }
  let baseSteps: number;
  if (fire.direction.kind === "angle") {
    baseSteps = fire.direction.angleSteps;
  } else {
    const toPlayer = { x: playerPosition.x - enemy.position.x, y: playerPosition.y - enemy.position.y };
    if (!Number.isFinite(toPlayer.x) || !Number.isFinite(toPlayer.y)) {
      return coreError("definition.invalidConstraint", `Enemy aim direction must be finite: ${enemy.id}:${runner.patternId}`);
    }
    baseSteps = angleStepsOfVector(toPlayer);
  }
  const position = Object.freeze({ x: enemy.position.x, y: enemy.position.y });
  return okResult(Object.freeze(fire.fanOffsetSteps.map((offsetSteps) => Object.freeze({
    bullet,
    position,
    velocity: resolvePatternBulletVelocity(baseSteps + offsetSteps, fire.speed),
  }))));
}

/**
 * 角度 step と速さから pattern の敵弾速度を求める。restore も同じ式で速度が到達可能かを確かめる。
 *
 * 表の単位 vector の各成分は絶対値 1 以下なので、速度の各成分は `speed` を超えない。
 */
export function resolvePatternBulletVelocity(angleSteps: number, speed: number): Vector2 {
  const direction = unitVectorAtAngleSteps(angleSteps);
  return Object.freeze({ x: direction.x * speed, y: direction.y * speed });
}
