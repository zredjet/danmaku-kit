import type { BulletId, PatternDefinition, PatternFireDefinition, PatternId, PatternStepDefinition } from "../content/types.ts";
import { angleStepsFromDegrees } from "../shared/angle-steps.ts";

/** 発射の向き。`aimAtPlayer` は発射する tick の自機の位置から、`angle` は固定の角度 step から決める。 */
export type PatternFireDirection =
  | Readonly<{ kind: "aimAtPlayer" }>
  | Readonly<{ kind: "angle"; angleSteps: number }>;

/** 1 発の弾。基準の向きから `offsetSteps` だけずれた向きへ `speed` で撃つ。 */
export type PatternFireBullet = Readonly<{ offsetSteps: number; speed: number }>;

/**
 * 正規化した発射命令。`bullets` は fan / radial の向きごとに stream の速さを並べた順（向きが外側、速さが内側）で、この順に敵弾を作る。
 */
export type PatternFireCommand = Readonly<{
  bullet: BulletId;
  direction: PatternFireDirection;
  bullets: readonly PatternFireBullet[];
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
  /** run が実行する top-level step の index（昇順、重複なし。`repeat` の中の命令は `repeat` の step に数える）。到達しない step の検出に使う。 */
  executedSteps: readonly number[];
  next: Readonly<{ cursor: number; waitTicks: number }> | null;
}>;

/**
 * `PatternDefinition.steps` を正規化した命令列（design 10 の PatternProgram）。
 *
 * `repeat` は load 時に展開するため、cursor は展開した後の命令の位置を指す（`repeat` のない pattern では step の index と同じ）。命令列に
 * 分岐や乱数はないため、cursor ごとの run を load 時に 1 度だけ求めておき、tick と restore は同じ run を引く。
 */
export type PatternProgram = Readonly<{
  patternId: PatternId;
  /** 元の top-level の step 数。`PatternRun.executedSteps` はこの範囲の index を持つ。 */
  stepCount: number;
  /** 展開した後の命令数。 */
  length: number;
  /** cursor 0〜`length` の run。cursor が `length` の run は何もしない。 */
  runs: readonly PatternRun[];
}>;

/** 展開した命令。`sourceStep` は元の top-level step の index で、`loop` の `target` は展開した後の命令の位置。 */
type NormalizedPatternCommand =
  | Readonly<{ kind: "wait"; ticks: number; sourceStep: number }>
  | Readonly<{ kind: "fire"; command: PatternFireCommand; sourceStep: number }>
  | Readonly<{ kind: "loop"; target: number; sourceStep: number }>;

const ANGLE_STEPS_PER_TURN = 1_440;

/** 検証済みの pattern から PatternProgram を作る。`steps` を持たない pattern は null を返す。 */
export function compilePatternProgram(pattern: PatternDefinition): PatternProgram | null {
  if (!pattern.steps) {
    return null;
  }
  const expanded: NormalizedPatternCommand[] = [];
  const startOfStep: number[] = [];
  pattern.steps.forEach((step, sourceStep) => {
    startOfStep.push(expanded.length);
    appendNormalizedStep(step, sourceStep, expanded);
  });
  // `loop` の戻り先は top-level の step の index なので、その step を展開した最初の命令の位置へ付け替える。
  const commands = expanded.map((command) => command.kind === "loop"
    ? Object.freeze({ ...command, target: startOfStep[command.target]! })
    : command);
  const runs = Array.from({ length: commands.length + 1 }, (_, cursor) => resolvePatternRun(commands, cursor));
  return Object.freeze({
    patternId: pattern.id,
    stepCount: pattern.steps.length,
    length: commands.length,
    runs: Object.freeze(runs),
  });
}

/** content の step を runner が実行する命令へ変換して `out` に足す。`repeat` は `steps` を `count` 回続けて足す。 */
function appendNormalizedStep(step: PatternStepDefinition, sourceStep: number, out: NormalizedPatternCommand[]): void {
  if ("wait" in step) {
    out.push(Object.freeze({ kind: "wait", ticks: step.wait, sourceStep }));
  } else if ("fire" in step) {
    out.push(Object.freeze({ kind: "fire", command: normalizePatternFire(step.fire), sourceStep }));
  } else if ("loop" in step) {
    out.push(Object.freeze({ kind: "loop", target: step.loop, sourceStep }));
  } else {
    for (let iteration = 0; iteration < step.repeat.count; iteration += 1) {
      for (const child of step.repeat.steps) {
        appendNormalizedStep(child, sourceStep, out);
      }
    }
  }
}

/**
 * 発射命令の向き、fan / radial、stream を角度 step と弾の並びにそろえる。角度が 0.25° の倍数であること、radial の弾数が 1 周の
 * step 数を割り切ることは validation が保証する。
 */
function normalizePatternFire(fire: PatternFireDefinition): PatternFireCommand {
  const direction: PatternFireDirection = fire.aim === "player"
    ? Object.freeze({ kind: "aimAtPlayer" })
    : Object.freeze({ kind: "angle", angleSteps: requireAngleSteps(fire.angleDeg) });
  const speeds = fire.stream ? patternStreamSpeeds(fire.speed, fire.stream.count, fire.stream.speedStep) : [fire.speed];
  return Object.freeze({
    bullet: fire.bullet,
    direction,
    bullets: Object.freeze(directionOffsetSteps(fire).flatMap((offsetSteps) => (
      speeds.map((speed) => Object.freeze({ offsetSteps, speed }))
    ))),
  });
}

/** fan は基準の向きを中心に広げ、radial は基準の向きから 1 周を等分する。どちらもなければ基準の向きの 1 発。 */
function directionOffsetSteps(fire: PatternFireDefinition): readonly number[] {
  if (fire.radial) {
    const gapSteps = ANGLE_STEPS_PER_TURN / fire.radial.count;
    return Array.from({ length: fire.radial.count }, (_, index) => index * gapSteps);
  }
  const count = fire.fan?.count ?? 1;
  const spreadSteps = requireAngleSteps(fire.fan?.spreadDeg ?? 0);
  const gapSteps = count > 1 ? spreadSteps / (count - 1) : 0;
  return Array.from({ length: count }, (_, index) => index * gapSteps - spreadSteps / 2);
}

/** stream の各弾の速さ。validation と PatternProgram が同じ式で求める。 */
export function patternStreamSpeeds(speed: number, count: number, speedStep: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => speed + index * speedStep);
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
    executedSteps.add(command.sourceStep);
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
    bulletCount: fires.reduce((count, fire) => count + fire.bullets.length, 0),
    executedCommands,
    executedSteps: Object.freeze([...executedSteps].sort((left, right) => left - right)),
    next,
  });
}
