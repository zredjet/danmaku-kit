import { patternStreamSpeeds } from "../../patterns/pattern-program.ts";
import type { CoreError } from "../../result.ts";
import { asRecord } from "../../shared/guards.ts";
import { ANGLE_STEPS_PER_TURN, angleStepsFromDegrees } from "../../shared/angle-steps.ts";
import {
  MAX_ENEMY_BULLET_SPEED_PER_AXIS,
  MAX_PATTERN_ANGLE_DEGREES,
  MAX_PATTERN_EXPANDED_COMMANDS,
  MAX_PATTERN_FAN_COUNT,
  MAX_PATTERN_RADIAL_COUNT,
  MAX_PATTERN_REPEAT_COUNT,
  MAX_PATTERN_REPEAT_DEPTH,
  MAX_PATTERN_STEPS,
  MAX_PATTERN_STREAM_COUNT,
  MAX_PATTERN_WAIT_TICKS,
} from "../runtime-budgets.ts";
import {
  validateAllowedKeys,
  validateFiniteNumber,
  validateFiniteNumberWithinAbs,
  validateNonEmptyString,
  validateNonNegativeInteger,
  validateNumberAtMost,
  validateObjectArray,
  validatePositiveInteger,
  validatePositiveIntegerAtMost,
  validatePositiveNumber,
} from "./fields.ts";
import { addSchemaContext } from "./schema-path.ts";

const TOP_LEVEL_STEP_KINDS = Object.freeze(["wait", "fire", "loop", "repeat"] as const);
const REPEAT_BODY_STEP_KINDS = Object.freeze(["wait", "fire", "repeat"] as const);

/** PatternDefinition の shape validation。 */
export function validatePatternShape(pattern: Record<string, unknown>, errors: CoreError[]): void {
  validateAllowedKeys("pattern", pattern, ["id", "version", "steps", "fireOnSpawn"], errors);
  validateNonEmptyString("pattern.id", pattern.id, errors);
  validatePositiveInteger("pattern.version", pattern.version, errors);
  if (pattern.steps !== undefined) {
    if (pattern.fireOnSpawn !== undefined) {
      errors.push({ code: "definition.invalidShape", message: "pattern.steps must not be combined with pattern.fireOnSpawn" });
    }
    validatePatternStepsShape(pattern.steps, errors);
  }
  if (pattern.fireOnSpawn !== undefined) {
    validatePatternFireOnSpawnShape(pattern.fireOnSpawn, errors);
  }
}

/**
 * `steps` の命令列を検証する。
 *
 * `loop` は前の top-level step へだけ戻れ、戻り先から loop までの間に `wait`（`wait` を含む `repeat` も数える）を含む必要がある。これで
 * 1 tick に実行する命令列は必ず `wait` か末尾で止まる（戻るたびに次に当たる loop の位置が前へ進むため）。`repeat` は展開した後の命令数が
 * `MAX_PATTERN_EXPANDED_COMMANDS` 以下である必要がある。
 */
function validatePatternStepsShape(value: unknown, errors: CoreError[]): void {
  const steps = validateObjectArray("pattern.steps", value, errors);
  if (Array.isArray(value) && steps.sourceLength === 0) {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps must contain at least 1 step" });
  }
  if (steps.sourceLength > MAX_PATTERN_STEPS) {
    errors.push({ code: "definition.invalidShape", message: `pattern.steps must contain at most ${MAX_PATTERN_STEPS} steps` });
  }
  const waitStepIndexes = steps.items.filter(({ record }) => containsWait(record)).map(({ index }) => index);
  for (const { record: step, index: stepIndex } of steps.items) {
    const stepErrorStart = errors.length;
    validatePatternStepShape("pattern.steps[]", step, 0, errors, { stepIndex, waitStepIndexes });
    addSchemaContext(errors, stepErrorStart, `pattern.steps[${stepIndex}]`, "pattern.steps[]");
  }
  const expanded = countExpandedCommands(steps.items.map(({ record }) => record));
  if (expanded > MAX_PATTERN_EXPANDED_COMMANDS) {
    errors.push({
      code: "definition.invalidConstraint",
      message: `pattern.steps must expand to at most ${MAX_PATTERN_EXPANDED_COMMANDS} commands`,
    });
  }
}

/**
 * 1 step を検証する。`loop` は top-level（`loop` を渡したとき）だけに置け、`repeat` の中の step は `repeatDepth` で入れ子の深さを数える。
 */
function validatePatternStepShape(
  path: string,
  step: Record<string, unknown>,
  repeatDepth: number,
  errors: CoreError[],
  loop?: Readonly<{ stepIndex: number; waitStepIndexes: readonly number[] }>,
): void {
  const kinds = loop ? TOP_LEVEL_STEP_KINDS : REPEAT_BODY_STEP_KINDS;
  validateAllowedKeys(path, step, loop ? TOP_LEVEL_STEP_KINDS : [...REPEAT_BODY_STEP_KINDS, "loop"], errors);
  if (kinds.filter((kind) => step[kind] !== undefined).length + (!loop && step.loop !== undefined ? 1 : 0) !== 1) {
    errors.push({ code: "definition.invalidShape", message: `${path} must have exactly one of wait, fire, loop or repeat` });
  }
  if (step.wait !== undefined) {
    validatePositiveIntegerAtMost(`${path}.wait`, step.wait, MAX_PATTERN_WAIT_TICKS, errors);
  }
  if (step.fire !== undefined) {
    validatePatternFireShape(`${path}.fire`, step.fire, errors);
  }
  if (step.loop !== undefined) {
    if (loop) {
      validatePatternLoopShape(step.loop, loop.stepIndex, loop.waitStepIndexes, errors);
    } else {
      errors.push({ code: "definition.invalidShape", message: `${path}.loop must not be placed inside repeat` });
    }
  }
  if (step.repeat !== undefined) {
    validatePatternRepeatShape(`${path}.repeat`, step.repeat, repeatDepth + 1, errors);
  }
}

/** `repeat` の回数、入れ子の深さ、`steps` を検証する。 */
function validatePatternRepeatShape(path: string, value: unknown, depth: number, errors: CoreError[]): void {
  const repeat = asRecord(value);
  if (!repeat) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an object` });
    return;
  }
  validateAllowedKeys(path, repeat, ["count", "steps"], errors);
  validatePositiveIntegerAtMost(`${path}.count`, repeat.count, MAX_PATTERN_REPEAT_COUNT, errors);
  if (depth > MAX_PATTERN_REPEAT_DEPTH) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be nested at most ${MAX_PATTERN_REPEAT_DEPTH} deep` });
    return;
  }
  const steps = validateObjectArray(`${path}.steps`, repeat.steps, errors);
  if (Array.isArray(repeat.steps) && steps.sourceLength === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path}.steps must contain at least 1 step` });
  }
  if (steps.sourceLength > MAX_PATTERN_STEPS) {
    errors.push({ code: "definition.invalidShape", message: `${path}.steps must contain at most ${MAX_PATTERN_STEPS} steps` });
  }
  for (const { record: step, index } of steps.items) {
    const stepErrorStart = errors.length;
    validatePatternStepShape(`${path}.steps[]`, step, depth, errors);
    addSchemaContext(errors, stepErrorStart, `${path}.steps[${index}]`, `${path}.steps[]`);
  }
}

/** step が `wait` か、`wait` を含む `repeat` か。 */
function containsWait(step: Record<string, unknown>): boolean {
  if (step.wait !== undefined) {
    return true;
  }
  const body = asRecord(step.repeat)?.steps;
  return Array.isArray(body) && body.some((child) => {
    const record = asRecord(child);
    return record !== null && containsWait(record);
  });
}

/** `repeat` を展開した後の命令数。上限を超えた時点で打ち切り、上限 + 1 を返す。形の壊れた step は 1 命令と数える。 */
function countExpandedCommands(steps: readonly unknown[]): number {
  let total = 0;
  for (const value of steps) {
    const repeat = asRecord(asRecord(value)?.repeat);
    const count = repeat && typeof repeat.count === "number" && Number.isSafeInteger(repeat.count) && repeat.count > 0 ? repeat.count : 1;
    total += repeat && Array.isArray(repeat.steps) ? count * countExpandedCommands(repeat.steps) : 1;
    if (total > MAX_PATTERN_EXPANDED_COMMANDS) {
      return MAX_PATTERN_EXPANDED_COMMANDS + 1;
    }
  }
  return total;
}

/** `loop` が前の step へ戻り、戻り先から loop までの間に `wait` を含むことを検証する。 */
function validatePatternLoopShape(
  value: unknown,
  stepIndex: number,
  waitStepIndexes: readonly number[],
  errors: CoreError[],
): void {
  validateNonNegativeInteger("pattern.steps[].loop", value, errors);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return;
  }
  if (value >= stepIndex) {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps[].loop must point to an earlier step" });
    return;
  }
  if (!waitStepIndexes.some((waitIndex) => waitIndex >= value && waitIndex < stepIndex)) {
    errors.push({
      code: "definition.invalidConstraint",
      message: "pattern.steps[].loop must return to a range that contains a wait step",
    });
  }
}

/** `fire` の弾、発射元、向き、fan / radial、stream、速さを検証する。 */
function validatePatternFireShape(path: string, value: unknown, errors: CoreError[]): void {
  const fire = asRecord(value);
  if (!fire) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an object` });
    return;
  }
  validateAllowedKeys(path, fire, ["bullet", "origin", "aim", "angleDeg", "fan", "radial", "stream", "speed"], errors);
  validateNonEmptyString(`${path}.bullet`, fire.bullet, errors);
  if (fire.origin !== undefined && fire.origin !== "self") {
    errors.push({ code: "definition.invalidShape", message: `${path}.origin must be self` });
  }
  if ((fire.aim === undefined) === (fire.angleDeg === undefined)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must have exactly one of aim or angleDeg` });
  }
  if (fire.aim !== undefined && fire.aim !== "player") {
    errors.push({ code: "definition.invalidShape", message: `${path}.aim must be player` });
  }
  if (fire.angleDeg !== undefined) {
    validatePatternAngleDegrees(`${path}.angleDeg`, fire.angleDeg, -MAX_PATTERN_ANGLE_DEGREES, errors);
  }
  validatePositiveNumber(`${path}.speed`, fire.speed, errors);
  validateNumberAtMost(`${path}.speed`, fire.speed, MAX_ENEMY_BULLET_SPEED_PER_AXIS, String(MAX_ENEMY_BULLET_SPEED_PER_AXIS), errors);
  if (fire.fan !== undefined && fire.radial !== undefined) {
    errors.push({ code: "definition.invalidShape", message: `${path} must not have both fan and radial` });
  }
  if (fire.fan !== undefined) {
    validatePatternFanShape(`${path}.fan`, fire.fan, errors);
  }
  if (fire.radial !== undefined) {
    validatePatternRadialShape(`${path}.radial`, fire.radial, errors);
  }
  if (fire.stream !== undefined) {
    validatePatternStreamShape(`${path}.stream`, fire.stream, fire.speed, errors);
  }
}

/**
 * `fan` の弾数と広がりを検証する。
 *
 * 弾は基準の向きから `-spread / 2 + i * spread / (count - 1)` step ずれるため、広がりの step 数が 2 と `count - 1` で割り切れる
 * ことを要求し、すべての弾を 0.25° 刻みの step に載せる。
 */
function validatePatternFanShape(path: string, value: unknown, errors: CoreError[]): void {
  const fan = asRecord(value);
  if (!fan) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an object` });
    return;
  }
  validateAllowedKeys(path, fan, ["count", "spreadDeg"], errors);
  validatePositiveIntegerAtMost(`${path}.count`, fan.count, MAX_PATTERN_FAN_COUNT, errors);
  const spreadSteps = validatePatternAngleDegrees(`${path}.spreadDeg`, fan.spreadDeg, 0, errors);
  if (spreadSteps === null || typeof fan.count !== "number" || !Number.isSafeInteger(fan.count) || fan.count < 1) {
    return;
  }
  if (fan.count === 1 && spreadSteps !== 0) {
    errors.push({ code: "definition.invalidShape", message: `${path}.spreadDeg must be 0 when fan.count is 1` });
  } else if (fan.count > 1 && (spreadSteps % 2 !== 0 || spreadSteps % (fan.count - 1) !== 0)) {
    errors.push({ code: "definition.invalidShape", message: `${path}.spreadDeg must place every bullet on a 0.25 degree step` });
  }
}

/** `radial` の弾数が 1 周（1,440 step）を割り切り、すべての弾を 0.25° 刻みの step に載せることを検証する。 */
function validatePatternRadialShape(path: string, value: unknown, errors: CoreError[]): void {
  const radial = asRecord(value);
  if (!radial) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an object` });
    return;
  }
  validateAllowedKeys(path, radial, ["count"], errors);
  const countErrorStart = errors.length;
  validatePositiveIntegerAtMost(`${path}.count`, radial.count, MAX_PATTERN_RADIAL_COUNT, errors);
  if (errors.length === countErrorStart && ANGLE_STEPS_PER_TURN % (radial.count as number) !== 0) {
    errors.push({ code: "definition.invalidShape", message: `${path}.count must divide 360 degrees into 0.25 degree steps` });
  }
}

/** `stream` の弾数と速さの差を検証し、すべての弾の速さが 0 より大きく上限以下になることを確かめる。 */
function validatePatternStreamShape(path: string, value: unknown, speed: unknown, errors: CoreError[]): void {
  const stream = asRecord(value);
  if (!stream) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an object` });
    return;
  }
  validateAllowedKeys(path, stream, ["count", "speedStep"], errors);
  const errorStart = errors.length;
  validatePositiveIntegerAtMost(`${path}.count`, stream.count, MAX_PATTERN_STREAM_COUNT, errors);
  validateFiniteNumber(`${path}.speedStep`, stream.speedStep, errors);
  if (errors.length > errorStart || typeof speed !== "number" || !Number.isFinite(speed)) {
    return;
  }
  if (stream.count !== 1 && stream.speedStep === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path}.speedStep must not be 0 when stream.count is more than 1` });
    return;
  }
  const speeds = patternStreamSpeeds(speed, stream.count as number, stream.speedStep as number);
  if (speeds.some((streamSpeed) => !(streamSpeed > 0) || streamSpeed > MAX_ENEMY_BULLET_SPEED_PER_AXIS)) {
    errors.push({
      code: "definition.invalidConstraint",
      message: `${path} must keep every bullet speed above 0 and at most ${MAX_ENEMY_BULLET_SPEED_PER_AXIS}`,
    });
  }
}

/** 角度が `min` 以上 360 以下の 0.25° の倍数であることを検証し、角度 step を返す。 */
function validatePatternAngleDegrees(path: string, value: unknown, min: number, errors: CoreError[]): number | null {
  validateFiniteNumber(path, value, errors);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < min || value > MAX_PATTERN_ANGLE_DEGREES) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be between ${min} and ${MAX_PATTERN_ANGLE_DEGREES}` });
    return null;
  }
  const steps = angleStepsFromDegrees(value);
  if (steps === null) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a multiple of 0.25` });
  }
  return steps;
}

/** pattern.fireOnSpawn の最小弾生成定義を検証する。 */
function validatePatternFireOnSpawnShape(value: unknown, errors: CoreError[]): void {
  const fireOnSpawn = asRecord(value);
  if (!fireOnSpawn) {
    errors.push({ code: "definition.invalidShape", message: "pattern.fireOnSpawn must be an object" });
    return;
  }
  validateAllowedKeys("pattern.fireOnSpawn", fireOnSpawn, ["bullet", "offset", "velocity"], errors);
  validateNonEmptyString("pattern.fireOnSpawn.bullet", fireOnSpawn.bullet, errors);

  const offset = asRecord(fireOnSpawn.offset);
  if (!offset) {
    errors.push({ code: "definition.invalidShape", message: "pattern.fireOnSpawn.offset must be an object" });
  } else {
    validateAllowedKeys("pattern.fireOnSpawn.offset", offset, ["x", "y"], errors);
    validateFiniteNumber("pattern.fireOnSpawn.offset.x", offset.x, errors);
    validateFiniteNumber("pattern.fireOnSpawn.offset.y", offset.y, errors);
  }

  if (fireOnSpawn.velocity === undefined) {
    return;
  }
  const velocity = asRecord(fireOnSpawn.velocity);
  if (!velocity) {
    errors.push({ code: "definition.invalidShape", message: "pattern.fireOnSpawn.velocity must be an object" });
    return;
  }
  validateAllowedKeys("pattern.fireOnSpawn.velocity", velocity, ["x", "y"], errors);
  validateFiniteNumberWithinAbs("pattern.fireOnSpawn.velocity.x", velocity.x, MAX_ENEMY_BULLET_SPEED_PER_AXIS, errors);
  validateFiniteNumberWithinAbs("pattern.fireOnSpawn.velocity.y", velocity.y, MAX_ENEMY_BULLET_SPEED_PER_AXIS, errors);
}
