import { analyzePatternProgram } from "../../patterns/pattern-budget.ts";
import { compilePatternProgram } from "../../patterns/pattern-program.ts";
import type { CoreError, CoreWarning } from "../../result.ts";
import { MAX_ACTIVE_ENEMY_BULLETS, MAX_PATTERN_COMMANDS_PER_TICK } from "../runtime-budgets.ts";
import { KNOWN_DIFFICULTIES } from "../types.ts";
import type { Difficulty, PatternDefinition, PatternStepDefinition, StageDefinition } from "../types.ts";

export type PatternSemanticDiagnostics = Readonly<{
  errors: readonly CoreError[];
  warnings: readonly CoreWarning[];
}>;

/**
 * shape と参照の検証に通った pattern の意味を検証する（design 21.3）。
 *
 * `steps` を、pattern を使う stage の difficulty ごとに PatternProgram にして spawn から実行する run を見る（どの stage も使わない
 * pattern は既知の difficulty すべてで見る）。どれかの difficulty で 1 run の弾数が敵弾の active 上限を超える pattern と、1 run の命令数が
 * 1 tick の命令数の上限を超える pattern（`repeat` を展開すると起き得る）は、その run の tick に必ず fatal になるので error にする。
 * どの difficulty でも一度も撃たない pattern と、どの difficulty でも spawn から実行されない step（`loop` より後ろなど）は、動作はするが
 * 書き間違いの可能性が高いので warning にする。difficulty の `if` が、pattern を使うどの stage も持たない difficulty を挙げていれば、その
 * 枝は使われないので warning にする。
 */
export function validatePatternSemantics(
  patterns: readonly PatternDefinition[],
  stages: readonly StageDefinition[],
): PatternSemanticDiagnostics {
  const errors: CoreError[] = [];
  const warnings: CoreWarning[] = [];
  patterns.forEach((pattern, index) => {
    if (!pattern.steps) {
      return;
    }
    const stagesUsingPattern = stages.filter((stage) => stage.timeline.some((step) => step.action.pattern === pattern.id));
    const stageDifficulties = new Set(stagesUsingPattern.flatMap((stage) => stage.difficulties));
    const difficulties = stageDifficulties.size > 0 ? KNOWN_DIFFICULTIES.filter((difficulty) => stageDifficulties.has(difficulty)) : KNOWN_DIFFICULTIES;
    const budgets = difficulties.map((difficulty) => analyzePatternProgram(compilePatternProgram(pattern, difficulty)!));
    const stepsPath = `content.patterns[${index}].steps`;
    const context = { schemaPath: stepsPath, referrerId: pattern.id } as const;
    const maxBullets = Math.max(...budgets.map((budget) => budget.maxBulletsPerRun));
    const maxCommands = Math.max(...budgets.map((budget) => budget.maxCommandsPerRun));
    if (maxBullets > MAX_ACTIVE_ENEMY_BULLETS) {
      errors.push({
        code: "definition.invalidConstraint",
        message: `pattern.steps fire ${maxBullets} bullets in one tick, over the active enemy bullet budget ${MAX_ACTIVE_ENEMY_BULLETS}`,
        ...context,
      });
    }
    if (maxCommands > MAX_PATTERN_COMMANDS_PER_TICK) {
      errors.push({
        code: "definition.invalidConstraint",
        message: `pattern.steps execute ${maxCommands} commands in one tick, over the pattern command budget ${MAX_PATTERN_COMMANDS_PER_TICK}`,
        ...context,
      });
    }
    if (budgets.every((budget) => budget.firstFireTicks === null)) {
      warnings.push({ code: "pattern.neverFires", message: "pattern.steps never fire a bullet", ...context });
    }
    const unreachable = budgets.map((budget) => new Set(budget.unreachableSteps));
    for (const step of budgets[0]!.unreachableSteps) {
      if (unreachable.every((steps) => steps.has(step))) {
        warnings.push({
          code: "pattern.unreachableStep",
          message: `pattern.steps[${step}] is never executed from the spawn`,
          schemaPath: `${stepsPath}[${step}]`,
          referrerId: pattern.id,
        });
      }
    }
    if (stageDifficulties.size > 0) {
      for (const branch of collectDifficultyBranches(pattern.steps, stepsPath)) {
        const unused = branch.difficulty.filter((difficulty) => !stageDifficulties.has(difficulty));
        if (unused.length > 0) {
          warnings.push({
            code: "pattern.unusedDifficulty",
            message: `pattern.steps[].if.difficulty lists ${unused.join(", ")}, which no stage using the pattern supports`,
            schemaPath: `${branch.path}.difficulty`,
            referrerId: pattern.id,
          });
        }
      }
    }
  });
  return Object.freeze({ errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
}

/** difficulty の `if` を、`repeat` と `if` の中まで schema path 付きで集める。 */
function collectDifficultyBranches(
  steps: readonly PatternStepDefinition[],
  path: string,
): Readonly<{ difficulty: readonly Difficulty[]; path: string }>[] {
  return steps.flatMap((step, index) => {
    const stepPath = `${path}[${index}]`;
    if ("repeat" in step) {
      return collectDifficultyBranches(step.repeat.steps, `${stepPath}.repeat.steps`);
    }
    if ("if" in step) {
      return [
        { difficulty: step.if.difficulty, path: `${stepPath}.if` },
        ...collectDifficultyBranches(step.if.then, `${stepPath}.if.then`),
        ...collectDifficultyBranches(step.if.else ?? [], `${stepPath}.if.else`),
      ];
    }
    return [];
  });
}
