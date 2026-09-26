import type { CoreError } from "../../result.ts";
import { asRecord } from "../../shared/guards.ts";
import { angleStepsFromDegrees } from "../../shared/angle-steps.ts";
import {
  MAX_ENEMY_BULLET_SPEED_PER_AXIS,
  MAX_PATTERN_ANGLE_DEGREES,
  MAX_PATTERN_FAN_COUNT,
  MAX_PATTERN_STEPS,
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

const PATTERN_STEP_KINDS = Object.freeze(["wait", "fire", "loop"] as const);

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
 * `loop` は前の step へだけ戻れ、戻り先から loop までの間に `wait` を含む必要がある。これで 1 tick に実行する命令列は必ず `wait` か
 * 末尾で止まる（戻るたびに次に当たる loop の位置が前へ進むため）。
 */
function validatePatternStepsShape(value: unknown, errors: CoreError[]): void {
  const steps = validateObjectArray("pattern.steps", value, errors);
  if (Array.isArray(value) && steps.sourceLength === 0) {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps must contain at least 1 step" });
  }
  if (steps.sourceLength > MAX_PATTERN_STEPS) {
    errors.push({ code: "definition.invalidShape", message: `pattern.steps must contain at most ${MAX_PATTERN_STEPS} steps` });
  }
  const waitStepIndexes = steps.items.filter(({ record }) => record.wait !== undefined).map(({ index }) => index);
  for (const { record: step, index: stepIndex } of steps.items) {
    const stepErrorStart = errors.length;
    validateAllowedKeys("pattern.steps[]", step, PATTERN_STEP_KINDS, errors);
    const kinds = PATTERN_STEP_KINDS.filter((kind) => step[kind] !== undefined);
    if (kinds.length !== 1) {
      errors.push({ code: "definition.invalidShape", message: "pattern.steps[] must have exactly one of wait, fire or loop" });
    }
    if (step.wait !== undefined) {
      validatePositiveIntegerAtMost("pattern.steps[].wait", step.wait, MAX_PATTERN_WAIT_TICKS, errors);
    }
    if (step.fire !== undefined) {
      validatePatternFireShape(step.fire, errors);
    }
    if (step.loop !== undefined) {
      validatePatternLoopShape(step.loop, stepIndex, waitStepIndexes, errors);
    }
    addSchemaContext(errors, stepErrorStart, `pattern.steps[${stepIndex}]`, "pattern.steps[]");
  }
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

/** `fire` の弾、発射元、向き、fan、速さを検証する。 */
function validatePatternFireShape(value: unknown, errors: CoreError[]): void {
  const fire = asRecord(value);
  if (!fire) {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps[].fire must be an object" });
    return;
  }
  validateAllowedKeys("pattern.steps[].fire", fire, ["bullet", "origin", "aim", "angleDeg", "fan", "speed"], errors);
  validateNonEmptyString("pattern.steps[].fire.bullet", fire.bullet, errors);
  if (fire.origin !== undefined && fire.origin !== "self") {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps[].fire.origin must be self" });
  }
  if ((fire.aim === undefined) === (fire.angleDeg === undefined)) {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps[].fire must have exactly one of aim or angleDeg" });
  }
  if (fire.aim !== undefined && fire.aim !== "player") {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps[].fire.aim must be player" });
  }
  if (fire.angleDeg !== undefined) {
    validatePatternAngleDegrees("pattern.steps[].fire.angleDeg", fire.angleDeg, -MAX_PATTERN_ANGLE_DEGREES, errors);
  }
  validatePositiveNumber("pattern.steps[].fire.speed", fire.speed, errors);
  validateNumberAtMost(
    "pattern.steps[].fire.speed",
    fire.speed,
    MAX_ENEMY_BULLET_SPEED_PER_AXIS,
    String(MAX_ENEMY_BULLET_SPEED_PER_AXIS),
    errors,
  );
  if (fire.fan !== undefined) {
    validatePatternFanShape(fire.fan, errors);
  }
}

/**
 * `fan` の弾数と広がりを検証する。
 *
 * 弾は基準の向きから `-spread / 2 + i * spread / (count - 1)` step ずれるため、広がりの step 数が 2 と `count - 1` で割り切れる
 * ことを要求し、すべての弾を 0.25° 刻みの step に載せる。
 */
function validatePatternFanShape(value: unknown, errors: CoreError[]): void {
  const fan = asRecord(value);
  if (!fan) {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps[].fire.fan must be an object" });
    return;
  }
  validateAllowedKeys("pattern.steps[].fire.fan", fan, ["count", "spreadDeg"], errors);
  validatePositiveIntegerAtMost("pattern.steps[].fire.fan.count", fan.count, MAX_PATTERN_FAN_COUNT, errors);
  const spreadSteps = validatePatternAngleDegrees("pattern.steps[].fire.fan.spreadDeg", fan.spreadDeg, 0, errors);
  if (spreadSteps === null || typeof fan.count !== "number" || !Number.isSafeInteger(fan.count) || fan.count < 1) {
    return;
  }
  if (fan.count === 1 && spreadSteps !== 0) {
    errors.push({ code: "definition.invalidShape", message: "pattern.steps[].fire.fan.spreadDeg must be 0 when fan.count is 1" });
  } else if (fan.count > 1 && (spreadSteps % 2 !== 0 || spreadSteps % (fan.count - 1) !== 0)) {
    errors.push({
      code: "definition.invalidShape",
      message: "pattern.steps[].fire.fan.spreadDeg must place every bullet on a 0.25 degree step",
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
