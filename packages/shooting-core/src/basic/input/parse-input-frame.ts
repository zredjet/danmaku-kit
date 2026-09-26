import { asRecord, hasOnlyKeys } from "../internal/guards.ts";
import { deepFreezeClone } from "../internal/immutable.ts";
import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { GAMEPLAY_ACTION_ORDER } from "./input-frame.ts";
import type { InputFrame } from "./input-frame.ts";

/** public API 境界で受け取る InputFrame を検証し、action を canonical order に揃えた immutable frame を返す。 */
export function parseInputFrame(value: unknown): CoreResult<InputFrame> {
  const record = asRecord(value);
  if (!record) {
    return coreError("input.invalidShape", "InputFrame must be an object");
  }
  if (!hasOnlyKeys(record, ["tick", "axes", "held", "pressed", "released"])) {
    return coreError("input.invalidShape", "InputFrame contains unknown fields");
  }
  if (typeof record.tick !== "number" || !Number.isSafeInteger(record.tick) || record.tick < 0) {
    return coreError("input.invalidShape", "input.tick must be a non-negative safe integer");
  }

  const axes = asRecord(record.axes);
  if (!axes || !isAxisValue(axes.moveX) || !isAxisValue(axes.moveY)) {
    return coreError("input.invalidShape", "input.axes must contain moveX/moveY values of -1, 0, or 1");
  }
  if (!hasOnlyKeys(axes, ["moveX", "moveY"])) {
    return coreError("input.invalidShape", "input.axes contains unknown fields");
  }

  const held = parseActionArray(record.held);
  const pressed = parseActionArray(record.pressed);
  const released = parseActionArray(record.released);
  if (!held || !pressed || !released) {
    return coreError("input.invalidShape", "input action arrays must contain unique supported gameplay actions");
  }
  if (hasIntersection(held, released)) {
    return coreError("input.invalidShape", "input.held and input.released must not contain the same action");
  }

  return okResult(deepFreezeClone({
    tick: record.tick,
    axes: { moveX: axes.moveX, moveY: axes.moveY },
    held,
    pressed,
    released,
  }));
}

function isAxisValue(value: unknown): value is -1 | 0 | 1 {
  return value === -1 || value === 0 || value === 1;
}

/** action 配列を重複のない canonical order へ正規化する。 */
function parseActionArray(value: unknown): InputFrame["held"] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const actions = new Set<InputFrame["held"][number]>();
  for (const item of value) {
    if (item !== "shot" && item !== "focus") {
      return null;
    }
    if (actions.has(item)) {
      return null;
    }
    actions.add(item);
  }
  return GAMEPLAY_ACTION_ORDER.filter((action) => actions.has(action));
}

/** same tick の押下/離上 edge と held state の矛盾を検出する。 */
function hasIntersection(left: readonly InputFrame["held"][number][], right: readonly InputFrame["held"][number][]): boolean {
  const rightActions = new Set(right);
  return left.some((action) => rightActions.has(action));
}
