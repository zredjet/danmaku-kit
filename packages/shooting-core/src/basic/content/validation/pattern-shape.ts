import type { CoreError } from "../../result.ts";
import { asRecord } from "../../shared/guards.ts";
import { MAX_ENEMY_BULLET_SPEED_PER_AXIS } from "../runtime-budgets.ts";
import {
  validateAllowedKeys,
  validateFiniteNumber,
  validateFiniteNumberWithinAbs,
  validateNonEmptyString,
  validatePositiveInteger,
} from "./fields.ts";

/** PatternDefinition の shape validation。 */
export function validatePatternShape(pattern: Record<string, unknown>, errors: CoreError[]): void {
  validateAllowedKeys("pattern", pattern, ["id", "version", "fireOnSpawn"], errors);
  validateNonEmptyString("pattern.id", pattern.id, errors);
  validatePositiveInteger("pattern.version", pattern.version, errors);
  if (pattern.fireOnSpawn !== undefined) {
    validatePatternFireOnSpawnShape(pattern.fireOnSpawn, errors);
  }
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
