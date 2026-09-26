import type { CoreError } from "../../result.ts";
import { asRecord } from "../../shared/guards.ts";
import { MAX_PATH_SEGMENT_DURATION_TICKS, MAX_PATH_SEGMENTS, MAX_PATH_SPEED_PER_AXIS } from "../runtime-budgets.ts";
import {
  validateAllowedKeys,
  validateFiniteNumberWithinAbs,
  validateNonEmptyString,
  validateObjectArray,
  validatePositiveInteger,
  validatePositiveIntegerAtMost,
} from "./fields.ts";
import { addSchemaContext } from "./schema-path.ts";

/** PathDefinition の shape validation。`segments` は省略でき、省略時と空配列は動かない path になる。 */
export function validatePathShape(path: Record<string, unknown>, errors: CoreError[]): void {
  validateAllowedKeys("path", path, ["id", "version", "segments"], errors);
  validateNonEmptyString("path.id", path.id, errors);
  validatePositiveInteger("path.version", path.version, errors);
  if (path.segments === undefined) {
    return;
  }

  const segments = validateObjectArray("path.segments", path.segments, errors);
  if (segments.sourceLength > MAX_PATH_SEGMENTS) {
    errors.push({
      code: "definition.invalidShape",
      message: `path.segments must contain at most ${MAX_PATH_SEGMENTS} segments`,
    });
  }
  for (const { record: segment, index: segmentIndex } of segments.items) {
    const segmentErrorStart = errors.length;
    validateAllowedKeys("path.segments[]", segment, ["type", "duration", "velocity"], errors);
    if (segment.type !== "velocity") {
      errors.push({ code: "definition.invalidShape", message: "path.segments[].type must be velocity" });
    }
    validatePositiveIntegerAtMost(
      "path.segments[].duration",
      segment.duration,
      MAX_PATH_SEGMENT_DURATION_TICKS,
      errors,
    );
    const velocity = asRecord(segment.velocity);
    if (!velocity) {
      errors.push({ code: "definition.invalidShape", message: "path.segments[].velocity must be an object" });
    } else {
      validateAllowedKeys("path.segments[].velocity", velocity, ["x", "y"], errors);
      validateFiniteNumberWithinAbs("path.segments[].velocity.x", velocity.x, MAX_PATH_SPEED_PER_AXIS, errors);
      validateFiniteNumberWithinAbs("path.segments[].velocity.y", velocity.y, MAX_PATH_SPEED_PER_AXIS, errors);
    }
    addSchemaContext(errors, segmentErrorStart, `path.segments[${segmentIndex}]`, "path.segments[]");
  }
}
