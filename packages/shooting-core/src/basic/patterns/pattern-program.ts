import type { BulletId, PatternDefinition, PatternFireDefinition, PatternId, PatternStepDefinition } from "../content/types.ts";
import { angleStepsFromDegrees } from "../shared/angle-steps.ts";

/** 発射の向き。`aimAtPlayer` は発射する tick の自機の位置から、`angle` は固定の角度 step から決める。 */
export type PatternFireDirection =
  | Readonly<{ kind: "aimAtPlayer" }>
  | Readonly<{ kind: "angle"; angleSteps: number }>;

/** 正規化した発射命令。fan の各弾は基準の向きから `fanOffsetSteps` だけずれる。 */
export type PatternFireCommand = Readonly<{
  bullet: BulletId;
  speed: number;
  direction: PatternFireDirection;
  fanOffsetSteps: readonly number[];
}>;

/**
 * runner が 1 tick に実行する命令のまとまり。
 *
 * runner は `wait` で止まった位置（cursor）から次の `wait` か末尾まで命令を実行する。`next` は次に実行を始める cursor とそれまで待つ
 * tick 数で、末尾まで実行した run では null になる。
 */
export type PatternRun = Readonly<{
  fires: readonly PatternFireCommand[];
  bulletCount: number;
  executedCommands: number;
  /** run が実行する step の index（昇順、重複なし）。到達しない step の検出に使う。 */
  executedSteps: readonly number[];
  next: Readonly<{ cursor: number; waitTicks: number }> | null;
}>;

/**
 * `PatternDefinition.steps` を正規化した命令列（design 10 の PatternProgram）。
 *
 * 命令列に分岐や乱数はないため、cursor ごとの run を load 時に 1 度だけ求めておき、tick と restore は同じ run を引く。
 */
export type PatternProgram = Readonly<{
  patternId: PatternId;
  length: number;
  /** cursor 0〜`length` の run。cursor が `length` の run は何もしない。 */
  runs: readonly PatternRun[];
}>;

type NormalizedPatternCommand =
  | Readonly<{ kind: "wait"; ticks: number }>
  | Readonly<{ kind: "fire"; command: PatternFireCommand }>
  | Readonly<{ kind: "loop"; target: number }>;

/** 検証済みの pattern から PatternProgram を作る。`steps` を持たない pattern は null を返す。 */
export function compilePatternProgram(pattern: PatternDefinition): PatternProgram | null {
  if (!pattern.steps) {
    return null;
  }
  const commands = pattern.steps.map(normalizePatternStep);
  const runs = Array.from({ length: commands.length + 1 }, (_, cursor) => resolvePatternRun(commands, cursor));
  return Object.freeze({
    patternId: pattern.id,
    length: commands.length,
    runs: Object.freeze(runs),
  });
}

/** content の step を runner が実行する命令へ変換する。 */
function normalizePatternStep(step: PatternStepDefinition): NormalizedPatternCommand {
  if ("wait" in step) {
    return Object.freeze({ kind: "wait", ticks: step.wait });
  }
  if ("fire" in step) {
    return Object.freeze({ kind: "fire", command: normalizePatternFire(step.fire) });
  }
  return Object.freeze({ kind: "loop", target: step.loop });
}

/** 発射命令の向きと fan を角度 step にそろえる。角度が 0.25° の倍数であることは validation が保証する。 */
function normalizePatternFire(fire: PatternFireDefinition): PatternFireCommand {
  const direction: PatternFireDirection = fire.aim === "player"
    ? Object.freeze({ kind: "aimAtPlayer" })
    : Object.freeze({ kind: "angle", angleSteps: requireAngleSteps(fire.angleDeg) });
  const count = fire.fan?.count ?? 1;
  const spreadSteps = requireAngleSteps(fire.fan?.spreadDeg ?? 0);
  const gapSteps = count > 1 ? spreadSteps / (count - 1) : 0;
  return Object.freeze({
    bullet: fire.bullet,
    speed: fire.speed,
    direction,
    fanOffsetSteps: Object.freeze(Array.from({ length: count }, (_, index) => index * gapSteps - spreadSteps / 2)),
  });
}

/** validation 済みの角度を step に変換する。 */
function requireAngleSteps(degrees: number | undefined): number {
  const steps = degrees === undefined ? null : angleStepsFromDegrees(degrees);
  if (steps === null) {
    throw new Error("pattern angles must be validated quarter-degree multiples");
  }
  return steps;
}

/**
 * cursor から次の `wait` か末尾まで命令を実行した結果を求める。
 *
 * `loop` の戻り先から loop までの間に `wait` があることを validation が保証するため、戻るたびに次に当たる loop の位置が前へ進み、
 * 実行する命令数は `(命令数 + 1) ^ 2` を超えない。
 */
function resolvePatternRun(commands: readonly NormalizedPatternCommand[], start: number): PatternRun {
  const fires: PatternFireCommand[] = [];
  const executedSteps = new Set<number>();
  const maxExecutedCommands = (commands.length + 1) * (commands.length + 1);
  let cursor = start;
  let executedCommands = 0;
  while (cursor < commands.length) {
    if (executedCommands >= maxExecutedCommands) {
      throw new Error("pattern loops must be validated to pass through a wait step");
    }
    const command = commands[cursor]!;
    executedCommands += 1;
    executedSteps.add(cursor);
    if (command.kind === "wait") {
      return createPatternRun(fires, executedCommands, executedSteps, Object.freeze({ cursor: cursor + 1, waitTicks: command.ticks }));
    }
    if (command.kind === "fire") {
      fires.push(command.command);
      cursor += 1;
    } else {
      cursor = command.target;
    }
  }
  return createPatternRun(fires, executedCommands, executedSteps, null);
}

function createPatternRun(
  fires: readonly PatternFireCommand[],
  executedCommands: number,
  executedSteps: ReadonlySet<number>,
  next: PatternRun["next"],
): PatternRun {
  return Object.freeze({
    fires: Object.freeze([...fires]),
    bulletCount: fires.reduce((count, fire) => count + fire.fanOffsetSteps.length, 0),
    executedCommands,
    executedSteps: Object.freeze([...executedSteps].sort((left, right) => left - right)),
    next,
  });
}
