import { analyzePatternProgram } from "../../patterns/pattern-budget.ts";
import type { PatternStaticBudget } from "../../patterns/pattern-budget.ts";
import { compilePatternProgram, hasDifficultyBranch } from "../../patterns/pattern-program.ts";
import type { CoreError, CoreWarning } from "../../result.ts";
import { MAX_ACTIVE_ENEMY_BULLETS, MAX_PATTERN_COMMANDS_PER_TICK } from "../runtime-budgets.ts";
import { KNOWN_DIFFICULTIES } from "../types.ts";
import type { Difficulty, PatternDefinition, PatternRepeatStepDefinition, PatternStepDefinition, StageDefinition } from "../types.ts";

export type PatternSemanticDiagnostics = Readonly<{
  errors: readonly CoreError[];
  warnings: readonly CoreWarning[];
}>;

/**
 * shape と参照の検証に通った pattern の意味を検証する（design 21.3）。
 *
 * `steps` を PatternProgram にして spawn から実行する run を見る。difficulty の `if` を持つ pattern は、pattern を使う stage の difficulty
 * ごとに見る（どの stage も使わない pattern は既知の difficulty すべてで見る）。どれかの difficulty で 1 run の弾数が敵弾の active 上限を
 * 超える pattern と、1 run の命令数が 1 tick の命令数の上限を超える pattern（`repeat` を展開すると起き得る）は、その run の tick に必ず
 * fatal になるので error にする。どの difficulty でも一度も撃たない pattern と、spawn から実行されない step（`loop` より後ろなど）と、
 * どの difficulty でも使われない `if` の枝は、動作はするが書き間違いの可能性が高いので warning にする。
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
    const stepsPath = `content.patterns[${index}].steps`;
    const context = { schemaPath: stepsPath, referrerId: pattern.id } as const;
    const branched = hasDifficultyBranch(pattern);
    const stageDifficulties = new Set(stages
      .filter((stage) => stage.timeline.some((step) => step.action.pattern === pattern.id))
      .flatMap((stage) => stage.difficulties));
    const reaching = stageDifficulties.size > 0
      ? KNOWN_DIFFICULTIES.filter((difficulty) => stageDifficulties.has(difficulty))
      : KNOWN_DIFFICULTIES;
    // `if` を持たない pattern の program は difficulty によらず同じなので 1 度だけ見る。
    const budgets = (branched ? reaching : reaching.slice(0, 1)).map((difficulty) => (
      [difficulty, analyzePatternProgram(compilePatternProgram(pattern, difficulty)!)] as const
    ));
    const overBudget = (measure: (budget: PatternStaticBudget) => number, limit: number) => {
      const over = budgets.filter(([, budget]) => measure(budget) > limit);
      const max = Math.max(...over.map(([, budget]) => measure(budget)));
      return over.length === 0 ? null : { max, on: branched ? ` on ${over.map(([difficulty]) => difficulty).join(", ")}` : "" };
    };
    const bullets = overBudget((budget) => budget.maxBulletsPerRun, MAX_ACTIVE_ENEMY_BULLETS);
    if (bullets) {
      errors.push({
        code: "definition.invalidConstraint",
        message: `pattern.steps fire ${bullets.max} bullets in one tick${bullets.on}, over the active enemy bullet budget ${MAX_ACTIVE_ENEMY_BULLETS}`,
        ...context,
      });
    }
    const commands = overBudget((budget) => budget.maxCommandsPerRun, MAX_PATTERN_COMMANDS_PER_TICK);
    if (commands) {
      errors.push({
        code: "definition.invalidConstraint",
        message: `pattern.steps execute ${commands.max} commands in one tick${commands.on}, over the pattern command budget ${MAX_PATTERN_COMMANDS_PER_TICK}`,
        ...context,
      });
    }
    if (budgets.every(([, budget]) => budget.firstFireTicks === null)) {
      warnings.push({ code: "pattern.neverFires", message: "pattern.steps never fire a bullet", ...context });
    }
    // `loop` は top-level にだけ置けて前へ戻るため、top-level の step に届くかは difficulty によらない（`if` は step の中の命令だけを変える）。
    for (const step of budgets[0]![1].unreachableSteps) {
      warnings.push({
        code: "pattern.unreachableStep",
        message: `pattern.steps[${step}] is never executed from the spawn`,
        schemaPath: `${stepsPath}[${step}]`,
        referrerId: pattern.id,
      });
    }
    for (const branch of collectUnusedBranches(pattern.steps, stepsPath, reaching)) {
      warnings.push({ code: "pattern.unusedBranch", message: branch.message, schemaPath: branch.path, referrerId: pattern.id });
    }
  });
  return Object.freeze({ errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
}

/**
 * `reaching` の difficulty で実行したときに使われない `if` の枝を、`repeat` と `if` の中まで schema path 付きで集める。`difficulty` が
 * 届かない difficulty を挙げていれば `difficulty` を、`else` を使う difficulty がなければ `else` を返す。
 */
function collectUnusedBranches(
  steps: readonly (PatternStepDefinition | PatternRepeatStepDefinition)[],
  path: string,
  reaching: readonly Difficulty[],
): Readonly<{ path: string; message: string }>[] {
  return steps.flatMap((step, index) => {
    const stepPath = `${path}[${index}]`;
    if ("repeat" in step) {
      return collectUnusedBranches(step.repeat.steps, `${stepPath}.repeat.steps`, reaching);
    }
    if (!("if" in step)) {
      return [];
    }
    const unused = step.if.difficulty.filter((difficulty) => !reaching.includes(difficulty));
    const thenReaching = reaching.filter((difficulty) => step.if.difficulty.includes(difficulty));
    const elseReaching = reaching.filter((difficulty) => !step.if.difficulty.includes(difficulty));
    const found: { path: string; message: string }[] = [];
    if (unused.length > 0) {
      found.push({
        path: `${stepPath}.if.difficulty`,
        message: `pattern.steps[].if.difficulty lists a difficulty this step never runs on: ${unused.join(", ")}`,
      });
    }
    if (step.if.else && elseReaching.length === 0) {
      found.push({ path: `${stepPath}.if.else`, message: "pattern.steps[].if.else is never used: every difficulty this step runs on takes then" });
    }
    return [
      ...found,
      ...collectUnusedBranches(step.if.then, `${stepPath}.if.then`, thenReaching),
      ...collectUnusedBranches(step.if.else ?? [], `${stepPath}.if.else`, elseReaching),
    ];
  });
}
