import type { CoreError } from "../../result.ts";
import { KNOWN_DIFFICULTIES, isKnownDifficulty } from "../types.ts";
import type { Difficulty } from "../types.ts";
import { asRecord } from "../../shared/guards.ts";
import {
  MAX_PATTERN_EXPANDED_COMMANDS,
  MAX_PATTERN_REPEAT_COUNT,
  MAX_PATTERN_NESTING_DEPTH,
  MAX_PATTERN_STEPS,
  MAX_PATTERN_WAIT_TICKS,
} from "../runtime-budgets.ts";
import {
  validateAllowedKeys,
  validateNonEmptyString,
  validateNonNegativeInteger,
  validateObjectArray,
  validatePositiveInteger,
  validatePositiveIntegerAtMost,
} from "./fields.ts";
import { validatePatternFireOnSpawnShape, validatePatternFireShape } from "./pattern-fire-shape.ts";
import { addSchemaContext } from "./schema-path.ts";

const TOP_LEVEL_STEP_KINDS = Object.freeze(["wait", "fire", "loop", "repeat", "if"] as const);
const REPEAT_BODY_STEP_KINDS = Object.freeze(["wait", "fire", "repeat", "if"] as const);

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
 * `loop` は前の top-level step へだけ戻れ、戻り先から loop までの間に `wait`（`wait` を含む `repeat` と、両方の枝に `wait` を含む `if`
 * も数える）を含む必要がある。これで 1 tick に実行する命令列は、どの difficulty でも必ず `wait` か末尾で止まる（戻るたびに次に当たる
 * loop の位置が前へ進むため）。`repeat` と `if` は、どの difficulty で展開した後の命令数も `MAX_PATTERN_EXPANDED_COMMANDS` 以下である
 * 必要がある。
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
  const records = steps.items.map(({ record }) => record);
  const expanded = Math.max(...KNOWN_DIFFICULTIES.map((difficulty) => countExpandedCommands(records, difficulty)));
  if (expanded > MAX_PATTERN_EXPANDED_COMMANDS) {
    errors.push({
      code: "definition.invalidConstraint",
      message: `pattern.steps must expand to at most ${MAX_PATTERN_EXPANDED_COMMANDS} commands`,
    });
  }
}

/**
 * 1 step を検証する。`loop` は top-level（`loop` を渡したとき）だけに置け、`repeat` と `if` の中の step は `nestingDepth` で入れ子の深さを
 * 数える。
 */
function validatePatternStepShape(
  path: string,
  step: Record<string, unknown>,
  nestingDepth: number,
  errors: CoreError[],
  loop?: Readonly<{ stepIndex: number; waitStepIndexes: readonly number[] }>,
): void {
  const kinds = loop ? TOP_LEVEL_STEP_KINDS : REPEAT_BODY_STEP_KINDS;
  validateAllowedKeys(path, step, loop ? TOP_LEVEL_STEP_KINDS : [...REPEAT_BODY_STEP_KINDS, "loop"], errors);
  if (kinds.filter((kind) => step[kind] !== undefined).length + (!loop && step.loop !== undefined ? 1 : 0) !== 1) {
    errors.push({ code: "definition.invalidShape", message: `${path} must have exactly one of wait, fire, loop, repeat or if` });
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
      errors.push({ code: "definition.invalidShape", message: `${path}.loop must not be placed inside repeat or if` });
    }
  }
  if (step.repeat !== undefined) {
    validatePatternRepeatShape(`${path}.repeat`, step.repeat, nestingDepth + 1, errors);
  }
  if (step.if !== undefined) {
    validatePatternIfShape(`${path}.if`, step.if, nestingDepth + 1, errors);
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
  if (validateNestingDepth(path, depth, errors)) {
    validatePatternBodyStepsShape(`${path}.steps`, repeat.steps, depth, errors);
  }
}

/**
 * difficulty の `if` を検証する。`difficulty` は既知の difficulty を重複なく 1 つ以上並べ、`then` と省略できる `else` は `repeat` の
 * `steps` と同じ命令列にする。
 */
function validatePatternIfShape(path: string, value: unknown, depth: number, errors: CoreError[]): void {
  const branch = asRecord(value);
  if (!branch) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an object` });
    return;
  }
  validateAllowedKeys(path, branch, ["difficulty", "then", "else"], errors);
  const difficulties = branch.difficulty;
  if (!Array.isArray(difficulties) || difficulties.length === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path}.difficulty must be a non-empty array` });
  } else if (!difficulties.every(isKnownDifficulty)) {
    errors.push({ code: "definition.invalidShape", message: `${path}.difficulty must contain only ${KNOWN_DIFFICULTIES.join(" or ")}` });
  } else if (new Set(difficulties).size !== difficulties.length) {
    errors.push({ code: "definition.invalidShape", message: `${path}.difficulty must not contain duplicates` });
  }
  if (!validateNestingDepth(path, depth, errors)) {
    return;
  }
  validatePatternBodyStepsShape(`${path}.then`, branch.then, depth, errors);
  if (branch.else !== undefined) {
    validatePatternBodyStepsShape(`${path}.else`, branch.else, depth, errors);
  }
}

/** `repeat` と `if` の入れ子が深すぎないことを検証する。 */
function validateNestingDepth(path: string, depth: number, errors: CoreError[]): boolean {
  if (depth > MAX_PATTERN_NESTING_DEPTH) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be nested at most ${MAX_PATTERN_NESTING_DEPTH} deep` });
    return false;
  }
  return true;
}

/** `repeat` の `steps` と `if` の `then` / `else` の命令列（1〜64 個、`loop` は置けない）を検証する。 */
function validatePatternBodyStepsShape(path: string, value: unknown, depth: number, errors: CoreError[]): void {
  const steps = validateObjectArray(path, value, errors);
  if (Array.isArray(value) && steps.sourceLength === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must contain at least 1 step` });
  }
  if (steps.sourceLength > MAX_PATTERN_STEPS) {
    errors.push({ code: "definition.invalidShape", message: `${path} must contain at most ${MAX_PATTERN_STEPS} steps` });
  }
  for (const { record: step, index } of steps.items) {
    const stepErrorStart = errors.length;
    validatePatternStepShape(`${path}[]`, step, depth, errors);
    addSchemaContext(errors, stepErrorStart, `${path}[${index}]`, `${path}[]`);
  }
}

/** step が `wait` か、`wait` を含む `repeat` か、両方の枝が `wait` を含む `if` か。 */
function containsWait(step: Record<string, unknown>): boolean {
  if (step.wait !== undefined) {
    return true;
  }
  const repeatBody = asRecord(step.repeat)?.steps;
  if (repeatBody !== undefined) {
    return stepsContainWait(repeatBody);
  }
  const branch = asRecord(step.if);
  return branch !== null && stepsContainWait(branch.then) && stepsContainWait(branch.else);
}

function stepsContainWait(steps: unknown): boolean {
  return Array.isArray(steps) && steps.some((child) => {
    const record = asRecord(child);
    return record !== null && containsWait(record);
  });
}

/**
 * difficulty で `repeat` と `if` を展開した後の命令数。上限を超えた時点で打ち切り、上限 + 1 を返す。形の壊れた step は 1 命令と数える。
 */
function countExpandedCommands(steps: readonly unknown[], difficulty: Difficulty): number {
  let total = 0;
  for (const value of steps) {
    const step = asRecord(value);
    const repeat = asRecord(step?.repeat);
    const branch = asRecord(step?.if);
    if (repeat && Array.isArray(repeat.steps)) {
      const count = typeof repeat.count === "number" && Number.isSafeInteger(repeat.count) && repeat.count > 0 ? repeat.count : 1;
      total += count * countExpandedCommands(repeat.steps, difficulty);
    } else if (branch) {
      const selected = Array.isArray(branch.difficulty) && branch.difficulty.includes(difficulty) ? branch.then : branch.else;
      total += Array.isArray(selected) ? countExpandedCommands(selected, difficulty) : 0;
    } else {
      total += 1;
    }
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
