import { coreError, okResult } from "../result.ts";
import type { CoreResult } from "../result.ts";
import { isPlainObjectContainer } from "../shared/guards.ts";

export const MAX_RESTORE_TOP_LEVEL_STRING_LENGTH = 8_192;

const MAX_RESTORE_ARRAY_LENGTH = 8_192;

/** restore の top-level string は deep guard を通らないため、ここで最小 budget を守る。 */
export function isRestoreTopLevelString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_RESTORE_TOP_LEVEL_STRING_LENGTH;
}

/**
 * restore 用に top-level の own data property だけを浅く clone する。
 *
 * `state` / `prngState` の deep payload はここでは読まず、後段の deterministic payload
 * validator に渡す。互換性 metadata が nested payload の shape error にマスクされないことを優先する。
 */
export function cloneRestoreTopLevelPlainRecord(value: unknown): CoreResult<Record<string, unknown>> {
  try {
    if (!isPlainObjectContainer(value)) {
      return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
    }
    const record = value as Record<string, unknown>;
    const clone = Object.create(null) as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(record)) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
      }
      clone[key] = descriptor.value;
    }

    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", "SerializedGameState must be JSON-compatible plain data at top level");
  }
}

/** restore payload shell の plain object を getter なしの shallow clone にする。 */
export function cloneRestorePlainRecord(
  value: unknown,
  fieldName: string,
  allowedKeys: readonly string[],
): CoreResult<Record<string, unknown>> {
  try {
    if (!isPlainObjectContainer(value)) {
      return coreError("state.invalidShape", `${fieldName} must be a plain object`);
    }
    const source = value as Record<string, unknown>;
    const clone = Object.create(null) as Record<string, unknown>;
    const propertyNames = Object.getOwnPropertyNames(source);
    if (propertyNames.length > allowedKeys.length) {
      return coreError("state.invalidShape", `${fieldName} contains unknown fields`);
    }
    const allowed = new Set(allowedKeys);
    for (const key of propertyNames) {
      if (!allowed.has(key)) {
        return coreError("state.invalidShape", `${fieldName} contains unknown fields`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must contain only enumerable data properties`);
      }
      clone[key] = descriptor.value;
    }

    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", `${fieldName} must be a plain object`);
  }
}

/** restore payload shell の配列を dense data array として shallow clone する。 */
export function cloneRestoreArray(
  value: unknown,
  fieldName: string,
  maxLength = MAX_RESTORE_ARRAY_LENGTH,
): CoreResult<readonly unknown[]> {
  try {
    if (!Array.isArray(value)) {
      return coreError("state.invalidShape", `${fieldName} must be an array`);
    }
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    const length = value.length;
    if (
      !Number.isSafeInteger(length)
      || length < 0
      || length > maxLength
      || Object.getOwnPropertySymbols(value).length > 0
    ) {
      return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length > length + 1) {
      return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
    }
    for (const key of propertyNames) {
      if (key === "length") {
        continue;
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
        return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
      }
    }
    const clone: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return coreError("state.invalidShape", `${fieldName} must be a dense data array`);
      }
      clone.push(descriptor.value);
    }

    return okResult(Object.freeze(clone));
  } catch {
    return coreError("state.invalidShape", `${fieldName} must be an array`);
  }
}
