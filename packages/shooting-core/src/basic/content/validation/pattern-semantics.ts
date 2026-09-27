import { analyzePatternProgram } from "../../patterns/pattern-budget.ts";
import { compilePatternProgram } from "../../patterns/pattern-program.ts";
import type { CoreError, CoreWarning } from "../../result.ts";
import { MAX_ACTIVE_ENEMY_BULLETS } from "../runtime-budgets.ts";
import type { PatternDefinition } from "../types.ts";

export type PatternSemanticDiagnostics = Readonly<{
  errors: readonly CoreError[];
  warnings: readonly CoreWarning[];
}>;

/**
 * shape と参照の検証に通った pattern の意味を検証する（design 21.3）。
 *
 * `steps` を PatternProgram にして spawn から実行する run を見る。1 run の弾数が敵弾の active 上限を超える pattern は、撃った tick に
 * 必ず fatal になるので error にする。一度も撃たない pattern と、spawn からどの run でも実行されない step（`loop` より後ろなど）は
 * 動作はするが書き間違いの可能性が高いので warning にする。
 */
export function validatePatternSemantics(patterns: readonly PatternDefinition[]): PatternSemanticDiagnostics {
  const errors: CoreError[] = [];
  const warnings: CoreWarning[] = [];
  patterns.forEach((pattern, index) => {
    const program = compilePatternProgram(pattern);
    if (!program) {
      return;
    }
    const budget = analyzePatternProgram(program);
    const stepsPath = `content.patterns[${index}].steps`;
    if (budget.maxBulletsPerRun > MAX_ACTIVE_ENEMY_BULLETS) {
      errors.push({
        code: "definition.invalidConstraint",
        message: `pattern.steps fire ${budget.maxBulletsPerRun} bullets in one tick, over the active enemy bullet budget ${MAX_ACTIVE_ENEMY_BULLETS}`,
        schemaPath: stepsPath,
        referrerId: pattern.id,
      });
    }
    if (budget.firstFireTicks === null) {
      warnings.push({
        code: "pattern.neverFires",
        message: "pattern.steps never fire a bullet",
        schemaPath: stepsPath,
        referrerId: pattern.id,
      });
    }
    for (const step of budget.unreachableSteps) {
      warnings.push({
        code: "pattern.unreachableStep",
        message: `pattern.steps[${step}] is never executed from the spawn`,
        schemaPath: `${stepsPath}[${step}]`,
        referrerId: pattern.id,
      });
    }
  });
  return Object.freeze({ errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
}
