import { asRecord } from "../../internal/guards.ts";
import type { CoreError } from "../../result.ts";
import { isSafeAssetKey } from "../identifier.ts";

/** object の許可 field を検証する。 */
export function validateAllowedKeys(
  path: string,
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  errors: CoreError[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "definition.unknownField",
        message: `Unknown field at ${path}.${key}`,
      });
    }
  }
}

export type IndexedObjectArray = Readonly<{
  items: readonly Readonly<{ index: number; record: Record<string, unknown> }>[];
  sourceLength: number;
}>;

/** unknown valueをobject arrayとして検証し、除外した要素があっても元indexを保持する。 */
export function validateObjectArray(path: string, value: unknown, errors: CoreError[]): IndexedObjectArray {
  if (!Array.isArray(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an array`, schemaPath: path });
    return Object.freeze({ items: Object.freeze([]), sourceLength: 0 });
  }

  const items: Array<Readonly<{ index: number; record: Record<string, unknown> }>> = [];
  for (const [index, item] of value.entries()) {
    const record = asRecord(item);
    if (!record) {
      errors.push({
        code: "definition.invalidShape",
        message: `${path} must contain objects`,
        schemaPath: `${path}[${index}]`,
      });
      continue;
    }
    items.push(Object.freeze({ index, record }));
  }
  return Object.freeze({ items: Object.freeze(items), sourceLength: value.length });
}

/** asset key 配列として使える内容か検証する。 */
export function validateAssetKeyArray(path: string, value: unknown, errors: CoreError[]): void {
  if (!Array.isArray(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an array` });
    return;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      errors.push({ code: "definition.invalidShape", message: `${path} must contain strings` });
      continue;
    }
    if (item.trim().length === 0) {
      errors.push({ code: "asset.invalidKey", message: `${path} must not contain empty asset keys` });
      continue;
    }
    if (!isSafeAssetKey(item)) {
      errors.push({ code: "asset.invalidKey", message: `Invalid asset key: ${item}` });
      continue;
    }
    if (seen.has(item)) {
      errors.push({ code: "asset.duplicate", message: `Duplicate asset key: ${item}` });
      continue;
    }
    seen.add(item);
  }
}

/** Difficulty 配列を検証する。 */
export function validateDifficultyArray(path: string, value: unknown, errors: CoreError[]): void {
  if (!Array.isArray(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be an array` });
    return;
  }
  if (value.length === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must contain at least one difficulty` });
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (item !== "normal" && item !== "hard") {
      errors.push({ code: "definition.invalidShape", message: `${path} must contain supported difficulties` });
      continue;
    }
    if (seen.has(item)) {
      errors.push({ code: "definition.invalidShape", message: `${path} must not contain duplicate difficulties` });
      continue;
    }
    seen.add(item);
  }
}

/** unknown value が空白だけではない string であることを検証する。 */
export function validateNonEmptyString(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a string` });
  }
}

/** unknown value が finite number であることを検証する。 */
export function validateFiniteNumber(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a finite number` });
  }
}

/** unknown value が有限数であり、絶対値上限内であることを検証する。 */
export function validateFiniteNumberWithinAbs(path: string, value: unknown, maxAbs: number, errors: CoreError[]): void {
  validateFiniteNumber(path, value, errors);
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) > maxAbs) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be between ${-maxAbs} and ${maxAbs}` });
  }
}

/** unknown value が 0 以上の整数であることを検証する。 */
export function validateNonNegativeInteger(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a non-negative integer` });
  }
}

/** unknown value が 1 以上の整数であることを検証する。 */
export function validatePositiveInteger(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a positive integer` });
  }
}

/** unknown value が 1 以上 max 以下の整数であることを検証する。 */
export function validatePositiveIntegerAtMost(path: string, value: unknown, max: number, errors: CoreError[]): void {
  validatePositiveInteger(path, value, errors);
  if (typeof value === "number" && Number.isSafeInteger(value) && value > max) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be at most ${max}` });
  }
}

/** unknown value が 0 より大きい有限数であることを検証する。 */
export function validatePositiveNumber(path: string, value: unknown, errors: CoreError[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be a positive number` });
  }
}

/** unknown value が比較対象の number 以下であることを検証する。 */
export function validateNumberAtMost(
  path: string,
  value: unknown,
  maxValue: unknown,
  maxPath: string,
  errors: CoreError[],
): void {
  if (
    typeof value === "number"
    && Number.isFinite(value)
    && typeof maxValue === "number"
    && Number.isFinite(maxValue)
    && value > maxValue
  ) {
    errors.push({ code: "definition.invalidShape", message: `${path} must be less than or equal to ${maxPath}` });
  }
}
